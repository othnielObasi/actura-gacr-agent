/**
 * Kraken CLI Execution Layer
 *
 * Interfaces with the Kraken CLI binary and its built-in MCP server
 * for order placement, paper trading, and account management.
 *
 * The Kraken CLI is a zero-dependency Rust binary that handles:
 *   - Cryptographic nonce management
 *   - HMAC-SHA512 request signing
 *   - Rate-limit retries
 *   - Built-in MCP server for AI agent integration
 *   - Paper-trading sandbox for strategy testing
 *
 * Two execution modes:
 *   1. CLI subprocess — invoke `kraken-cli` directly for order placement
 *   2. MCP server — connect to the CLI's built-in MCP server over stdio/HTTP
 *
 * Docs: https://github.com/cryptolake-io/kraken-cli
 */

import { createLogger } from '../agent/logger.js';
import { retry } from '../agent/retry.js';

const log = createLogger('KRAKEN-CLI');

// ── Configuration ──

const CLI_PATH = process.env.KRAKEN_CLI_PATH || 'kraken';
const CLI_TIMEOUT_MS = parseInt(process.env.KRAKEN_CLI_TIMEOUT_MS || '15000');
const PAPER_TRADING = process.env.KRAKEN_PAPER_TRADING !== 'false'; // default: paper mode

// Kraken pair mapping (standard → Kraken format)
const PAIR_MAP: Record<string, string> = {
  'WETH/USDC': 'ETHUSD',
  'ETH/USDC': 'ETHUSD',
  'ETH/USD': 'ETHUSD',
  'BTC/USDC': 'XBTUSD',
  'BTC/USD': 'XBTUSD',
  'SOL/USD': 'SOLUSD',
  'SOL/USDC': 'SOLUSD',
};

// ── Types ──

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop-loss' | 'take-profit' | 'stop-loss-limit' | 'take-profit-limit';

export interface KrakenOrderParams {
  pair: string;
  side: OrderSide;
  orderType: OrderType;
  volume: string;
  price?: string;            // Required for limit orders
  price2?: string;           // Secondary price (stop-loss-limit, take-profit-limit)
  leverage?: string;         // e.g. '2:1'
  reduceOnly?: boolean;
  timeInForce?: 'GTC' | 'IOC' | 'GTD';
  validateOnly?: boolean;    // Validate without placing (dry run)
  closeOrderType?: OrderType;
  closePrice?: string;
  closePrice2?: string;
}

export interface KrakenOrderResult {
  success: boolean;
  orderId: string | null;
  description: string;
  status: string;
  error: string | null;
  txIds: string[];
  paperTrade: boolean;
  rawResponse: unknown;
  executionTimeMs: number;
}

export interface KrakenCancelResult {
  success: boolean;
  count: number;
  error: string | null;
}

export interface KrakenCliStatus {
  installed: boolean;
  version: string | null;
  paperTrading: boolean;
  apiKeyConfigured: boolean;
  lastHealthCheck: string | null;
  healthy: boolean;
}

// ── State ──

let cliInstalled: boolean | null = null;
let cliVersion: string | null = null;
let lastHealthCheck: string | null = null;
let healthy = false;

// ── CLI Invocation ──

/**
 * Execute a Kraken CLI command and return stdout.
 * Handles timeout and error parsing.
 */
