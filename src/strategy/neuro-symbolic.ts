/**
 * Neuro-Symbolic Cognitive Layer
 * 
 * Sits between the strategy (neural/statistical) and risk engine:
 *   Market Data → Strategy Signal → [THIS LAYER] → Risk Engine → Execute
 * 
 * The strategy produces a raw signal (SMA crossover).
 * This layer applies symbolic reasoning rules that can:
 *   - Override the signal (LONG → NEUTRAL)
 *   - Adjust confidence up or down
 *   - Add context for the artifact
 * 
 * Rules are declarative, auditable, and logged in every artifact.
 * They encode trading wisdom that statistical signals miss:
 *   - "Don't go LONG after 3 consecutive LONG stop-losses"
 *   - "Reduce confidence in ranging markets"
 *   - "Never exceed 60% directional exposure"
 * 
 * This is NOT a black box. Every rule that fires is recorded.
 */

import { createLogger } from '../agent/logger.js';
import type { StrategyOutput } from './momentum.js';

const log = createLogger('NEURO-SYM');

// ── Types ──

export interface SymbolicRuleResult {
  ruleId: string;
  ruleName: string;
  fired: boolean;
  action: 'pass' | 'override_neutral' | 'reduce_confidence' | 'boost_confidence' | 'flip_direction';
  reason: string;
  confidenceAdjustment: number;  // Additive: -0.3 means subtract 0.3 from confidence
}

export interface CognitiveOutput {
  originalSignal: string;
  originalConfidence: number;
  adjustedSignal: string;
  adjustedConfidence: number;
  rulesEvaluated: number;
  rulesFired: number;
  ruleResults: SymbolicRuleResult[];
  override: boolean;
  overrideReason: string | null;
}

// ── Memory for pattern detection ──

interface TradeOutcome {
  direction: string;
  confidence: number;
  price: number;
  result: 'win' | 'loss' | 'open';
  timestamp: string;
}

const recentOutcomes: TradeOutcome[] = [];
const MAX_OUTCOMES = 50;

export function recordOutcome(outcome: TradeOutcome): void {
  recentOutcomes.push(outcome);
  if (recentOutcomes.length > MAX_OUTCOMES) recentOutcomes.shift();
}

// ── Symbolic Rules ──

type SymbolicRule = (
  signal: string,
  confidence: number,
  context: RuleContext
) => SymbolicRuleResult;

interface RuleContext {
  currentPrice: number;
  volatilityRegime: string;
  volatilityRatio: number;
  smaFast: number | null;
  smaSlow: number | null;
  atr: number | null;
  openPositions: Array<{ side: string; entryPrice: number }>;
  capital: number;
  drawdownPct: number;
  dailyPnlPct: number;
}

/**
 * Rule 1: Consecutive Loss Protection
 * If 3+ consecutive trades in the same direction hit stop-loss,
 * block the next signal in that direction.
 */
const consecutiveLossRule: SymbolicRule = (signal, confidence, ctx) => {
  const result: SymbolicRuleResult = {
    ruleId: 'R1', ruleName: 'consecutive_loss_protection',
    fired: false, action: 'pass', reason: '', confidenceAdjustment: 0,
  };

  const recent = recentOutcomes.slice(-5).filter(o => o.result === 'loss');
  const consecutiveSameDir = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].direction === signal) consecutiveSameDir.push(recent[i]);
    else break;
  }

  if (consecutiveSameDir.length >= 3) {
    result.fired = true;
    result.action = 'override_neutral';
    result.reason = `${consecutiveSameDir.length} consecutive ${signal} losses — blocking same-direction entry`;
    result.confidenceAdjustment = -confidence;  // Zero out
  }

  return result;
};

/**
 * Rule 2: Regime-Aware Confidence
 * In ranging/choppy markets (low SMA separation), reduce confidence.
 * In strong trends (high SMA separation), boost it.
 */
