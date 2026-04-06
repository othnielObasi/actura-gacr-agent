
/**
 * Rich MCP Tool Surface for Actura
 * Public tools expose read-only risk, trust, validation, performance, and explainability.
 * Restricted tools generate governed trade proposals.
 * Operator tools allow supervised runtime intervention.
 */

import { ethers } from 'ethers';
import { getAgentState } from '../agent/index.js';
import { getCheckpoint, getCheckpoints, getLastCheckpoint, getTradeCheckpoints } from '../trust/checkpoint.js';
import { getLastTrustScore, getTrustHistory } from '../trust/trust-policy-scorecard.js';
import { getDefaultMandate } from '../chain/agent-mandate.js';
import { computeRiskAdjustedMetrics, type EquityPoint, type TradeOutcome } from '../analytics/performance-metrics.js';
import { getAdaptiveParams, getAdaptationSummary, getContextStats } from '../strategy/adaptive-learning.js';
import { emergencyStop, getLatestOperatorAction, getOperatorActionReceipts, getOperatorControlState, pauseTrading, resumeTrading } from '../agent/operator-control.js';
import { getRecentTrades, getTradeStats } from '../agent/trade-log.js';
import { config } from '../agent/config.js';
import { buildTradeIntent, hashTradeIntent, signTradeIntent } from '../chain/intent.js';
import { initChain } from '../chain/sdk.js';
import { routeTrade, getAvailableDexes, getDexProfile, type DexId } from '../chain/dex-router.js';
import { fetchKrakenTicker, getKrakenFeedStatus, fetchKrakenBalance, fetchKrakenOpenOrders, fetchKrakenTradeHistory } from '../data/kraken-feed.js';
import { getCliStatus, checkCliHealth, placeMarketOrder, placeLimitOrder, cancelOrder, cancelAllOrders, getBalanceViaCli } from '../data/kraken-cli.js';
import { getKrakenAccountSnapshot } from '../data/kraken-bridge.js';
import { getIndexedEvents, getIndexerStatus } from '../chain/event-indexer.js';

export type McpVisibility = 'public' | 'restricted' | 'operator';