async function execCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const fullArgs = [...args];

  // Add paper trading flag if enabled
  if (PAPER_TRADING && !fullArgs.includes('--sandbox') && !fullArgs.includes('--paper')) {
    // Kraken CLI uses --sandbox for paper trading mode
    fullArgs.push('--sandbox');
  }

  log.info(`CLI exec: ${CLI_PATH} ${fullArgs.join(' ')}`);

  try {
    const { stdout, stderr } = await execFileAsync(CLI_PATH, fullArgs, {
      timeout: CLI_TIMEOUT_MS,
      env: {
        ...process.env,
        KRAKEN_API_KEY: process.env.KRAKEN_API_KEY || '',
        KRAKEN_API_SECRET: process.env.KRAKEN_API_SECRET || '',
      },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (error: any) {
    const stderr = error.stderr?.trim() || '';
    const stdout = error.stdout?.trim() || '';
    const exitCode = error.code ?? 1;

    if (error.killed) {
      log.error('CLI command timed out', { args: fullArgs, timeoutMs: CLI_TIMEOUT_MS });
      return { stdout, stderr: 'Command timed out', exitCode: 124 };
    }

    log.warn('CLI command failed', { args: fullArgs, exitCode, stderr: stderr.slice(0, 200) });
    return { stdout, stderr, exitCode };
  }
}

/**
 * Parse JSON output from CLI. Falls back to raw text if not JSON.
 */
function parseCliOutput(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    // Some CLI commands output plain text
    return { raw: stdout };
  }
}

// ── Health Check ──

/**
 * Check if the Kraken CLI binary is installed and responsive.
 */
export async function checkCliHealth(): Promise<KrakenCliStatus> {
  const apiKeyConfigured = !!(process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET);

  try {
    const result = await execCli(['--version']);

    if (result.exitCode === 0) {
      cliInstalled = true;
      cliVersion = result.stdout.split('\n')[0] || 'unknown';
      healthy = true;
      lastHealthCheck = new Date().toISOString();
      log.info('Kraken CLI healthy', { version: cliVersion, paperTrading: PAPER_TRADING });
    } else {
      cliInstalled = false;
      healthy = false;
      lastHealthCheck = new Date().toISOString();
      log.warn('Kraken CLI not responding', { exitCode: result.exitCode, stderr: result.stderr });
    }
  } catch {
    cliInstalled = false;
    healthy = false;
    lastHealthCheck = new Date().toISOString();
  }

  return getCliStatus();
}

export function getCliStatus(): KrakenCliStatus {
  return {
    installed: cliInstalled ?? false,
    version: cliVersion,
    paperTrading: PAPER_TRADING,
    apiKeyConfigured: !!(process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET),
    lastHealthCheck,
    healthy,
  };
}

// ── Order Placement ──

/**
 * Place an order via Kraken CLI.
 *
 * For paper trading, the CLI's --sandbox flag simulates execution.
 * For live trading, the order is placed on the real Kraken exchange.
 */
export async function placeOrder(params: KrakenOrderParams): Promise<KrakenOrderResult> {
  const start = Date.now();

  const krakenPair = PAIR_MAP[params.pair] || params.pair;

  const args = [
    'trade',
    '--pair', krakenPair,
    '--type', params.side,
    '--ordertype', params.orderType,
    '--volume', params.volume,
  ];

  if (params.price) {
    args.push('--price', params.price);
  }
  if (params.price2) {
    args.push('--price2', params.price2);
  }
  if (params.leverage) {
    args.push('--leverage', params.leverage);
  }
  if (params.reduceOnly) {
    args.push('--reduce-only');
  }
  if (params.timeInForce) {
    args.push('--timeinforce', params.timeInForce);
  }

  // Validate-only mode for dry runs
  if (params.validateOnly) {
    args.push('--validate');
  }

  // Conditional close
  if (params.closeOrderType) {
    args.push('--close-ordertype', params.closeOrderType);
    if (params.closePrice) args.push('--close-price', params.closePrice);
    if (params.closePrice2) args.push('--close-price2', params.closePrice2);
  }

  // Output as JSON for parsing
  args.push('--output', 'json');

  log.info('Placing order', {
    pair: krakenPair,
    side: params.side,
    type: params.orderType,
    volume: params.volume,
    price: params.price || 'market',
    paper: PAPER_TRADING,
  });

  const result = await execCli(args);
  const executionTimeMs = Date.now() - start;

  if (result.exitCode !== 0) {
    const errorMsg = result.stderr || result.stdout || 'Unknown CLI error';
    log.error('Order placement failed', { error: errorMsg, exitCode: result.exitCode });
    return {
      success: false,
      orderId: null,
      description: '',
      status: 'FAILED',
      error: errorMsg,
      txIds: [],
      paperTrade: PAPER_TRADING,
      rawResponse: result,
      executionTimeMs,
    };
  }

  const parsed = parseCliOutput(result.stdout);

  // Parse Kraken AddOrder response format
  const txIds = parsed?.result?.txid || parsed?.txid || [];
  const descr = parsed?.result?.descr?.order || parsed?.descr?.order || '';
  const orderId = Array.isArray(txIds) && txIds.length > 0 ? txIds[0] : null;

  log.info('Order placed successfully', {
    orderId,
    description: descr,
    txIds,
    paper: PAPER_TRADING,
    executionTimeMs,
  });

  return {
    success: true,
    orderId,
    description: descr,
    status: 'PLACED',
    error: null,
    txIds: Array.isArray(txIds) ? txIds : [txIds].filter(Boolean),
    paperTrade: PAPER_TRADING,
    rawResponse: parsed,
    executionTimeMs,
  };
}

/**
 * Place a market order — the most common execution type for autonomous agents.
 */
export async function placeMarketOrder(
  pair: string,
  side: OrderSide,
  volume: string,
  options: {
    validateOnly?: boolean;
    reduceOnly?: boolean;
    stopLossPrice?: string;
    takeProfitPrice?: string;
  } = {}
): Promise<KrakenOrderResult> {
  return placeOrder({
    pair,
    side,
    orderType: 'market',
    volume,
    validateOnly: options.validateOnly,
    reduceOnly: options.reduceOnly,
    closeOrderType: options.stopLossPrice ? 'stop-loss' : undefined,
    closePrice: options.stopLossPrice,
  });
}

/**
 * Place a limit order with specified price.
 */
export async function placeLimitOrder(
  pair: string,
  side: OrderSide,
  volume: string,
  price: string,
  options: {
    timeInForce?: 'GTC' | 'IOC' | 'GTD';
    validateOnly?: boolean;
    stopLossPrice?: string;
  } = {}
): Promise<KrakenOrderResult> {
  return placeOrder({
    pair,
    side,
    orderType: 'limit',
    volume,
    price,
    timeInForce: options.timeInForce || 'GTC',
    validateOnly: options.validateOnly,
    closeOrderType: options.stopLossPrice ? 'stop-loss' : undefined,
    closePrice: options.stopLossPrice,
  });
}

/**
 * Place a stop-loss order.
 */
export async function placeStopLossOrder(
  pair: string,
  side: OrderSide,
  volume: string,
  stopPrice: string,
): Promise<KrakenOrderResult> {
  return placeOrder({
    pair,
    side,
    orderType: 'stop-loss',
    volume,
    price: stopPrice,
  });
}

// ── Order Management ──

/**
 * Cancel an open order by ID.
 */
export async function cancelOrder(orderId: string): Promise<KrakenCancelResult> {
  log.info('Cancelling order', { orderId });

  const result = await execCli(['cancel', '--txid', orderId, '--output', 'json']);

  if (result.exitCode !== 0) {
    return { success: false, count: 0, error: result.stderr || 'Cancel failed' };
  }

  const parsed = parseCliOutput(result.stdout);
  const count = parsed?.result?.count ?? parsed?.count ?? 1;

  log.info('Order cancelled', { orderId, count });
  return { success: true, count, error: null };
}

/**
 * Cancel all open orders.
 */
export async function cancelAllOrders(): Promise<KrakenCancelResult> {
  log.info('Cancelling all open orders');

  const result = await execCli(['cancel-all', '--output', 'json']);

  if (result.exitCode !== 0) {
    return { success: false, count: 0, error: result.stderr || 'Cancel all failed' };
  }

  const parsed = parseCliOutput(result.stdout);
  const count = parsed?.result?.count ?? parsed?.count ?? 0;

  log.info('All orders cancelled', { count });
  return { success: true, count, error: null };
}

// ── Account Queries via CLI ──

/**
 * Get account balance via CLI.
 */
export async function getBalanceViaCli(): Promise<Record<string, string> | null> {
  const result = await execCli(['balance', '--output', 'json']);
  if (result.exitCode !== 0) return null;

  const parsed = parseCliOutput(result.stdout);
  return parsed?.result || parsed || null;
}

/**
 * Get open orders via CLI.
 */
export async function getOpenOrdersViaCli(): Promise<any[] | null> {
  const result = await execCli(['open-orders', '--output', 'json']);
  if (result.exitCode !== 0) return null;

  const parsed = parseCliOutput(result.stdout);
  const open = parsed?.result?.open || parsed?.open || {};
  return Object.entries(open).map(([id, o]: [string, any]) => ({
    orderId: id,
    pair: o?.descr?.pair ?? '',
    type: o?.descr?.type ?? '',
    orderType: o?.descr?.ordertype ?? '',
    price: o?.descr?.price ?? '0',
    volume: o?.vol ?? '0',
    status: o?.status ?? '',
    description: o?.descr?.order ?? '',
  }));
}

/**
 * Get trade history via CLI.
 */
export async function getTradeHistoryViaCli(): Promise<any[] | null> {
  const result = await execCli(['trades', '--output', 'json']);
  if (result.exitCode !== 0) return null;

  const parsed = parseCliOutput(result.stdout);
  const trades = parsed?.result?.trades || parsed?.trades || {};
  return Object.entries(trades).map(([id, t]: [string, any]) => ({
    tradeId: id,
    orderId: t?.ordertxid ?? '',
    pair: t?.pair ?? '',
    type: t?.type ?? '',
    price: t?.price ?? '0',
    cost: t?.cost ?? '0',
    fee: t?.fee ?? '0',
    volume: t?.vol ?? '0',
    time: t?.time ?? 0,
  }));
}

// ── MCP Server Interface ──

/**
 * Invoke a tool on the Kraken CLI's built-in MCP server via stdio.
 *
 * The CLI ships with an MCP server that exposes trading tools.
 * We connect via stdio transport (spawn the CLI in MCP mode).
 */
export async function invokeMcpTool(
  toolName: string,
  params: Record<string, unknown> = {}
): Promise<{ success: boolean; result: unknown; error: string | null }> {
  // Build MCP JSON-RPC request
  const mcpRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: params,
    },
  });

  log.info('MCP tool invoke', { tool: toolName, params });

  const { spawn } = await import('node:child_process');

  return new Promise((resolve) => {
    const child = spawn(CLI_PATH, ['mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: CLI_TIMEOUT_MS,
      env: {
        ...process.env,
        KRAKEN_API_KEY: process.env.KRAKEN_API_KEY || '',
        KRAKEN_API_SECRET: process.env.KRAKEN_API_SECRET || '',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    // Send the MCP request on stdin
    child.stdin.write(mcpRequest + '\n');
    child.stdin.end();

    child.on('close', (code) => {
      if (code !== 0 && !stdout) {
        log.warn('MCP invoke failed', { tool: toolName, exitCode: code, stderr: stderr.slice(0, 200) });
        resolve({ success: false, result: null, error: stderr || `Exit code ${code}` });
        return;
      }

      try {
        // Parse all JSON-RPC responses (may have initialization messages before our result)
        const lines = stdout.split('\n').filter(l => l.trim());
        const responses = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

        // Find our response (match by id or look for result/error)
        const response = responses.find(r => r.result || r.error) || responses[responses.length - 1];

        if (response?.error) {
          resolve({ success: false, result: null, error: response.error.message || JSON.stringify(response.error) });
        } else if (response?.result) {
          resolve({ success: true, result: response.result, error: null });
        } else {
          resolve({ success: true, result: parseCliOutput(stdout), error: null });
        }
      } catch {
        resolve({ success: true, result: { raw: stdout }, error: null });
      }
    });

    child.on('error', (err) => {
      log.error('MCP process error', { tool: toolName, error: err.message });
      resolve({ success: false, result: null, error: err.message });
    });

    // Safety timeout
    setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ success: false, result: null, error: 'MCP invoke timed out' });
    }, CLI_TIMEOUT_MS);
  });
}