const regimeConfidenceRule: SymbolicRule = (signal, confidence, ctx) => {
  const result: SymbolicRuleResult = {
    ruleId: 'R2', ruleName: 'regime_confidence_adjustment',
    fired: false, action: 'pass', reason: '', confidenceAdjustment: 0,
  };

  if (!ctx.smaFast || !ctx.smaSlow) return result;

  const smaSeparation = Math.abs(ctx.smaFast - ctx.smaSlow) / ctx.smaSlow;

  if (smaSeparation < 0.005) {
    // Ranging — SMAs almost touching. Structure regime already applies a
    // 0.80 confidence multiplier for RANGING, so only apply a tiny nudge
    // here to avoid double-penalizing and killing all signals in chop.
    const penalty = 0.01; // minimal — structure regime handles the heavy lifting
    result.fired = true;
    result.action = 'reduce_confidence';
    result.reason = `SMA separation only ${(smaSeparation * 100).toFixed(2)}% — ranging market, minimal nudge (structure regime already penalizing)`;
    result.confidenceAdjustment = -penalty;
  } else if (smaSeparation > 0.03) {
    // Strong trend
    result.fired = true;
    result.action = 'boost_confidence';
    result.reason = `SMA separation ${(smaSeparation * 100).toFixed(2)}% — strong trend, boosting confidence`;
    result.confidenceAdjustment = 0.1;
  }

  return result;
};

/**
 * Rule 3: Directional Exposure Balance
 * If >60% of open positions are in one direction,
 * block new trades in that direction.
 */
const directionalBalanceRule: SymbolicRule = (signal, confidence, ctx) => {
  const result: SymbolicRuleResult = {
    ruleId: 'R3', ruleName: 'directional_exposure_balance',
    fired: false, action: 'pass', reason: '', confidenceAdjustment: 0,
  };

  if (signal === 'NEUTRAL' || ctx.openPositions.length < 3) return result;

  const sameDir = ctx.openPositions.filter(p => p.side === signal).length;
  const ratio = sameDir / ctx.openPositions.length;

  if (ratio > 0.6) {
    result.fired = true;
    result.action = 'reduce_confidence';
    result.reason = `${sameDir}/${ctx.openPositions.length} positions already ${signal} (${(ratio * 100).toFixed(0)}%) — reducing confidence to diversify`;
    result.confidenceAdjustment = -0.2;
  }

  return result;
};

/**
 * Rule 4: Volatility Spike Caution
 * If volatility just jumped (ratio > 1.5x but not extreme),
 * reduce confidence — the regime is changing.
 */
const volatilitySpikeRule: SymbolicRule = (signal, confidence, ctx) => {
  const result: SymbolicRuleResult = {
    ruleId: 'R4', ruleName: 'volatility_spike_caution',
    fired: false, action: 'pass', reason: '', confidenceAdjustment: 0,
  };

  if (ctx.volatilityRatio > 1.5 && ctx.volatilityRegime !== 'extreme') {
    result.fired = true;
    result.action = 'reduce_confidence';
    result.reason = `Volatility spike detected (${ctx.volatilityRatio.toFixed(2)}x baseline) — regime may be shifting`;
    result.confidenceAdjustment = -0.15;
  }

  return result;
};

/**
 * Rule 5: Drawdown Recovery Mode
 * If drawdown > 4% (half of circuit breaker threshold),
 * require higher confidence for new trades.
 */
const drawdownRecoveryRule: SymbolicRule = (signal, confidence, ctx) => {
  const result: SymbolicRuleResult = {
    ruleId: 'R5', ruleName: 'drawdown_recovery_mode',
    fired: false, action: 'pass', reason: '', confidenceAdjustment: 0,
  };

  if (ctx.drawdownPct > 0.04) {
    result.fired = true;
    result.action = 'reduce_confidence';
    result.reason = `Drawdown at ${(ctx.drawdownPct * 100).toFixed(1)}% — recovery mode, requiring higher confidence`;
    result.confidenceAdjustment = -0.2;
  }

  return result;
};

/**
 * Rule 6: Mean Reversion at Extremes
 * If price is >2 ATR from SMA50, the trend is overextended.
 * Reduce confidence for trend-following signals.
 */
const meanReversionRule: SymbolicRule = (signal, confidence, ctx) => {
  const result: SymbolicRuleResult = {
    ruleId: 'R6', ruleName: 'mean_reversion_at_extremes',
    fired: false, action: 'pass', reason: '', confidenceAdjustment: 0,
  };

  if (!ctx.smaSlow || !ctx.atr) return result;

  const distFromSma = Math.abs(ctx.currentPrice - ctx.smaSlow);
  const atrMultiple = distFromSma / ctx.atr;

  if (atrMultiple > 3.5) {
    const overextendedDir = ctx.currentPrice > ctx.smaSlow ? 'LONG' : 'SHORT';
    if (signal === overextendedDir) {
      result.fired = true;
      result.action = 'reduce_confidence';
      result.reason = `Price ${atrMultiple.toFixed(1)}x ATR from SMA50 — trend overextended, reducing ${signal} confidence`;
      result.confidenceAdjustment = -0.06;
    }
  }

  return result;
};