export interface McpTool {
  name: string;
  description: string;
  category: 'market' | 'governance' | 'trust' | 'validation' | 'operator' | 'execution' | 'performance';
  visibility: McpVisibility;
  inputSchema: object;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

function safeState() {
  return getAgentState();
}

function safeCheckpoints(limit = 20) {
  return getCheckpoints(limit) || [];
}

function buildApproximateEquitySeries(): { equityPoints: EquityPoint[]; trades: TradeOutcome[] } {
  const state = safeState();
  const currentCapital = state?.risk?.capital ?? 0;
  const recentPnl = Array.isArray(state?.risk?.recentPnl) ? state.risk.recentPnl : [];
  const points: EquityPoint[] = [];
  const trades: TradeOutcome[] = [];
  let rollingCapital = currentCapital - recentPnl.reduce((acc: number, p: any) => acc + (Number(p?.pnl) || 0), 0);
  const startTime = new Date(Date.now() - (recentPnl.length + 1) * 60_000).toISOString();
  points.push({ timestamp: startTime, equity: Math.max(rollingCapital, 1) });

  for (const pnlRow of recentPnl) {
    const pnl = Number(pnlRow?.pnl) || 0;
    rollingCapital += pnl;
    points.push({
      timestamp: pnlRow?.timestamp || new Date().toISOString(),
      equity: Math.max(rollingCapital, 1),
    });
    trades.push({ pnl });
  }

  if (points.length === 1) {
    points.push({
      timestamp: new Date().toISOString(),
      equity: Math.max(currentCapital, 1),
    });
  }

  return { equityPoints: points, trades };
}

function checkpointSummary(cp: any) {
  if (!cp) return null;
  return {
    id: cp.id,
    timestamp: cp.timestamp,
    signal: cp.strategyOutput?.signal?.direction ?? null,
    confidence: cp.strategyOutput?.signal?.confidence ?? null,
    approved: cp.riskDecision?.approved ?? false,
    explanation: cp.riskDecision?.explanation ?? null,
    positionSize: cp.riskDecision?.finalPositionSize ?? null,
    stopLossPrice: cp.riskDecision?.stopLossPrice ?? null,
    receipt: cp.ipfs?.uri || null,
    txHash: cp.onChainTxHash || null,
  };
}

function buildCapitalRights(trustScore: number | null) {
  const score = trustScore ?? 0;
  if (score < 60) return { tier: 'TIER_0_BLOCKED', multiplier: 0 };
  if (score < 75) return { tier: 'TIER_1_PROBATION', multiplier: 0.25 };
  if (score < 85) return { tier: 'TIER_2_LIMITED', multiplier: 0.60 };
  if (score < 93) return { tier: 'TIER_3_STANDARD', multiplier: 1.00 };
  return { tier: 'TIER_4_EXPANDED', multiplier: 1.25 };
}

const getMarketState: McpTool = {
  name: 'get_market_state',
  description: 'Return current market and regime state from the runtime.',
  category: 'market',
  visibility: 'public',
  inputSchema: { type: 'object', properties: {} },
  handler: () => {
    const state = safeState();
    const market = state?.market;
    return {
      tradingPair: config.tradingPair,
      currentPrice: market?.currentPrice ?? null,
      priceChange24h: market?.priceChange24h ?? null,
      smaFast: market?.smaFast ?? null,
      smaSlow: market?.smaSlow ?? null,
      volatility: market?.volatility ?? null,
      atr: market?.atr ?? null,
      dataPoints: market?.dataPoints ?? 0,
      timestamp: market?.lastUpdate ?? null,
      running: state?.running ?? false,
    };
  },
};

const getTrustState: McpTool = {
  name: 'get_trust_state',
  description: 'Return current trust score, trust tier, and adaptive learning summary.',
  category: 'trust',
  visibility: 'public',
  inputSchema: { type: 'object', properties: {} },
  handler: () => {
    const score = getLastTrustScore(safeState()?.agentId ?? null);
    const rights = buildCapitalRights(score);
    return {
      trustScore: score,
      trustTier: rights.tier,
      capitalMultiplier: rights.multiplier,
      adaptiveParams: getAdaptiveParams(),
      adaptationSummary: getAdaptationSummary(),
      trustHistory: getTrustHistory(safeState()?.agentId ?? null, 10),
    };
  },
};

const getCapitalRights: McpTool = {
  name: 'get_capital_rights',
  description: 'Return current capital rights determined by trust and mandate constraints.',
  category: 'governance',
  visibility: 'public',
  inputSchema: { type: 'object', properties: {} },
  handler: () => {
    const state = safeState();
    const score = getLastTrustScore(state?.agentId ?? null);
    const rights = buildCapitalRights(score);
    const mandate = getDefaultMandate();
    return {
      trustScore: score,
      trustTier: rights.tier,
      capitalMultiplier: rights.multiplier,
      maxTradeSizePct: mandate.maxTradeSizePct,
      maxDailyLossPct: mandate.maxDailyLossPct,
      requireHumanApprovalAboveUsd: mandate.requireHumanApprovalAboveUsd,
      allowedAssets: mandate.allowedAssets,
      allowedProtocols: mandate.allowedProtocols,
    };
  },
};

const getMandateState: McpTool = {
  name: 'get_mandate_state',
  description: 'Return the active mandate and current operator/supervisory state.',
  category: 'governance',
  visibility: 'public',
  inputSchema: { type: 'object', properties: {} },
  handler: () => {
    const mandate = getDefaultMandate();
    return {
      mandate,
      operatorControl: getOperatorControlState(),
      latestOperatorAction: getLatestOperatorAction(),
      recentOperatorReceipts: getOperatorActionReceipts(5),
    };
  },
};

const getPositions: McpTool = {
  name: 'get_positions',
  description: 'Return open positions, exposure, and recent realized PnL rows.',
  category: 'performance',
  visibility: 'public',
  inputSchema: { type: 'object', properties: {} },
  handler: () => {
    const state = safeState();
    const risk = state?.risk;
    const capital = Number(risk?.capital ?? 0);
    const positions = Array.isArray(risk?.openPositions) ? risk.openPositions : [];
    const exposure = positions.reduce((sum: number, p: any) => sum + Math.abs((Number(p?.size) || 0) * (Number(p?.entryPrice) || 0)), 0);
    return {
      capital,
      totalPositions: positions.length,
      totalExposureUsd: Number(exposure.toFixed(2)),
      exposurePct: capital > 0 ? Number(((exposure / capital) * 100).toFixed(2)) : 0,
      openPositions: positions,
      recentPnl: risk?.recentPnl ?? [],
      totalTrades: risk?.totalTrades ?? 0,
    };
  },
};

const getPerformanceMetrics: McpTool = {
  name: 'get_performance_metrics',
  description: 'Compute risk-adjusted return metrics from the currently available runtime equity and trade history.',
  category: 'performance',
  visibility: 'public',
  inputSchema: { type: 'object', properties: {} },
  handler: () => {
    const { equityPoints, trades } = buildApproximateEquitySeries();
    const metrics = computeRiskAdjustedMetrics(equityPoints, trades, 0);
    return {
      ...metrics,
      equityPoints,
      tradeCount: trades.length,
      note: 'Metrics are computed from current runtime history and recent realized PnL rows.',
    };
  },
};

const explainTrade: McpTool = {
  name: 'explain_trade',
  description: 'Return the Trade Trust Proof for a selected trade or the latest trade if omitted.',
  category: 'validation',
  visibility: 'public',
  inputSchema: {
    type: 'object',
    properties: {
      trade_id: { type: 'number', description: 'Checkpoint/trade identifier to explain' },
    },
  },
  handler: (args) => {
    const cp = typeof args.trade_id === 'number' ? getCheckpoint(args.trade_id) : getLastCheckpoint();
    if (!cp) {
      return { error: 'No checkpoints available yet' };
    }
    const trustScore = getLastTrustScore(safeState()?.agentId ?? null);
    const rights = buildCapitalRights(trustScore);
    return {
      tradeId: cp.id,
      decision: cp.riskDecision.approved ? 'APPROVED' : 'BLOCKED',
      signalConfidence: cp.strategyOutput?.signal?.confidence ?? null,
      marketRegime: cp.artifact?.marketSnapshot?.trendStrength ?? null,
      volatilityProfile: cp.riskDecision?.volatility?.regime ?? null,
      currentPrice: cp.strategyOutput?.currentPrice ?? null,
      explanation: cp.riskDecision.explanation,
      checks: cp.riskDecision.checks,
      trustScore,
      trustTier: rights.tier,
      capitalMultiplier: rights.multiplier,
      artifact: {
        receipt: cp.ipfs?.uri || null,
        txHash: cp.onChainTxHash || null,
        confidenceInterval: cp.artifact?.confidenceInterval || null,
        aiReasoning: cp.artifact?.aiReasoning || null,
      },
    };
  },
};

const getValidationStatusTool: McpTool = {
  name: 'get_validation_status',
  description: 'Return local validation status for a trade and whether live registry validation is configured.',
  category: 'validation',
  visibility: 'public',
  inputSchema: {
    type: 'object',
    properties: {
      trade_id: { type: 'number', description: 'Checkpoint/trade identifier' },
    },
  },
  handler: (args) => {
    const cp = typeof args.trade_id === 'number' ? getCheckpoint(args.trade_id) : getLastCheckpoint();
    if (!cp) {
      return { error: 'No trade checkpoint found' };
    }
    return {
      tradeId: cp.id,
      approved: cp.riskDecision.approved,
      receiptUri: cp.ipfs?.uri || null,
      txHash: cp.onChainTxHash || null,
      validationRegistryConfigured: Boolean(config.validationRegistry),
      validatorConfigured: Boolean(config.validatorAddress),
      localChecks: cp.riskDecision.checks,
      latestCheckpoint: checkpointSummary(cp),
    };
  },
};

const getReputationSummaryTool: McpTool = {
  name: 'get_reputation_summary',
  description: 'Return local trust/reputation summary and adapter readiness.',
  category: 'trust',
  visibility: 'public',
  inputSchema: { type: 'object', properties: {} },
  handler: () => {
    const score = getLastTrustScore(safeState()?.agentId ?? null);
    const history = getTrustHistory(safeState()?.agentId ?? null, 20);
    return {
      trustScore: score,
      trustHistoryCount: history.length,
      reputationRegistryConfigured: Boolean(config.reputationRegistry),
      preferredReviewerAddresses: config.preferredReviewerAddresses,
      latestFeedbackTag: history.length ? (history[history.length - 1] as any).outcomeContext?.validationTag || null : null,
    };
  },
};

const proposeTrade: McpTool = {
  name: 'propose_trade',
  description: 'Create a governed trade proposal without submitting it.',
  category: 'execution',
  visibility: 'restricted',
  inputSchema: {
    type: 'object',
    properties: {
      market: { type: 'string', description: 'Market symbol such as WETH/USDC' },
      side: { type: 'string', enum: ['LONG', 'SHORT'], description: 'Requested direction' },
      size_hint_pct: { type: 'number', description: 'Optional position size hint as % of capital' },
      asset_address: { type: 'string', description: 'Optional asset address for on-chain intent preview' },
    },
  },
  handler: async (args) => {
    const state = safeState();
    const market = state?.market;
    const trustScore = getLastTrustScore(state?.agentId ?? null);
    const rights = buildCapitalRights(trustScore);
    const mandate = getDefaultMandate();
    const capital = Number(state?.risk?.capital ?? 0);
    const side = args.side === 'SHORT' ? 'SHORT' : 'LONG';
    const hint = typeof args.size_hint_pct === 'number' ? Math.max(0, args.size_hint_pct) / 100 : 0.02;
    const governedPct = Math.min(hint * rights.multiplier, mandate.maxTradeSizePct);
    const status = !market ? 'BLOCKED' : rights.multiplier <= 0 ? 'BLOCKED' : getOperatorControlState().canTrade ? 'APPROVED' : 'BLOCKED';
    return {
      status,
      market: String(args.market || config.tradingPair),
      side,
      currentPrice: market?.currentPrice ?? null,
      trustScore,
      trustTier: rights.tier,
      governedSizePct: governedPct,
      notionalUsd: Number((capital * governedPct).toFixed(2)),
      rationale: [
        status === 'APPROVED' ? 'runtime permits proposal' : 'proposal blocked by runtime state',
        `capital rights multiplier ${rights.multiplier.toFixed(2)}x`,
        `max mandate trade size ${(mandate.maxTradeSizePct * 100).toFixed(2)}%`,
      ],
      adaptiveSummary: getAdaptationSummary(),
      contextStats: getContextStats({ regime: (market?.volatility ?? 0) > 0.03 ? 'high' : 'normal', direction: side }),
      assetAddress: typeof args.asset_address === 'string' ? args.asset_address : ethers.ZeroAddress,
    };
  },
};

const executeTrade: McpTool = {
  name: 'execute_trade',
  description: 'Build and optionally sign a router-compatible TradeIntent. Does not bypass the runtime.',
  category: 'execution',
  visibility: 'restricted',
  inputSchema: {
    type: 'object',
    properties: {
      pair: { type: 'string', description: 'Trading pair e.g. XBTUSD' },
      action: { type: 'string', enum: ['BUY', 'SELL'] },
      amount_usd: { type: 'number', description: 'Trade amount in USD' },
      slippage_bps: { type: 'number', description: 'Max slippage in basis points' },
      deadline_seconds: { type: 'number', description: 'Intent deadline in seconds from now' },
      sign_intent: { type: 'boolean', description: 'Whether to sign the intent if wallet is configured' },
    },
    required: ['pair', 'action', 'amount_usd'],
  },
  handler: async (args) => {
    const agentId = config.agentId ?? 0;
    const intent = buildTradeIntent({
      agentId,
      pair: String(args.pair || 'XBTUSD'),
      action: args.action === 'SELL' ? 'SELL' : 'BUY',
      amountUsd: typeof args.amount_usd === 'number' ? args.amount_usd : 100,
      slippageBps: typeof args.slippage_bps === 'number' ? args.slippage_bps : 100,
      deadlineSeconds: typeof args.deadline_seconds === 'number' ? args.deadline_seconds : 300,
      nonce: 0n,
    });

    const hash = hashTradeIntent(intent);
    const signRequested = Boolean(args.sign_intent);
    const walletReady = Boolean(config.privateKey && config.riskRouterAddress);

    if (!signRequested || !walletReady) {
      return {
        status: walletReady ? 'READY_FOR_SIGNING' : 'PREVIEW_ONLY',
        hash,
        intent,
        routerConfigured: Boolean(config.riskRouterAddress),
        note: walletReady ? 'Set sign_intent=true to sign this TradeIntent' : 'Wallet and router must be configured for signing',
      };
    }

    initChain();
    const signed = await signTradeIntent(intent);
    return {
      status: 'SIGNED',
      hash,
      domain: signed.domain,
      intent: signed.intent,
      signature: signed.signature,
    };
  },
};

const pauseAgent: McpTool = {
  name: 'pause_agent',
  description: 'Pause the runtime. Operator-only governance action.',
  category: 'operator',
  visibility: 'operator',
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
      actor: { type: 'string' },
    },
  },
  handler: (args) => pauseTrading(String(args.reason || 'mcp pause request'), String(args.actor || 'mcp-operator')),
};