/**
 * Place an order via the CLI's MCP server.
 */
export async function placeOrderViaMcp(params: KrakenOrderParams): Promise<KrakenOrderResult> {
  const start = Date.now();
  const krakenPair = PAIR_MAP[params.pair] || params.pair;

  const mcpParams: Record<string, unknown> = {
    pair: krakenPair,
    type: params.side,
    ordertype: params.orderType,
    volume: params.volume,
  };

  if (params.price) mcpParams.price = params.price;
  if (params.price2) mcpParams.price2 = params.price2;
  if (params.leverage) mcpParams.leverage = params.leverage;
  if (params.validateOnly) mcpParams.validate = true;
  if (PAPER_TRADING) mcpParams.sandbox = true;

  const result = await invokeMcpTool('add_order', mcpParams);
  const executionTimeMs = Date.now() - start;

  if (!result.success) {
    return {
      success: false,
      orderId: null,
      description: '',
      status: 'FAILED',
      error: result.error || 'MCP order placement failed',
      txIds: [],
      paperTrade: PAPER_TRADING,
      rawResponse: result,
      executionTimeMs,
    };
  }

  const data = result.result as any;
  const txIds = data?.txid || data?.result?.txid || [];
  const descr = data?.descr?.order || data?.result?.descr?.order || '';
  const orderId = Array.isArray(txIds) && txIds.length > 0 ? txIds[0] : null;

  return {
    success: true,
    orderId,
    description: descr,
    status: 'PLACED',
    error: null,
    txIds: Array.isArray(txIds) ? txIds : [txIds].filter(Boolean),
    paperTrade: PAPER_TRADING,
    rawResponse: data,
    executionTimeMs,
  };
}

