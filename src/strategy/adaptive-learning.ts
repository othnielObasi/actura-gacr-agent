/**
 * Adaptive Learning Layer
 * 
 * "Responsible self-improving AI" — the agent adjusts strategy parameters
 * based on observed outcomes, but CANNOT:
 *   - Change its own boundaries (the cage is immutable)
 *   - Disable risk checks
 *   - Expand parameter ranges beyond pre-set limits
 *   - Override symbolic rules
 * 
 * What it CAN do:
 *   - Adjust stop-loss ATR multiple within [1.0, 2.5]
 *   - Adjust base position size within [0.01, 0.04]
 *   - Adjust confidence threshold within [0.05, 0.3]
 *   - Weight regimes differently based on observed success
 *   - Switch between pre-defined parameter profiles
 * 
 * Every adaptation is recorded as an "adaptation_artifact" with:
 *   - What changed
 *   - Why (which observations triggered it)
 *   - The before/after values
 *   - The immutable boundary that constrains it
 * 
 * NO REWARD FUNCTION. The agent observes outcomes and applies
 * bounded statistical adjustments. It cannot game a reward signal
 * because there is no reward signal to game.
 */

import { createLogger } from '../agent/logger.js';

const log = createLogger('ADAPTIVE');

// ── Immutable Boundaries (THE CAGE) ──
// These CANNOT be changed by the agent. Period.
const CAGE = {
  stopLossAtrMultiple: { min: 1.0, max: 2.5, default: 1.5 },
  basePositionPct:     { min: 0.01, max: 0.04, default: 0.02 },
  confidenceThreshold: { min: 0.05, max: 0.30, default: 0.10 },
  maxAdaptationPerCycle: 0.05,  // Max 5% change per adaptation
  minSampleSize: 10,            // Need 10+ outcomes before adapting
  adaptationCooldown: 5,        // Minimum cycles between adaptations
} as const;

// ── Observable Outcomes ──
interface Outcome {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  stopHit: boolean;
  regime: 'low' | 'normal' | 'high' | 'extreme';
  confidence: number;
  timestamp: string;
}

// ── Current Parameters (mutable within cage) ──
interface AdaptiveParams {
  stopLossAtrMultiple: number;
  basePositionPct: number;
  confidenceThreshold: number;
}

// ── Adaptation Record ──
export interface AdaptationArtifact {
  type: 'adaptation_artifact';
  timestamp: string;
  cycleNumber: number;
  parameter: string;
  previousValue: number;
  newValue: number;
  cageBounds: { min: number; max: number };
  trigger: string;
  observations: {
    sampleSize: number;
    metric: string;
    value: number;
  };
  reasoning: string;
}

// ── State ──
const outcomes: Outcome[] = [];
const adaptationHistory: AdaptationArtifact[] = [];
let currentParams: AdaptiveParams = {
  stopLossAtrMultiple: CAGE.stopLossAtrMultiple.default,
  basePositionPct: CAGE.basePositionPct.default,
  confidenceThreshold: CAGE.confidenceThreshold.default,
};
let lastAdaptationCycle = 0;
let cyclesSinceAdaptation = 0;
const MAX_OUTCOMES = 100;

/**
 * Record a trade outcome for learning
 */
export function recordTradeOutcome(outcome: Outcome): void {
  outcomes.push(outcome);
  if (outcomes.length > MAX_OUTCOMES) outcomes.shift();
}

/**
 * Get current adaptive parameters
 */
export function getAdaptiveParams(): Readonly<AdaptiveParams> {
  return { ...currentParams };
}

/**
 * Get the immutable cage boundaries
 */
export function getCageBounds() {
  return { ...CAGE };
}

/**
 * Run the adaptation cycle.
 * Call this periodically (e.g., every 10 cycles).
 * Returns any adaptations made, or empty array if none.
 */
export function runAdaptation(currentCycle: number): AdaptationArtifact[] {
  cyclesSinceAdaptation++;

  // Check cooldown
  if (cyclesSinceAdaptation < CAGE.adaptationCooldown) {
    return [];
  }

  // Check sample size
  if (outcomes.length < CAGE.minSampleSize) {
    return [];
  }

  const artifacts: AdaptationArtifact[] = [];

  // ── Adaptation 1: Stop-Loss Width ──
  const stopHitRate = computeStopHitRate();
  if (stopHitRate !== null) {
    const adaptation = adaptStopLoss(stopHitRate, currentCycle);
    if (adaptation) artifacts.push(adaptation);
  }

  // ── Adaptation 2: Position Size ──
  const recentWinRate = computeWinRate(20);
  if (recentWinRate !== null) {
    const adaptation = adaptPositionSize(recentWinRate, currentCycle);
    if (adaptation) artifacts.push(adaptation);
  }

  // ── Adaptation 3: Confidence Threshold ──
  const falseSignalRate = computeFalseSignalRate();
  if (falseSignalRate !== null) {
    const adaptation = adaptConfidenceThreshold(falseSignalRate, currentCycle);
    if (adaptation) artifacts.push(adaptation);
  }

  if (artifacts.length > 0) {
    lastAdaptationCycle = currentCycle;
    cyclesSinceAdaptation = 0;
    adaptationHistory.push(...artifacts);
  }

  return artifacts;
}