const resumeAgent: McpTool = {
  name: 'resume_agent',
  description: 'Resume the runtime. Operator-only governance action.',
  category: 'operator',
  visibility: 'operator',
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
      actor: { type: 'string' },
    },
  },
  handler: (args) => resumeTrading(String(args.reason || 'mcp resume request'), String(args.actor || 'mcp-operator')),
};

const emergencyStopAgent: McpTool = {
  name: 'emergency_stop',
  description: 'Immediately stop all trading. Operator-only governance action.',
  category: 'operator',
  visibility: 'operator',
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
      actor: { type: 'string' },
    },
  },
  handler: (args) => emergencyStop(String(args.reason || 'mcp emergency stop'), String(args.actor || 'mcp-operator')),
};

const getTradeHistory: McpTool = {
  name: 'get_trade_history',
  description: 'Return closed trade history and aggregate statistics from the persistent trade log.',
  category: 'performance',
  visibility: 'public',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max trades to return (default 50)' },
    },
  },
  handler: (args) => {
    const limit = typeof args.limit === 'number' ? Math.min(args.limit, 500) : 50;
    return {
      stats: getTradeStats(),
      trades: getRecentTrades(limit),
    };
  },
};

const getDexRoutingInfo: McpTool = {
  name: 'get_dex_routing',
  description: 'Return DEX routing information: available venues, fee profiles, and a sample best-execution quote for the current market state.',
  category: 'execution',
  visibility: 'public',
  inputSchema: {
    type: 'object',
    properties: {
      notional_usd: { type: 'number', description: 'Trade notional in USD for quote estimation (default: 300)' },
      side: { type: 'string', description: 'LONG or SHORT (default: LONG)' },
    },
  },
  handler: async (args) => {
    const state = safeState();
    const market = state?.market;
    const notionalUsd = typeof args.notional_usd === 'number' ? args.notional_usd : 300;
    const side = args.side === 'SHORT' ? 'SHORT' : 'LONG';
    const isTestnet = config.chainId === 84532;
    const enabledDexes = config.allowedProtocols.filter(
      (p): p is DexId => p === 'aerodrome' || p === 'uniswap'
    );

    const routing = await routeTrade({
      asset: config.tradingPair,
      side: side as 'LONG' | 'SHORT',
      notionalUsd,
      volatility: market?.volatility ?? 0.02,
      isTestnet,
      enabledDexes,
    });

    return {
      network: isTestnet ? 'Base Sepolia (testnet)' : 'Base',
      enabledProtocols: config.allowedProtocols,
      availableDexes: getAvailableDexes(isTestnet),
      selectedDex: routing.selectedDex,
      selectedDexProfile: getDexProfile(routing.selectedDex),
      savingsBps: routing.savingsBps,
      rationale: routing.rationale,
      quotes: routing.quotes,
      timestamp: routing.timestamp,
    };
  },
};

