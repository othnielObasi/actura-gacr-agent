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
 *   - Learn a bounded context confidence bias by regime + direction
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

const CAGE = {
  stopLossAtrMultiple: { min: 1.0, max: 2.5, default: 1.5 },
  basePositionPct:     { min: 0.01, max: 0.04, default: 0.02 },
  confidenceThreshold: { min: 0.05, max: 0.30, default: 0.10 },
  maxAdaptationPerCycle: 0.05,
  minSampleSize: 10,
  adaptationCooldown: 5,

  // bounded context-learning only influences confidence, never the risk cage
  maxContextBiasAbs: 0.12,
  minContextSamples: 5,
} as const;

export interface Outcome {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  stopHit: boolean;
  regime: 'low' | 'normal' | 'high' | 'extreme';
  confidence: number;
  timestamp: string;
}

interface AdaptiveParams {
  stopLossAtrMultiple: number;
  basePositionPct: number;
  confidenceThreshold: number;
}

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

export interface ContextBiasInput {
  regime: Outcome['regime'];
  direction: Outcome['direction'];
  confidence: number;
}

const outcomes: Outcome[] = [];
const adaptationHistory: AdaptationArtifact[] = [];
let currentParams: AdaptiveParams = {
  stopLossAtrMultiple: CAGE.stopLossAtrMultiple.default,
  basePositionPct: CAGE.basePositionPct.default,
  confidenceThreshold: CAGE.confidenceThreshold.default,
};
let cyclesSinceAdaptation = 0;
const MAX_OUTCOMES = 100;

export function recordTradeOutcome(outcome: Outcome): void {
  outcomes.push(outcome);
  if (outcomes.length > MAX_OUTCOMES) outcomes.shift();
}

export function getAdaptiveParams(): Readonly<AdaptiveParams> {
  return { ...currentParams };
}

export function getCageBounds() {
  return { ...CAGE };
}

export function runAdaptation(currentCycle: number): AdaptationArtifact[] {
  cyclesSinceAdaptation++;

  if (cyclesSinceAdaptation < CAGE.adaptationCooldown) return [];
  if (outcomes.length < CAGE.minSampleSize) return [];

  const artifacts: AdaptationArtifact[] = [];

  const stopHitRate = computeStopHitRate();
  if (stopHitRate !== null) {
    const adaptation = adaptStopLoss(stopHitRate, currentCycle);
    if (adaptation) artifacts.push(adaptation);
  }

  const recentWinRate = computeWinRate(20);
  if (recentWinRate !== null) {
    const adaptation = adaptPositionSize(recentWinRate, currentCycle);
    if (adaptation) artifacts.push(adaptation);
  }

  const falseSignalRate = computeFalseSignalRate();
  if (falseSignalRate !== null) {
    const adaptation = adaptConfidenceThreshold(falseSignalRate, currentCycle);
    if (adaptation) artifacts.push(adaptation);
  }

  if (artifacts.length > 0) {
    cyclesSinceAdaptation = 0;
    adaptationHistory.push(...artifacts);
  }

  return artifacts;
}

/**
 * Bounded Bayesian-style context memory.
 *
 * This does NOT alter stops, sizing, or thresholds.
 * It only returns a small confidence bias for the current context.
 */
export function getContextConfidenceBias(input: ContextBiasInput): number {
  const relevant = outcomes.filter(
    (o) => o.regime === input.regime && o.direction === input.direction,
  );

  if (relevant.length < CAGE.minContextSamples) return 0;

  const wins = relevant.filter((o) => o.pnlPct > 0).length;
  const losses = relevant.length - wins;

  // Beta(1,1) posterior mean for win probability.
  const posteriorWinRate = (wins + 1) / (wins + losses + 2);
  const edgeVsNeutral = posteriorWinRate - 0.5;

  // More evidence => more trust, capped.
  const sampleWeight = clamp(relevant.length / 20, 0, 1);
  const confidenceWeight = clamp(0.6 + input.confidence * 0.4, 0.6, 1.0);
  const rawBias = edgeVsNeutral * 0.4 * sampleWeight * confidenceWeight;

  return clamp(rawBias, -CAGE.maxContextBiasAbs, CAGE.maxContextBiasAbs);
}

export function getContextStats(input: Pick<ContextBiasInput, 'regime' | 'direction'>) {
  const relevant = outcomes.filter(
    (o) => o.regime === input.regime && o.direction === input.direction,
  );
  const wins = relevant.filter((o) => o.pnlPct > 0).length;
  const losses = relevant.length - wins;
  return {
    sampleSize: relevant.length,
    wins,
    losses,
    posteriorWinRate: relevant.length > 0 ? (wins + 1) / (wins + losses + 2) : 0.5,
  };
}

function adaptStopLoss(hitRate: number, cycle: number): AdaptationArtifact | null {
  const prev = currentParams.stopLossAtrMultiple;
  let newVal = prev;

  if (hitRate > 0.60) newVal = prev * (1 + CAGE.maxAdaptationPerCycle);
  else if (hitRate < 0.20 && prev > CAGE.stopLossAtrMultiple.min + 0.1) newVal = prev * (1 - CAGE.maxAdaptationPerCycle);
  else return null;

  newVal = clamp(newVal, CAGE.stopLossAtrMultiple.min, CAGE.stopLossAtrMultiple.max);
  if (Math.abs(newVal - prev) < 0.01) return null;

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

function adaptPositionSize(winRate: number, cycle: number): AdaptationArtifact | null {
  const prev = currentParams.basePositionPct;
  let newVal = prev;

  if (winRate > 0.55) newVal = prev * (1 + CAGE.maxAdaptationPerCycle * 0.5);
  else if (winRate < 0.35) newVal = prev * (1 - CAGE.maxAdaptationPerCycle);
  else return null;

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

function adaptConfidenceThreshold(falseSignalRate: number, cycle: number): AdaptationArtifact | null {
  const prev = currentParams.confidenceThreshold;
  let newVal = prev;

  if (falseSignalRate > 0.50) newVal = prev + 0.02;
  else if (falseSignalRate < 0.25 && prev > CAGE.confidenceThreshold.min + 0.02) newVal = prev - 0.01;
  else return null;

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

export function getAdaptationHistory(): AdaptationArtifact[] {
  return [...adaptationHistory];
}

export function getAdaptationSummary() {
  return {
    currentParams: getAdaptiveParams(),
    cage: getCageBounds(),
    totalOutcomes: outcomes.length,
    totalAdaptations: adaptationHistory.length,
    lastAdaptation: adaptationHistory[adaptationHistory.length - 1] ?? null,
  };
}