// ── All Rules ──
const ALL_RULES: SymbolicRule[] = [
  consecutiveLossRule,
  regimeConfidenceRule,
  directionalBalanceRule,
  volatilitySpikeRule,
  drawdownRecoveryRule,
  meanReversionRule,
];

/**
 * Apply neuro-symbolic reasoning to a strategy output.
 * Returns the adjusted signal/confidence with full audit trail.
 */
export function applySymbolicReasoning(
  strategyOutput: StrategyOutput,
  openPositions: Array<{ side: string; entryPrice: number }>,
  capital: number,
  drawdownPct: number,
  dailyPnlPct: number,
): CognitiveOutput {
  const signal = strategyOutput.signal.direction;
  const confidence = strategyOutput.signal.confidence;

  const context: RuleContext = {
    currentPrice: strategyOutput.currentPrice,
    volatilityRegime: strategyOutput.indicators.volatility
      ? (strategyOutput.indicators.volatility > 0.04 ? 'extreme' :
         strategyOutput.indicators.volatility > 0.03 ? 'high' :
         strategyOutput.indicators.volatility < 0.01 ? 'low' : 'normal')
      : 'normal',
    volatilityRatio: strategyOutput.indicators.volatility
      ? strategyOutput.indicators.volatility / 0.02
      : 1.0,
    smaFast: strategyOutput.indicators.smaFast,
    smaSlow: strategyOutput.indicators.smaSlow,
    atr: strategyOutput.indicators.atr,
    openPositions,
    capital,
    drawdownPct,
    dailyPnlPct,
  };

  // Evaluate all rules
  const ruleResults: SymbolicRuleResult[] = ALL_RULES.map(rule => rule(signal, confidence, context));
  const firedRules = ruleResults.filter(r => r.fired);

  // Apply adjustments
  let adjustedSignal = signal;
  let adjustedConfidence = confidence;
  let override = false;
  let overrideReason: string | null = null;

  for (const rule of firedRules) {
    if (rule.action === 'override_neutral') {
      adjustedSignal = 'NEUTRAL';
      adjustedConfidence = 0;
      override = true;
      overrideReason = rule.reason;
      break;  // Hard override — stop processing
    }

    if (rule.action === 'flip_direction') {
      adjustedSignal = signal === 'LONG' ? 'SHORT' : 'LONG';
      override = true;
      overrideReason = rule.reason;
    }

    adjustedConfidence += rule.confidenceAdjustment;
  }

  // Clamp confidence to [0, 1]
  adjustedConfidence = Math.max(0, Math.min(1, adjustedConfidence));

  // If confidence dropped below threshold, neutralize
  if (adjustedConfidence < 0.05 && adjustedSignal !== 'NEUTRAL') {
    adjustedSignal = 'NEUTRAL';
    adjustedConfidence = 0;
    if (!override) {
      override = true;
      overrideReason = 'Confidence dropped below 5% after symbolic adjustments';
    }
  }

  if (firedRules.length > 0) {
    log.info(`Symbolic reasoning: ${firedRules.length} rules fired`, {
      original: `${signal} (${confidence.toFixed(2)})`,
      adjusted: `${adjustedSignal} (${adjustedConfidence.toFixed(2)})`,
      rules: firedRules.map(r => r.ruleId),
    });
  }

  return {
    originalSignal: signal,
    originalConfidence: confidence,
    adjustedSignal,
    adjustedConfidence,
    rulesEvaluated: ALL_RULES.length,
    rulesFired: firedRules.length,
    ruleResults,
    override,
    overrideReason,
  };
}

/** Reset outcomes (for testing) */
export function resetOutcomes(): void {
  recentOutcomes.length = 0;
}

/** Get recent outcomes (for dashboard) */
export function getOutcomes(): TradeOutcome[] {
  return [...recentOutcomes];
}