const getKrakenMarketTool: McpTool = {
  name: 'get_kraken_market',
  description: 'Return current Kraken market data: live ticker (price, bid/ask, volume, VWAP) and feed health status.',
  category: 'market',
  visibility: 'public',
  inputSchema: {
    type: 'object',
    properties: {
      pair: { type: 'string', description: 'Trading pair (default: WETH/USDC). Supports ETH/USD, BTC/USD.' },
    },
  },
  handler: async (args) => {
    const pair = typeof args.pair === 'string' ? args.pair : 'WETH/USDC';
    const ticker = await fetchKrakenTicker(pair);
    return {
      status: getKrakenFeedStatus(),
      ticker,
      note: ticker
        ? `Kraken ${pair}: $${ticker.price.toFixed(2)} (spread: $${ticker.spread.toFixed(2)}, vol24h: ${ticker.volume24h.toFixed(2)})`
        : 'Kraken feed unavailable — using CoinGecko/DeFiLlama fallback',
    };
  },
};

const getIndexedEventsTool: McpTool = {
  name: 'get_indexed_events',
  description: 'Return on-chain events from ERC-8004 registries (reputation feedback, validation requests/responses) indexed by the agent.',
  category: 'validation',
  visibility: 'public',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max events to return (default: 20)' },
      type: { type: 'string', description: 'Filter by event type: reputation_feedback, validation_request, validation_response' },
    },
  },
  handler: (args) => {
    const limit = typeof args.limit === 'number' ? Math.min(args.limit, 200) : 20;
    const validTypes = ['reputation_feedback', 'validation_request', 'validation_response'];
    const typeFilter = typeof args.type === 'string' && validTypes.includes(args.type)
      ? args.type as 'reputation_feedback' | 'validation_request' | 'validation_response'
      : undefined;
    const events = typeFilter ? getIndexedEvents(typeFilter) : getIndexedEvents();
    return {
      indexer: getIndexerStatus(),
      events: events.slice(-limit),
      count: events.length,
    };
  },
};

