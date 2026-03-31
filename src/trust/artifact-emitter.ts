/**
 * Validation Artifact Emitter
 * Generates structured JSON artifacts for every trade decision
 * 
 * THIS IS ACTURA'S KEY DIFFERENTIATOR.
 * Every trade produces a full audit trail: what the strategy saw,
 * what the risk engine checked, and why the decision was made.
 */

import type { StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision } from '../risk/engine.js';
import { config } from '../agent/config.js';
import { buildTrustPolicyScorecard, type TrustPolicyScorecard } from './trust-policy-scorecard.js';
import type { MandateDecision } from '../chain/agent-mandate.js';
import type { OracleIntegrityResult } from '../security/oracle-integrity.js';
import type { ExecutionSimulationResult } from '../chain/execution-simulator.js';
import type { OperatorActionReceipt } from '../agent/operator-control.js';
import type { RoutingDecision } from '../chain/dex-router.js';
import { generateAttestationSummary } from '../security/tee-attestation.js';

export interface ValidationArtifact {
  version: string;
  agentName: string;
  agentId: number | null;
  timestamp: string;
  type: 'trade_checkpoint' | 'risk_halt' | 'position_close' | 'daily_summary';

  trade: {
    asset: string;
    side: string;
    size: number;
    sizeRaw: number;
    entryPrice: number;
    stopLossPrice: number | null;
    valueUsd: number;
  } | null;

  strategy: {
    name: string;
    signal: string;
    signalConfidence: number;
    signalReason: string;
    smaFast: number | null;
    smaSlow: number | null;
  };

  risk: {
    currentVolatility: number | null;
    baselineVolatility: number;
    volatilityRatio: number;
    volatilityRegime: string;
    positionSizeRaw: number;
    positionSizeAdjusted: number;
    stopLossPrice: number | null;
    dailyPnl: number;
    dailyPnlPct: number;
    maxDrawdownCurrent: number;
    circuitBreakerActive: boolean;
    circuitBreakerReason: string | null;
  };

  riskChecks: Array<{
    name: string;
    passed: boolean;
    value: string;
    limit: string;
  }>;

  decision: {
    approved: boolean;
    explanation: string;
  };

  // ── NEW: AI-powered explainability ──
  aiReasoning?: {
    marketContext: string;
    tradeRationale: string;
    riskNarrative: string;
    confidenceFactors: string[];
    watchItems: string[];
    summary: string;
  };

  // ── NEW: Market snapshot for reproducibility ──
  marketSnapshot?: {
    recentPrices: number[];     // Last 10 prices
    priceChange10: number;      // % change over 10 periods
    priceChange30: number;      // % change over 30 periods
    highLow: { high: number; low: number; range: number };
    trendStrength: number;      // 0-1 based on SMA separation
  };

  // ── NEW: Confidence interval ──
  confidenceInterval?: {
    expectedReturn: number;     // Expected trade PnL %
    bestCase: number;           // 90th percentile
    worstCase: number;          // 10th percentile
    maxLoss: number;            // Stop-loss triggered loss
    riskRewardRatio: number;    // reward/risk
  };

  mandate?: {
    approved: boolean;
    requiresHumanApproval: boolean;
    asset: string;
    protocol: string;
    reasons: string[];
    checks: Array<{ name: string; passed: boolean; value: string; limit: string }>;
  };

  oracleIntegrity?: {
    passed: boolean;
    status: string;
    deviationFromMedianPct: number;
    externalDeviationPct: number | null;
    singleBarMovePct: number;
    blockers: string[];
    reasons: string[];
  };

  executionSimulation?: {
    allowed: boolean;
    reason: string;
    estimatedFillPrice: number;
    estimatedSlippageBps: number;
    estimatedGasUsd: number;
    estimatedTotalCostUsd: number;
    expectedNetEdgePct: number;
    expectedWorstCasePct: number;
  };

  // ── NEW: Trust policy scorecard ──
  trustPolicyScorecard?: TrustPolicyScorecard;
  reputation?: {
    trustTier: string;
    capitalMultiplier: number;
    capitalLimitPct: number;
    trustDelta: number;
    recoveryMode?: boolean;
    recoveryStreak?: number;
    recoveryRequired?: number;
  };

  // ── NEW: Supervisory meta-agent receipt ──
  supervisory?: {
    status: string;
    canTrade: boolean;
    trustTier: string;
    trustScore: number | null;
    capitalMultiplier: number;
    capitalLimitPct: number;
    reason: string[];
    restrictions: string[];
  };

  operatorControl?: {
    mode: string;
    canTrade: boolean;
    lastUpdatedAt: string | null;
    lastReason: string | null;
    latestAction?: OperatorActionReceipt | null;
  };

