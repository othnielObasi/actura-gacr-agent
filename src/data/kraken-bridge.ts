/**
 * Kraken Execution Bridge
 *
 * Bridges the agent's governed execution pipeline to Kraken CLI order placement.
 * This is the "execution layer" that the Kraken Challenge requires.
 *
 * Flow:
 * 1. Agent's strategy + risk engine produce a governed trade decision
 * 2. This bridge converts it to a Kraken order
 * 3. Kraken CLI places the order (paper or live)
 * 4. Results are fed back into the agent's tracking, artifacts, and trust system
 *
 * The bridge preserves all ERC-8004 trust artifacts — every Kraken trade
 * also gets an IPFS decision artifact, on-chain validation, and reputation feedback.
 */

import { createLogger } from '../agent/logger.js';
import { retry } from '../agent/retry.js';
import { config } from '../agent/config.js';
import {
  executeKrakenOrder,
  placeMarketOrder,
  placeLimitOrder,
  placeStopLossOrder,
  checkCliHealth,
  getCliStatus,
  type KrakenOrderParams,
  type KrakenOrderResult,
  type OrderSide,
} from './kraken-cli.js';
import {
  fetchKrakenTicker,
  fetchKrakenBalance,
  fetchKrakenOpenOrders,
  fetchKrakenTradeHistory,
} from './kraken-feed.js';
import { uploadArtifact } from '../trust/ipfs.js';
import { validateTradeArtifact } from '../chain/validation.js';
import { postTradeOutcomeFeedback } from '../chain/reputation.js';
import type { StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision } from '../risk/engine.js';
import type { ValidationArtifact } from '../trust/artifact-emitter.js';

const log = createLogger('KRAKEN-BRIDGE');

// ── Types ──

export interface KrakenExecutionResult {
  success: boolean;
  orderId: string | null;
  orderDescription: string;
  executionMode: 'cli' | 'mcp' | 'rest-fallback';
  paperTrade: boolean;
  krakenPair: string;
  side: OrderSide;
  volume: string;
  orderType: string;
  estimatedPrice: number;
  stopLossOrderId: string | null;
  artifactIpfsCid: string | null;
  artifactIpfsUri: string | null;
  validationTxHash: string | null;
  reputationTxHash: string | null;
  error: string | null;
  executionTimeMs: number;
}

// Pair mapping to Kraken format
const PAIR_MAP: Record<string, string> = {
  'WETH/USDC': 'ETHUSD',
  'ETH/USDC': 'ETHUSD',
  'ETH/USD': 'ETHUSD',
  'BTC/USDC': 'XBTUSD',
  'BTC/USD': 'XBTUSD',
};

// ── Execution Bridge ──

/**
 * Execute a governed trade through Kraken CLI.
 *
 * Converts the agent's StrategyOutput + RiskDecision into a Kraken order,
 * places it via the CLI, and records the result in the trust pipeline.
 */