const getKrakenBalanceTool: McpTool = {
  name: 'get_kraken_balance',
  description: 'Return the Kraken account balance (requires KRAKEN_API_KEY). Shows all non-zero asset balances.',
  category: 'market',
  visibility: 'restricted',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const balance = await fetchKrakenBalance();
    if (!balance) return { error: 'Kraken API keys not configured or request failed' };
    const nonZero = Object.fromEntries(Object.entries(balance).filter(([, v]) => parseFloat(v) > 0));
    return {
      balance: nonZero,
      assetCount: Object.keys(nonZero).length,
      note: Object.entries(nonZero).map(([k, v]) => `${k}: ${v}`).join(', ') || 'No balances',
    };
  },
};

const getKrakenOrdersTool: McpTool = {
  name: 'get_kraken_orders',
  description: 'Return open orders on the Kraken account (requires KRAKEN_API_KEY).',
  category: 'market',
  visibility: 'restricted',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const orders = await fetchKrakenOpenOrders();
    if (!orders) return { error: 'Kraken API keys not configured or request failed' };
    return {
      count: orders.length,
      orders,
      note: orders.length === 0 ? 'No open orders' : `${orders.length} open order(s)`,
    };
  },
};

const getKrakenTradesTool: McpTool = {
  name: 'get_kraken_trades',
  description: 'Return recent trade history from the Kraken account (requires KRAKEN_API_KEY).',
  category: 'market',
  visibility: 'restricted',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const trades = await fetchKrakenTradeHistory();
    if (!trades) return { error: 'Kraken API keys not configured or request failed' };
    return {
      count: trades.length,
      trades: trades.slice(0, 50),
      note: `${trades.length} trade(s) in history`,
    };
  },
};