  dexRouting?: {
    selectedDex: string;
    savingsBps: number;
    rationale: string[];
    quotes: Array<{
      dex: string;
      estimatedFeeBps: number;
      estimatedSlippageBps: number;
      estimatedTotalCostBps: number;
      available: boolean;
    }>;
    routingVersion: string;
    aerodromeNote?: string;
  };

  signatureCapability?: {
    eip1271: boolean;
    eoaVerification: boolean;
    typedDataVerification: boolean;
    note: string;
  };

  teeAttestation?: {
    type: string;
    agentAddress: string;
    measurementHash: string;
    codeHash: string;
    gitCommit: string;
    nonce: string;
    timestamp: string;
    signature: string;
    valid: boolean;
  };

}

let artifactCounter = 0;

/**
 * Build a validation artifact from strategy + risk outputs
 */
export function buildTradeArtifact(
  strategyOutput: StrategyOutput,
  riskDecision: RiskDecision,
  agentId: number | null = null
): ValidationArtifact {
  artifactCounter++;

  const tradeValue = riskDecision.finalPositionSize * strategyOutput.currentPrice;

  const artifact: ValidationArtifact = {
    version: '1.0',
    agentName: config.agentName,
    agentId,
    timestamp: riskDecision.timestamp,
    type: riskDecision.approved ? 'trade_checkpoint' : (riskDecision.circuitBreaker.active ? 'risk_halt' : 'trade_checkpoint'),

    trade: riskDecision.approved ? {
      asset: config.tradingPair,
      side: strategyOutput.signal.direction,
      size: riskDecision.finalPositionSize,
      sizeRaw: strategyOutput.positionSizeRaw,
      entryPrice: strategyOutput.currentPrice,
      stopLossPrice: riskDecision.stopLossPrice,
      valueUsd: tradeValue,
    } : null,

    strategy: {
      name: 'VolAdjMomentum',
      signal: strategyOutput.signal.name,
      signalConfidence: strategyOutput.signal.confidence,
      signalReason: strategyOutput.signal.reason,
      smaFast: strategyOutput.indicators.smaFast,
      smaSlow: strategyOutput.indicators.smaSlow,
    },

    risk: {
      currentVolatility: riskDecision.volatility.current,
      baselineVolatility: riskDecision.volatility.baseline,
      volatilityRatio: riskDecision.volatility.ratio,
      volatilityRegime: riskDecision.volatility.regime,
      positionSizeRaw: strategyOutput.positionSizeRaw,
      positionSizeAdjusted: riskDecision.finalPositionSize,
      stopLossPrice: riskDecision.stopLossPrice,
      dailyPnl: riskDecision.circuitBreaker.dailyPnl,
      dailyPnlPct: riskDecision.circuitBreaker.dailyPnlPct,
      maxDrawdownCurrent: riskDecision.circuitBreaker.drawdownPct,
      circuitBreakerActive: riskDecision.circuitBreaker.active,
      circuitBreakerReason: riskDecision.circuitBreaker.reason,
    },

    riskChecks: riskDecision.checks.map(c => ({
      name: c.name,
      passed: c.passed,
      value: String(c.value),
      limit: String(c.limit),
    })),

    decision: {
      approved: riskDecision.approved,
      explanation: riskDecision.explanation,
    },
  };

  artifact.trustPolicyScorecard = buildTrustPolicyScorecard({
    agentId,
    actionId: `artifact-${artifactCounter}`,
    timestamp: artifact.timestamp,
    strategyOutput,
    riskDecision,
    artifact,
    stage: 'pre_execution',
  });

  if (artifact.trustPolicyScorecard) {
    artifact.reputation = {
      trustTier: artifact.trustPolicyScorecard.trustTier,
      capitalMultiplier: artifact.trustPolicyScorecard.capitalMultiplier,
      capitalLimitPct: artifact.trustPolicyScorecard.capitalLimitPct,
      trustDelta: artifact.trustPolicyScorecard.trustDelta,
      recoveryMode: artifact.trustPolicyScorecard.recoveryMode,
      recoveryStreak: artifact.trustPolicyScorecard.recoveryStreak,
      recoveryRequired: artifact.trustPolicyScorecard.recoveryRequired,
    };
  }

  return artifact;
}

/**
 * Build a daily summary artifact
 */