// ── Unified Execution Interface ──

/**
 * Execute an order through the best available Kraken CLI method.
 * Tries CLI subprocess first, falls back to MCP, then REST API.
 */
export async function executeKrakenOrder(params: KrakenOrderParams): Promise<KrakenOrderResult> {
  // Prefer CLI subprocess (most reliable)
  if (cliInstalled !== false) {
    try {
      const result = await retry(
        () => placeOrder(params),
        { maxRetries: 1, baseDelayMs: 1000, label: 'Kraken CLI order' }
      );
      if (result.success) return result;
      log.warn('CLI order failed, trying MCP fallback', { error: result.error });
    } catch (e) {
      log.warn('CLI order threw, trying MCP fallback', { error: String(e) });
    }
  }

  // Fallback: MCP server
  try {
    const result = await retry(
      () => placeOrderViaMcp(params),
      { maxRetries: 1, baseDelayMs: 1000, label: 'Kraken MCP order' }
    );
    if (result.success) return result;
    log.warn('MCP order also failed', { error: result.error });
  } catch (e) {
    log.warn('MCP order threw', { error: String(e) });
  }

  // All methods failed
  return {
    success: false,
    orderId: null,
    description: '',
    status: 'ALL_METHODS_FAILED',
    error: 'Kraken CLI and MCP server both unavailable',
    txIds: [],
    paperTrade: PAPER_TRADING,
    rawResponse: null,
    executionTimeMs: 0,
  };
}