// ── Kraken CLI Execution Tools ──

const getKrakenCliStatus: McpTool = {
  name: 'get_kraken_cli_status',
  description: 'Check if the Kraken CLI binary is installed and healthy. Shows version, paper trading mode, and API key status.',
  category: 'market',
  visibility: 'public',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const status = await checkCliHealth();
    return status;
  },
};

const getKrakenSnapshot: McpTool = {
  name: 'get_kraken_snapshot',
  description: 'Get a complete Kraken account snapshot: balance, open orders, recent trades, live ticker, and CLI status.',
  category: 'market',
  visibility: 'restricted',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    return getKrakenAccountSnapshot();
  },
};

const krakenMarketOrder: McpTool = {
  name: 'kraken_market_order',
  description: 'Place a market order via Kraken CLI. Respects paper trading mode. Use this for immediate execution.',
  category: 'execution',
  visibility: 'restricted',
  inputSchema: {
    type: 'object',
    properties: {
      pair: { type: 'string', description: 'Trading pair (e.g. WETH/USDC, BTC/USD)' },
      side: { type: 'string', enum: ['buy', 'sell'], description: 'Order side' },
      volume: { type: 'string', description: 'Order volume in base asset units' },
      validate_only: { type: 'boolean', description: 'Dry run — validate without placing' },
      stop_loss_price: { type: 'string', description: 'Optional stop-loss price' },
    },
    required: ['pair', 'side', 'volume'],
  },
  handler: async (args) => {
    return placeMarketOrder(
      String(args.pair),
      args.side === 'sell' ? 'sell' : 'buy',
      String(args.volume),
      {
        validateOnly: args.validate_only === true,
        stopLossPrice: args.stop_loss_price ? String(args.stop_loss_price) : undefined,
      }
    );
  },
};