// ── Adaptation Logic ──

/**
 * If stop-loss hit rate is too high (>60%), widen stops.
 * If too low (<20%), tighten stops to lock in more profit.
 * Bounded by CAGE.
 */
function adaptStopLoss(hitRate: number, cycle: number): AdaptationArtifact | null {
  const prev = currentParams.stopLossAtrMultiple;
  let newVal = prev;

  if (hitRate > 0.60) {
    // Stops too tight — widen
    newVal = prev * (1 + CAGE.maxAdaptationPerCycle);
  } else if (hitRate < 0.20 && prev > CAGE.stopLossAtrMultiple.min + 0.1) {
    // Stops too loose — tighten
    newVal = prev * (1 - CAGE.maxAdaptationPerCycle);
  } else {
    return null;  // No adaptation needed
  }

  // Clamp to cage
  newVal = clamp(newVal, CAGE.stopLossAtrMultiple.min, CAGE.stopLossAtrMultiple.max);

  if (Math.abs(newVal - prev) < 0.01) return null;  // Too small to matter

  currentParams.stopLossAtrMultiple = newVal;

  const direction = newVal > prev ? 'widened' : 'tightened';
  log.info(`Stop-loss ${direction}: ${prev.toFixed(3)} → ${newVal.toFixed(3)} (hit rate: ${(hitRate * 100).toFixed(0)}%)`);

  return {
    type: 'adaptation_artifact',
    timestamp: new Date().toISOString(),
    cycleNumber: cycle,
    parameter: 'stopLossAtrMultiple',
    previousValue: Math.round(prev * 1000) / 1000,
    newValue: Math.round(newVal * 1000) / 1000,
    cageBounds: { min: CAGE.stopLossAtrMultiple.min, max: CAGE.stopLossAtrMultiple.max },
    trigger: `Stop-loss hit rate ${(hitRate * 100).toFixed(0)}%`,
    observations: { sampleSize: outcomes.length, metric: 'stopHitRate', value: Math.round(hitRate * 100) / 100 },
    reasoning: `Stop-losses ${direction} because hit rate (${(hitRate * 100).toFixed(0)}%) was ${hitRate > 0.5 ? 'above' : 'below'} acceptable range. New ATR multiple: ${newVal.toFixed(3)} (bounds: ${CAGE.stopLossAtrMultiple.min}–${CAGE.stopLossAtrMultiple.max}).`,
  };
}

/**
 * If win rate is high (>55%), slightly increase position size.
 * If win rate is low (<35%), reduce position size.
 */
function adaptPositionSize(winRate: number, cycle: number): AdaptationArtifact | null {
  const prev = currentParams.basePositionPct;
  let newVal = prev;

  if (winRate > 0.55) {
    newVal = prev * (1 + CAGE.maxAdaptationPerCycle * 0.5);  // Half-speed increase
  } else if (winRate < 0.35) {
    newVal = prev * (1 - CAGE.maxAdaptationPerCycle);
  } else {
    return null;
  }

  newVal = clamp(newVal, CAGE.basePositionPct.min, CAGE.basePositionPct.max);

  if (Math.abs(newVal - prev) < 0.001) return null;

  currentParams.basePositionPct = newVal;

  const direction = newVal > prev ? 'increased' : 'decreased';
  log.info(`Position size ${direction}: ${(prev * 100).toFixed(2)}% → ${(newVal * 100).toFixed(2)}% (win rate: ${(winRate * 100).toFixed(0)}%)`);

  return {
    type: 'adaptation_artifact',
    timestamp: new Date().toISOString(),
    cycleNumber: cycle,
    parameter: 'basePositionPct',
    previousValue: Math.round(prev * 10000) / 10000,
    newValue: Math.round(newVal * 10000) / 10000,
    cageBounds: { min: CAGE.basePositionPct.min, max: CAGE.basePositionPct.max },
    trigger: `Win rate ${(winRate * 100).toFixed(0)}%`,
    observations: { sampleSize: Math.min(outcomes.length, 20), metric: 'winRate', value: Math.round(winRate * 100) / 100 },
    reasoning: `Position size ${direction} because win rate (${(winRate * 100).toFixed(0)}%) ${winRate > 0.5 ? 'supports larger' : 'warrants smaller'} positions. New size: ${(newVal * 100).toFixed(2)}% of capital (bounds: ${(CAGE.basePositionPct.min * 100)}%–${(CAGE.basePositionPct.max * 100)}%).`,
  };
}

