/**
 * Signal Generation for Actura (Multi-Factor Scorecard)
 * ----------------------------------------------------
 * Converts indicators into actionable signals using an auditable scorecard:
 *   - Trend: MA separation + crossover direction
 *   - Momentum: short/medium returns
 *   - Mean-reversion risk: RSI + z-score penalties (avoid chasing extremes)
 *   - Regime gating: volatility ratio + structure regime (ADX/CHOP/autocorr)
 *   - Edge filter: skip trades where expected move < costs (Sharpe improvement)
 *
 * Output stays compatible with the rest of Actura: direction + confidence + reason.
 */

import { classifyStructureRegime, type StructureRegime } from './structure-regime.js';
import { evaluateEdge } from './edge-filter.js';

export type SignalDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export interface TradingSignal {
  direction: SignalDirection;
  confidence: number;  // 0-1
  name: string;

  smaFast: number | null;
  smaSlow: number | null;
  volatility: number | null;
  atr: number | null;

  // Optional richer context (used for validation artifacts / dashboards)
  alphaScore?: number;
  structureRegime?: StructureRegime;
  rsi?: number | null;
  adx?: number | null;
  choppiness?: number | null;
  zscore?: number | null;
  ret5?: number | null;
  ret20?: number | null;
  autocorr1?: number | null;
  edge?: {
    allowed: boolean;
    expectedEdgePct: number;
    estimatedCostPct: number;
    reason: string;
  };

  timestamp: string;
  reason: string;
}

export interface SignalInput {
  smaFast: number | null;
  smaSlow: number | null;
  prevSmaFast: number | null;
  prevSmaSlow: number | null;

  volatility: number | null;
  baselineVolatility: number;
  atr: number | null;
  currentPrice: number;

  // richer indicators (optional)
  rsi?: number | null;
  adx?: number | null;
  choppiness?: number | null;
  zscore?: number | null;
  ret5?: number | null;
  ret20?: number | null;
  autocorr1?: number | null;