const krakenLimitOrder: McpTool = {
  name: 'kraken_limit_order',
  description: 'Place a limit order via Kraken CLI at a specified price.',
  category: 'execution',
  visibility: 'restricted',
  inputSchema: {
    type: 'object',
    properties: {
      pair: { type: 'string', description: 'Trading pair (e.g. WETH/USDC, BTC/USD)' },
      side: { type: 'string', enum: ['buy', 'sell'], description: 'Order side' },
      volume: { type: 'string', description: 'Order volume in base asset units' },
      price: { type: 'string', description: 'Limit price' },
      validate_only: { type: 'boolean', description: 'Dry run — validate without placing' },
    },
    required: ['pair', 'side', 'volume', 'price'],
  },
  handler: async (args) => {
    return placeLimitOrder(
      String(args.pair),
      args.side === 'sell' ? 'sell' : 'buy',
      String(args.volume),
      String(args.price),
      { validateOnly: args.validate_only === true }
    );
  },
};

const krakenCancelOrder: McpTool = {
  name: 'kraken_cancel_order',
  description: 'Cancel an open Kraken order by transaction ID.',
  category: 'execution',
  visibility: 'restricted',
  inputSchema: {
    type: 'object',
    properties: {
      order_id: { type: 'string', description: 'Kraken order/transaction ID to cancel' },
    },
    required: ['order_id'],
  },
  handler: async (args) => {
    return cancelOrder(String(args.order_id));
  },
};

const krakenCancelAll: McpTool = {
  name: 'kraken_cancel_all',
  description: 'Cancel ALL open Kraken orders. Use with caution.',
  category: 'execution',
  visibility: 'operator',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    return cancelAllOrders();
  },
};

export const ALL_TOOLS: McpTool[] = [
  getMarketState,
  getTrustState,
  getCapitalRights,
  getMandateState,
  getDexRoutingInfo,
  getPositions,
  getPerformanceMetrics,
  getTradeHistory,
  explainTrade,
  getValidationStatusTool,
  getReputationSummaryTool,
  getKrakenMarketTool,
  getIndexedEventsTool,
  getKrakenBalanceTool,
  getKrakenOrdersTool,
  getKrakenTradesTool,
  proposeTrade,
  executeTrade,
  pauseAgent,
  resumeAgent,
  emergencyStopAgent,
  // Kraken CLI execution tools
  getKrakenCliStatus,
  getKrakenSnapshot,
  krakenMarketOrder,
  krakenLimitOrder,
  krakenCancelOrder,
  krakenCancelAll,
];