export function buildDailySummaryArtifact(
  capital: number,
  trades: number,
  pnl: number,
  sharpe: number | null,
  agentId: number | null = null
): ValidationArtifact {
  const artifact: ValidationArtifact = {
    version: '1.0',
    agentName: config.agentName,
    agentId,
    timestamp: new Date().toISOString(),
    type: 'daily_summary',
    trade: null,
    strategy: {
      name: 'VolAdjMomentum',
      signal: 'DAILY_SUMMARY',
      signalConfidence: 0,
      signalReason: `End of day summary. ${trades} trades executed.`,
      smaFast: null,
      smaSlow: null,
    },
    risk: {
      currentVolatility: null,
      baselineVolatility: config.strategy.baselineVolatility,
      volatilityRatio: 0,
      volatilityRegime: 'n/a',
      positionSizeRaw: 0,
      positionSizeAdjusted: 0,
      stopLossPrice: null,
      dailyPnl: pnl,
      dailyPnlPct: capital > 0 ? pnl / capital : 0,
      maxDrawdownCurrent: 0,
      circuitBreakerActive: false,
      circuitBreakerReason: null,
    },
    riskChecks: [],
    decision: {
      approved: false,
      explanation: `Daily summary: ${trades} trades, PnL: $${pnl.toFixed(2)}, Sharpe: ${sharpe?.toFixed(2) ?? 'N/A'}`,
    },
  };

  artifact.trustPolicyScorecard = buildTrustPolicyScorecard({
    agentId,
    actionId: `daily-summary-${Date.now()}`,
    timestamp: artifact.timestamp,
    artifact,
    outcome: { pnlUsd: pnl, pnlPct: capital > 0 ? pnl / capital : 0 },
    stage: 'daily_summary',
  });

  if (artifact.trustPolicyScorecard) {
    artifact.reputation = {
      trustTier: artifact.trustPolicyScorecard.trustTier,
      capitalMultiplier: artifact.trustPolicyScorecard.capitalMultiplier,
      capitalLimitPct: artifact.trustPolicyScorecard.capitalLimitPct,
      trustDelta: artifact.trustPolicyScorecard.trustDelta,
      recoveryMode: artifact.trustPolicyScorecard.recoveryMode,
      recoveryStreak: artifact.trustPolicyScorecard.recoveryStreak,
      recoveryRequired: artifact.trustPolicyScorecard.recoveryRequired,
    };
  }

  return artifact;
}


export async function attachGovernanceEvidence(
  artifact: ValidationArtifact,
  extras: {
    mandateDecision?: MandateDecision | null;
    oracleIntegrity?: OracleIntegrityResult | null;
    executionSimulation?: ExecutionSimulationResult | null;
    operatorControl?: { mode: string; canTrade: boolean; lastUpdatedAt: string | null; lastReason: string | null; latestAction?: OperatorActionReceipt | null } | null;
    dexRouting?: RoutingDecision | null;
  }
): Promise<ValidationArtifact> {
  if (extras.mandateDecision) {
    artifact.mandate = {
      approved: extras.mandateDecision.approved,
      requiresHumanApproval: extras.mandateDecision.requiresHumanApproval,
      asset: extras.mandateDecision.normalizedAsset,
      protocol: extras.mandateDecision.normalizedProtocol,
      reasons: extras.mandateDecision.reasons,
      checks: extras.mandateDecision.checks.map((c) => ({ name: c.name, passed: c.passed, value: c.value, limit: c.limit })),
    };
  }
  if (extras.oracleIntegrity) {
    artifact.oracleIntegrity = {
      passed: extras.oracleIntegrity.passed,
      status: extras.oracleIntegrity.status,
      deviationFromMedianPct: extras.oracleIntegrity.deviationFromMedianPct,
      externalDeviationPct: extras.oracleIntegrity.externalDeviationPct,
      singleBarMovePct: extras.oracleIntegrity.singleBarMovePct,
      blockers: extras.oracleIntegrity.blockers,
      reasons: extras.oracleIntegrity.reasons,
    };
  }
  if (extras.executionSimulation) {
    artifact.executionSimulation = {
      allowed: extras.executionSimulation.allowed,
      reason: extras.executionSimulation.reason,
      estimatedFillPrice: extras.executionSimulation.estimatedFillPrice,
      estimatedSlippageBps: extras.executionSimulation.estimatedSlippageBps,
      estimatedGasUsd: extras.executionSimulation.estimatedGasUsd,
      estimatedTotalCostUsd: extras.executionSimulation.estimatedTotalCostUsd,
      expectedNetEdgePct: extras.executionSimulation.expectedNetEdgePct,
      expectedWorstCasePct: extras.executionSimulation.expectedWorstCasePct,
    };
  }
  if (extras.operatorControl) {
    artifact.operatorControl = { ...extras.operatorControl };
  }
  if (extras.dexRouting) {
    const quotes = extras.dexRouting.quotes ?? [];
    const aeroQuote = quotes.find(q => q.dex === 'aerodrome');
    artifact.dexRouting = {
      selectedDex: extras.dexRouting.selectedDex,
      savingsBps: extras.dexRouting.savingsBps,
      rationale: extras.dexRouting.rationale,
      quotes: quotes.map(q => ({
        dex: q.dex,
        estimatedFeeBps: q.estimatedFeeBps,
        estimatedSlippageBps: q.estimatedSlippageBps,
        estimatedTotalCostBps: q.estimatedTotalCostBps,
        available: q.available,
      })),
      routingVersion: extras.dexRouting.routingVersion,
      aerodromeNote: aeroQuote && !aeroQuote.available
        ? 'Aerodrome Finance is integrated as the primary DEX for Base mainnet (deepest liquidity, lowest fees). On Base Sepolia testnet, Aerodrome contracts are not deployed — the router automatically falls back to Uniswap V3. This is by design, not a limitation.'
        : undefined,
    };
  }

  // Always stamp EIP-1271 signature capability
  artifact.signatureCapability = {
    eip1271: true,
    eoaVerification: true,
    typedDataVerification: true,
    note: 'Agent supports EIP-1271 smart-contract signature verification for both EOA and contract wallets (multisigs, AA). Operator commands and cross-agent messages can be cryptographically verified.',
  };

  // Generate TEE attestation for this artifact
  try {
    artifact.teeAttestation = await generateAttestationSummary();
  } catch {
    // Non-fatal: attestation is best-effort
  }

  return artifact;
}