export async function executeKrakenTrade(
  strategyOutput: StrategyOutput,
  riskDecision: RiskDecision,
  artifact: ValidationArtifact,
  agentId: number | null,
  options?: { skipOnChainValidation?: boolean },
): Promise<KrakenExecutionResult> {
  const start = Date.now();
  const result: KrakenExecutionResult = {
    success: false,
    orderId: null,
    orderDescription: '',
    executionMode: 'cli',
    paperTrade: process.env.KRAKEN_PAPER_TRADING !== 'false',
    krakenPair: '',
    side: 'buy',
    volume: '0',
    orderType: 'market',
    estimatedPrice: strategyOutput.currentPrice,
    stopLossOrderId: null,
    artifactIpfsCid: null,
    artifactIpfsUri: null,
    validationTxHash: null,
    reputationTxHash: null,
    error: null,
    executionTimeMs: 0,
  };

  try {
    // ── Step 1: Convert strategy signal to Kraken order ──
    const krakenPair = PAIR_MAP[config.tradingPair] || config.tradingPair;
    result.krakenPair = krakenPair;

    const direction = strategyOutput.signal.direction;
    if (direction === 'NEUTRAL') {
      result.error = 'Signal is NEUTRAL — no order to place';
      result.executionTimeMs = Date.now() - start;
      return result;
    }

    // LONG → buy, SHORT → sell
    const side: OrderSide = direction === 'LONG' ? 'buy' : 'sell';
    result.side = side;

    // Convert position size (USD notional) to asset volume
    // riskDecision.finalPositionSize is in USD terms,
    // divide by current price to get asset units
    const currentPrice = strategyOutput.currentPrice;
    const positionSizeUsd = riskDecision.finalPositionSize * currentPrice;
    const volumeUnits = riskDecision.finalPositionSize;

    // Kraken requires specific decimal precision per asset
    // ETH: 8 decimals, BTC: 8 decimals
    const volume = volumeUnits.toFixed(8);
    result.volume = volume;

    log.info('Executing Kraken trade', {
      pair: krakenPair,
      side,
      volume,
      notionalUsd: positionSizeUsd.toFixed(2),
      price: currentPrice,
      confidence: strategyOutput.signal.confidence.toFixed(3),
      paper: result.paperTrade,
    });

    // ── Step 2: Place the main order via CLI ──
    const orderResult = await retry(
      () => executeKrakenOrder({
        pair: config.tradingPair,
        side,
        orderType: 'market',
        volume,
      }),
      { maxRetries: 2, baseDelayMs: 1500, label: 'Kraken order placement' }
    );

    if (!orderResult.success) {
      result.error = orderResult.error || 'Order placement failed';
      result.executionTimeMs = Date.now() - start;
      log.error('Kraken order failed', { error: result.error });
      return result;
    }

    result.orderId = orderResult.orderId;
    result.orderDescription = orderResult.description;
    result.success = true;

    log.info('Kraken order placed', {
      orderId: orderResult.orderId,
      description: orderResult.description,
      paper: orderResult.paperTrade,
    });

    // ── Step 3: Place stop-loss order (if risk engine specified one) ──
    if (riskDecision.stopLossPrice && riskDecision.stopLossPrice > 0) {
      try {
        const stopSide: OrderSide = direction === 'LONG' ? 'sell' : 'buy';
        const stopResult = await placeStopLossOrder(
          config.tradingPair,
          stopSide,
          volume,
          riskDecision.stopLossPrice.toFixed(2),
        );

        if (stopResult.success) {
          result.stopLossOrderId = stopResult.orderId;
          log.info('Stop-loss order placed', {
            orderId: stopResult.orderId,
            stopPrice: riskDecision.stopLossPrice.toFixed(2),
          });
        } else {
          log.warn('Stop-loss order failed — position open without stop', {
            error: stopResult.error,
          });
        }
      } catch (e) {
        log.warn('Stop-loss order threw — position open without stop', { error: String(e) });
      }
    }

    // ── Step 4: Upload artifact to IPFS ──
    // Enrich artifact with Kraken execution details
    (artifact as any).krakenExecution = {
      orderId: orderResult.orderId,
      krakenPair,
      side,
      volume,
      orderType: 'market',
      paperTrade: orderResult.paperTrade,
      stopLossOrderId: result.stopLossOrderId,
      description: orderResult.description,
      txIds: orderResult.txIds,
    };

    try {
      const ipfsResult = await retry(
        () => uploadArtifact(artifact),
        { maxRetries: 2, baseDelayMs: 500, label: 'IPFS upload (Kraken trade)' }
      );
      result.artifactIpfsCid = ipfsResult.cid;
      result.artifactIpfsUri = ipfsResult.uri;
      log.info('Trade artifact uploaded', { cid: ipfsResult.cid });
    } catch (e) {
      log.warn('IPFS upload failed — trade still executed', { error: String(e) });
    }

    // ── Step 5: On-chain validation (if agent is registered and not already done by main executor) ──
    const validatorKey = process.env.VALIDATOR_PRIVATE_KEY;
    if (agentId && validatorKey && result.artifactIpfsUri && !options?.skipOnChainValidation) {
      try {
        const validation = await retry(
          () => validateTradeArtifact(
            agentId,
            validatorKey,
            result.artifactIpfsUri!,
            artifact as object,
            riskDecision.checks,
          ),
          { maxRetries: 2, baseDelayMs: 2000, label: 'Kraken trade validation' }
        );
        result.validationTxHash = validation.responseTx;
        log.info('On-chain validation submitted', {
          requestHash: validation.requestHash,
          score: validation.score,
        });
      } catch (e) {
        log.warn('On-chain validation failed — trade still valid', { error: String(e) });
      }
    }

    // ── Step 6: Post reputation feedback (skip if main executor already posted) ──
    const reviewerKey = process.env.REVIEWER_PRIVATE_KEY || process.env.VALIDATOR_PRIVATE_KEY;
    if (agentId && reviewerKey && !options?.skipOnChainValidation) {
      try {
        const conf = strategyOutput.signal.confidence;
        const dir = direction === 'LONG' ? 1 : -1;
        const estimatedYieldPct = dir * (conf - 0.5) * riskDecision.finalPositionSize * 0.01;

        result.reputationTxHash = await retry(
          () => postTradeOutcomeFeedback(reviewerKey, agentId, {
            yieldPercent: estimatedYieldPct,
            period: 'day',
            artifactUri: result.artifactIpfsUri || '',
          }),
          { maxRetries: 2, baseDelayMs: 1500, label: 'Kraken trade reputation' }
        );
        log.info('Reputation feedback submitted', { txHash: result.reputationTxHash });
      } catch (e) {
        log.warn('Reputation feedback failed', { error: String(e) });
      }
    }

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    log.error('Kraken trade execution failed', { error: result.error });
  }

  result.executionTimeMs = Date.now() - start;
  return result;
}