/**
 * If many low-confidence trades are losing, raise the threshold.
 * If high-confidence trades are consistently winning, lower it slightly.
 */
function adaptConfidenceThreshold(falseSignalRate: number, cycle: number): AdaptationArtifact | null {
  const prev = currentParams.confidenceThreshold;
  let newVal = prev;

  if (falseSignalRate > 0.50) {
    // Too many false signals — raise bar
    newVal = prev + 0.02;
  } else if (falseSignalRate < 0.25 && prev > CAGE.confidenceThreshold.min + 0.02) {
    // Signals are reliable — can lower bar slightly
    newVal = prev - 0.01;
  } else {
    return null;
  }

  newVal = clamp(newVal, CAGE.confidenceThreshold.min, CAGE.confidenceThreshold.max);

  if (Math.abs(newVal - prev) < 0.005) return null;

  currentParams.confidenceThreshold = newVal;

  const direction = newVal > prev ? 'raised' : 'lowered';
  log.info(`Confidence threshold ${direction}: ${(prev * 100).toFixed(1)}% → ${(newVal * 100).toFixed(1)}% (false signal rate: ${(falseSignalRate * 100).toFixed(0)}%)`);

  return {
    type: 'adaptation_artifact',
    timestamp: new Date().toISOString(),
    cycleNumber: cycle,
    parameter: 'confidenceThreshold',
    previousValue: Math.round(prev * 1000) / 1000,
    newValue: Math.round(newVal * 1000) / 1000,
    cageBounds: { min: CAGE.confidenceThreshold.min, max: CAGE.confidenceThreshold.max },
    trigger: `False signal rate ${(falseSignalRate * 100).toFixed(0)}%`,
    observations: { sampleSize: outcomes.length, metric: 'falseSignalRate', value: Math.round(falseSignalRate * 100) / 100 },
    reasoning: `Confidence threshold ${direction} because ${(falseSignalRate * 100).toFixed(0)}% of signals led to losses. New threshold: ${(newVal * 100).toFixed(1)}% (bounds: ${(CAGE.confidenceThreshold.min * 100)}%–${(CAGE.confidenceThreshold.max * 100)}%).`,
  };
}

// ── Metrics ──

function computeStopHitRate(): number | null {
  const closed = outcomes.filter(o => o.exitPrice > 0);
  if (closed.length < CAGE.minSampleSize) return null;
  const hits = closed.filter(o => o.stopHit).length;
  return hits / closed.length;
}

function computeWinRate(window: number = 20): number | null {
  const recent = outcomes.slice(-window);
  if (recent.length < Math.min(window, CAGE.minSampleSize)) return null;
  const wins = recent.filter(o => o.pnlPct > 0).length;
  return wins / recent.length;
}

function computeFalseSignalRate(): number | null {
  if (outcomes.length < CAGE.minSampleSize) return null;
  const losses = outcomes.filter(o => o.pnlPct < 0 && o.confidence < 0.5);
  return losses.length / outcomes.length;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ── Dashboard / MCP Accessors ──

export function getAdaptationHistory(): AdaptationArtifact[] {
  return [...adaptationHistory];
}

export function getAdaptationSummary() {
  return {
    currentParams: { ...currentParams },
    cage: CAGE,
    totalAdaptations: adaptationHistory.length,
    outcomeCount: outcomes.length,
    metrics: {
      stopHitRate: computeStopHitRate(),
      winRate: computeWinRate(),
      falseSignalRate: computeFalseSignalRate(),
    },
    lastAdaptationCycle,
  };
}

/** Reset for testing */
export function resetAdaptation(): void {
  outcomes.length = 0;
  adaptationHistory.length = 0;
  currentParams = {
    stopLossAtrMultiple: CAGE.stopLossAtrMultiple.default,
    basePositionPct: CAGE.basePositionPct.default,
    confidenceThreshold: CAGE.confidenceThreshold.default,
  };
  lastAdaptationCycle = 0;
  cyclesSinceAdaptation = 0;
}