/** Get artifact count */
export function getArtifactCount(): number {
  return artifactCounter;
}

/** Reset counter (for testing) */
export function resetArtifactCounter(): void {
  artifactCounter = 0;
}

/**
 * Enrich an artifact with AI reasoning, market snapshot, and confidence intervals
 * Called after the base artifact is built, adds the differentiating data
 */
export function enrichArtifact(
  artifact: ValidationArtifact,
  aiReasoning: { marketContext: string; tradeRationale: string; riskNarrative: string; confidenceFactors: string[]; watchItems: string[]; summary: string } | null,
  recentPrices: number[],
): ValidationArtifact {
  // Market snapshot
  const last10 = recentPrices.slice(-10);
  const last30 = recentPrices.slice(-30);
  const allPrices = recentPrices.slice(-60);

  const priceChange10 = last10.length >= 2
    ? (last10[last10.length - 1] - last10[0]) / last10[0] * 100
    : 0;
  const priceChange30 = last30.length >= 2
    ? (last30[last30.length - 1] - last30[0]) / last30[0] * 100
    : 0;

  const high = Math.max(...allPrices);
  const low = Math.min(...allPrices);

  // Trend strength from SMA separation
  const smaFast = artifact.strategy.smaFast;
  const smaSlow = artifact.strategy.smaSlow;
  const trendStrength = smaFast && smaSlow
    ? Math.min(1, Math.abs(smaFast - smaSlow) / smaSlow * 10)
    : 0;

  artifact.marketSnapshot = {
    recentPrices: last10.map(p => Math.round(p * 100) / 100),
    priceChange10: Math.round(priceChange10 * 100) / 100,
    priceChange30: Math.round(priceChange30 * 100) / 100,
    highLow: { high: Math.round(high * 100) / 100, low: Math.round(low * 100) / 100, range: Math.round((high - low) * 100) / 100 },
    trendStrength: Math.round(trendStrength * 100) / 100,
  };

  // Confidence interval (based on volatility and stop-loss)
  if (artifact.trade && artifact.risk.currentVolatility) {
    const vol = artifact.risk.currentVolatility;
    const price = artifact.trade.entryPrice;
    const stopDist = artifact.trade.stopLossPrice
      ? Math.abs(price - artifact.trade.stopLossPrice) / price * 100
      : vol * 100 * 1.5;

    const expectedReturn = artifact.trade.side === 'LONG'
      ? priceChange10 * 0.3  // Momentum factor
      : -priceChange10 * 0.3;

    const bestCase = expectedReturn + vol * 100 * 1.3;   // ~90th percentile
    const worstCase = expectedReturn - vol * 100 * 1.3;  // ~10th percentile
    const maxLoss = -stopDist;
    const potentialGain = Math.abs(bestCase);
    const riskRewardRatio = stopDist > 0 ? potentialGain / stopDist : 0;

    artifact.confidenceInterval = {
      expectedReturn: Math.round(expectedReturn * 100) / 100,
      bestCase: Math.round(bestCase * 100) / 100,
      worstCase: Math.round(worstCase * 100) / 100,
      maxLoss: Math.round(maxLoss * 100) / 100,
      riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
    };
  }

  // AI reasoning
  if (aiReasoning) {
    artifact.aiReasoning = aiReasoning;
  }

  return artifact;
}