/**
 * Close a position by placing an opposing market order on Kraken.
 */
export async function closeKrakenPosition(
  pair: string,
  currentSide: 'LONG' | 'SHORT',
  volume: string,
  reason: string,
): Promise<KrakenOrderResult> {
  const closeSide: OrderSide = currentSide === 'LONG' ? 'sell' : 'buy';

  log.info('Closing Kraken position', { pair, currentSide, closeSide, volume, reason });

  return retry(
    () => executeKrakenOrder({
      pair,
      side: closeSide,
      orderType: 'market',
      volume,
      reduceOnly: true,
    }),
    { maxRetries: 2, baseDelayMs: 1500, label: 'Kraken position close' }
  );
}

/**
 * Preflight check: verify Kraken CLI is operational before starting the agent.
 */
export async function krakenPreflight(): Promise<{
  ready: boolean;
  status: ReturnType<typeof getCliStatus>;
  balance: Record<string, string> | null;
  ticker: Awaited<ReturnType<typeof fetchKrakenTicker>>;
}> {
  log.info('Running Kraken preflight checks...');

  const status = await checkCliHealth();
  const ticker = await fetchKrakenTicker(config.tradingPair);
  const balance = await fetchKrakenBalance();

  const ready = status.apiKeyConfigured && (ticker !== null);

  log.info('Kraken preflight complete', {
    cliInstalled: status.installed,
    apiKeyConfigured: status.apiKeyConfigured,
    paperTrading: status.paperTrading,
    tickerAvailable: ticker !== null,
    currentPrice: ticker?.price ?? 'N/A',
    balanceAssets: balance ? Object.keys(balance).length : 0,
  });

  if (!ready) {
    log.warn('Kraken preflight FAILED — check API keys and network connectivity');
  }

  return { ready, status, balance, ticker };
}

/**
 * Get a snapshot of the current Kraken account state.
 */
export async function getKrakenAccountSnapshot(): Promise<{
  balance: Record<string, string>;
  openOrders: number;
  recentTrades: number;
  ticker: { pair: string; price: number } | null;
  cliStatus: ReturnType<typeof getCliStatus>;
}> {
  const [balance, orders, trades, ticker] = await Promise.all([
    fetchKrakenBalance().catch(() => null),
    fetchKrakenOpenOrders().catch(() => null),
    fetchKrakenTradeHistory().catch(() => null),
    fetchKrakenTicker(config.tradingPair).catch(() => null),
  ]);

  return {
    balance: balance || {},
    openOrders: orders?.length ?? 0,
    recentTrades: trades?.length ?? 0,
    ticker: ticker ? { pair: ticker.pair, price: ticker.price } : null,
    cliStatus: getCliStatus(),
  };
}