  // edge model config (optional)
  costBps?: number;
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Generate signal from indicator values
 */
export function generateSignal(input: SignalInput): TradingSignal {
  const timestamp = new Date().toISOString();
  const {
    smaFast, smaSlow, prevSmaFast, prevSmaSlow,
    volatility, baselineVolatility, atr, currentPrice,
    rsi, adx, choppiness, zscore, ret5, ret20, autocorr1,
    costBps
  } = input;

  // Not enough data yet
  if (smaFast === null || smaSlow === null || currentPrice <= 0) {
    return {
      direction: 'NEUTRAL',
      confidence: 0,
      name: 'INSUFFICIENT_DATA',
      smaFast, smaSlow, volatility, atr,
      timestamp,
      reason: 'Not enough price data to compute indicators'
    };
  }

  // Trend direction and crossover
  const isBullish = smaFast > smaSlow;
  const wasBullish = prevSmaFast !== null && prevSmaSlow !== null && prevSmaFast > prevSmaSlow;
  const crossedUp = isBullish && !wasBullish;
  const crossedDown = !isBullish && wasBullish;

  // Trend strength from MA separation
  const maSep = (smaFast - smaSlow) / currentPrice;         // signed
  const maSepAbs = Math.abs(maSep);
  const trendStrength = clamp(maSepAbs / 0.02, 0, 1);       // 2% separation → strong

  // Momentum features
  const m5 = ret5 ?? 0;
  const m20 = ret20 ?? 0;

  // Mean reversion / exhaustion penalties
  const r = (rsi ?? null);
  const z = (zscore ?? null);

  const overboughtPenalty = r !== null && r > 70 ? clamp((r - 70) / 30, 0, 1) : 0;
  const oversoldPenalty  = r !== null && r < 30 ? clamp((30 - r) / 30, 0, 1) : 0;
  const zExtremePenalty = z !== null ? clamp(Math.abs(z) / 3, 0, 1) : 0; // |z|>=3 => full penalty

  // Volatility confidence adjustment (ratio to baseline)
  let volRatio: number | null = null;
  let volConfidence = 1.0;
  if (volatility !== null && baselineVolatility > 0) {
    volRatio = volatility / baselineVolatility;
    volConfidence = clamp(1.0 / Math.max(1.0, volRatio), 0.55, 1.0);
  }

  // Structure regime gating (auditable)
  const structure = classifyStructureRegime({
    adx: adx ?? null,
    choppiness: choppiness ?? null,
    autocorr1: autocorr1 ?? null,
    volRatio
  });

  // Scorecard:
  // - trend provides direction bias
  // - momentum supports direction
  // - penalties reduce chasing into extremes
  const directionSign = isBullish ? 1 : -1;

  const trendScore = directionSign * (0.9 * trendStrength);
  const momentumScore = directionSign * (1.4 * m5 + 0.9 * m20); // returns are already signed
  const crossoverBoost = crossedUp || crossedDown ? 0.15 : 0;

  // Penalties: if bullish, penalize overbought; if bearish penalize oversold
  const rsiPenalty = isBullish ? overboughtPenalty : oversoldPenalty;
  const meanRevPenalty = 0.6 * rsiPenalty + 0.5 * zExtremePenalty;

  const alphaScore =
    trendScore +
    momentumScore +
    (directionSign * crossoverBoost) -
    meanRevPenalty;

  // Confidence mapping: higher absolute score → higher confidence.
  // Keep conservative to reduce overtrading.
  const rawConf = clamp(sigmoid(Math.abs(alphaScore) * 2.2) - 0.5, 0, 0.5) * 2; // maps to ~[0..1]
  let confidence = clamp(rawConf * volConfidence * structure.confidenceMultiplier, 0, 1);

  // Guard against NaN propagation from indicator calculations
  if (!Number.isFinite(confidence) || !Number.isFinite(alphaScore)) {
    return {
      direction: 'NEUTRAL',
      confidence: 0,
      name: 'NAN_GUARD',
      smaFast, smaSlow, volatility, atr,
      timestamp,
      reason: 'Indicator calculation produced NaN — signal rejected for safety'
    };
  }

  // If structure is RANGING or STRESSED, require stronger signals
  if (structure.regime === 'RANGING') confidence = clamp(confidence - 0.08, 0, 1);
  if (structure.regime === 'STRESSED') confidence = clamp(confidence - 0.15, 0, 1);

  // Determine direction (NEUTRAL if weak)
  let direction: SignalDirection = 'NEUTRAL';
  if (confidence >= 0.12) {
    direction = alphaScore >= 0 ? 'LONG' : 'SHORT';
  }

  // Expected edge filter (additional Sharpe module)
  const edge = evaluateEdge({
    currentPrice,
    atr,
    confidence,
    side: direction,
    costBps: costBps ?? 10, // sandbox tuning (use 18+ for live)
    minEdgeMultiple: 1.5
  });

  if (!edge.allowed && direction !== 'NEUTRAL') {
    return {
      direction: 'NEUTRAL',
      confidence: 0,
      name: 'EDGE_FILTER_BLOCK',
      smaFast, smaSlow, volatility, atr,
      alphaScore,
      structureRegime: structure.regime,
      rsi: rsi ?? null,
      adx: adx ?? null,
      choppiness: choppiness ?? null,
      zscore: zscore ?? null,
      ret5: ret5 ?? null,
      ret20: ret20 ?? null,
      autocorr1: autocorr1 ?? null,
      edge,
      timestamp,
      reason: edge.reason
    };
  }

  // Build reason narrative
  const maSepPct = (maSepAbs * 100).toFixed(2);
  const baseReason = crossedUp
    ? `Cross up. MA sep ${maSepPct}%`
    : crossedDown
      ? `Cross down. MA sep ${maSepPct}%`
      : `Scorecard. MA sep ${maSepPct}%`;

  const reason = [
    baseReason,
    `alphaScore ${alphaScore.toFixed(3)}`,
    `conf ${confidence.toFixed(2)}`,
    `volConf ${volConfidence.toFixed(2)}`,
    `structure ${structure.regime}`,
    structure.reason
  ].join(' | ');

  const name =
    direction === 'NEUTRAL'
      ? 'NO_SIGNAL'
      : direction === 'LONG'
        ? (crossedUp ? 'SCORECARD_CROSS_LONG' : 'SCORECARD_LONG')
        : (crossedDown ? 'SCORECARD_CROSS_SHORT' : 'SCORECARD_SHORT');

  return {
    direction,
    confidence: direction === 'NEUTRAL' ? 0 : Math.round(confidence * 100) / 100,
    name,
    smaFast, smaSlow, volatility, atr,
    alphaScore,
    structureRegime: structure.regime,
    rsi: rsi ?? null,
    adx: adx ?? null,
    choppiness: choppiness ?? null,
    zscore: zscore ?? null,
    ret5: ret5 ?? null,
    ret20: ret20 ?? null,
    autocorr1: autocorr1 ?? null,
    edge,
    timestamp,
    reason
  };
}
