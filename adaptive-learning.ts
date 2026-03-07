/**
 * Adaptive Learning Layer (Bayesian Regime-Aware Memory)
 *
 * Replaces global "thermostat" tuning with bounded, context-conditioned learning.
 *
 * Key idea:
 *   - Track performance per context bucket (regime × direction × confidence bucket)
 *   - Maintain a Beta posterior over win-probability for each context
 *   - Derive a bounded confidence bias from the posterior (risk-aware via lower bound)
 *   - Emit AdaptationArtifact whenever a context bias meaningfully changes
 *
 * Safety properties (the immutable cage):
 *   - No reward maximization
 *   - No code/self-boundary modification
 *   - No risk-check overrides
 *   - Bias is bounded and auditable
 *
 * Integration notes (keeps backwards compatibility with existing agent loop):
 *   - recordTradeOutcome(outcome): called on closed positions (already wired)
 *   - runAdaptation(cycle): called periodically (already wired)
 *   - getAdaptiveParams(): preserved for compatibility (returns static params)
 *
 * NEW (recommended to integrate into decision path):
 *   - getContextConfidenceBias({regime, direction, confidence}): returns bias in [-max,+max]
 *     Apply after neuro-symbolic adjustments, before risk engine evaluation:
 *       strategyOutput.signal.confidence = clamp01(strategyOutput.signal.confidence + bias)
 */

import { createLogger } from '../agent/logger.js';

const log = createLogger('ADAPTIVE');

// ── Immutable Boundaries (THE CAGE) ──
// These CANNOT be changed by the agent. Period.
const CAGE = {
  // Legacy parameters kept for backward compatibility with the rest of the codebase.
  // (Your current strategy uses config.strategy for these; this module does NOT mutate config.)
  stopLossAtrMultiple: { min: 1.0, max: 2.5, default: 1.5 },
  basePositionPct: { min: 0.01, max: 0.04, default: 0.02 },
  confidenceThreshold: { min: 0.05, max: 0.30, default: 0.10 },

  // Bayesian memory cage
  maxContextBiasAbs: 0.35,       // absolute bound on confidence bias
  minSamplesPerContext: 8,       // must see >= N outcomes in a context before using it
  adaptationCooldown: 5,         // minimum cycles between emitting bias updates
  maxContexts: 250,              // cap memory

  // Bayesian prior (uninformative-ish). Adjusting these changes how fast the agent "trusts" data.
  // Beta(a,b): prior mean = a/(a+b).
  priorAlpha: 2,
  priorBeta: 2,

  // Risk-aware lower-bound settings (normal approximation).
  // z=1.0 ~ 84% one-sided bound; z=1.28 ~ 90%; z=1.64 ~ 95%.
  oneSidedZ: 1.28,

  // How strongly to map probability advantage into confidence bias.
  // bias ≈ scale * (p_lower_bound - 0.5)
  biasScale: 0.8,

  // Only emit an artifact if bias changes by at least this amount.
  minBiasDeltaToArtifact: 0.05,
} as const;

// ── Observable Outcomes ──
// NOTE: This matches your existing call site (agent/index.ts) to avoid breaking.
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

// ── Current Parameters (legacy, mutable within cage) ──
// Kept for compatibility with existing exports. This module no longer adapts these.
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

// ── Bayesian Context Memory ──

type ConfidenceBucket = 'low' | 'mid' | 'high';

interface ContextKey {
  regime: Outcome['regime'];
  direction: Outcome['direction'];
  confBucket: ConfidenceBucket;
}

function bucketConfidence(conf: number): ConfidenceBucket {
  if (conf >= 0.67) return 'high';
  if (conf >= 0.34) return 'mid';
  return 'low';
}

function encodeKey(k: ContextKey): string {
  return `${k.regime}|${k.direction}|${k.confBucket}`;
}

interface BetaStats {
  alpha: number;
  beta: number;
  trades: number;
  wins: number;
  losses: number;
  pnlSum: number;
}

const contextPosteriors: Map<string, BetaStats> = new Map();

// Cached biases (what we learned so far)
const contextBiases: Map<string, number> = new Map();

// For dashboard/debug
const recentOutcomes: Outcome[] = [];
const MAX_RECENT_OUTCOMES = 120;

// ── State ──
const adaptationHistory: AdaptationArtifact[] = [];
let currentParams: AdaptiveParams = {
  stopLossAtrMultiple: CAGE.stopLossAtrMultiple.default,
  basePositionPct: CAGE.basePositionPct.default,
  confidenceThreshold: CAGE.confidenceThreshold.default,
};

let cyclesSinceAdaptation = 0;

// ──────────────────────────────────────────────────────────
// Public API (backward compatible)
// ──────────────────────────────────────────────────────────

/**
 * Record a trade outcome for learning.
 * This updates the Bayesian posterior for the outcome's context.
 */
export function recordTradeOutcome(outcome: Outcome): void {
  recentOutcomes.push(outcome);
  if (recentOutcomes.length > MAX_RECENT_OUTCOMES) recentOutcomes.shift();

  const keyObj: ContextKey = {
    regime: outcome.regime,
    direction: outcome.direction,
    confBucket: bucketConfidence(outcome.confidence),
  };

  const key = encodeKey(keyObj);

  const priorAlpha = CAGE.priorAlpha;
  const priorBeta = CAGE.priorBeta;

  const s = contextPosteriors.get(key) ?? {
    alpha: priorAlpha,
    beta: priorBeta,
    trades: 0,
    wins: 0,
    losses: 0,
    pnlSum: 0,
  };

  const win = outcome.pnlPct > 0;
  s.trades += 1;
  s.pnlSum += outcome.pnlPct;

  if (win) {
    s.wins += 1;
    s.alpha += 1;
  } else {
    s.losses += 1;
    s.beta += 1;
  }

  contextPosteriors.set(key, s);

  // Cap memory size (drop oldest insertion order key)
  if (contextPosteriors.size > CAGE.maxContexts) {
    const firstKey = contextPosteriors.keys().next().value as string | undefined;
    if (firstKey) {
      contextPosteriors.delete(firstKey);
      contextBiases.delete(firstKey);
    }
  }
}

/**
 * Get current adaptive parameters (legacy).
 * NOTE: This Bayesian layer does not mutate these.
 */
export function getAdaptiveParams(): Readonly<AdaptiveParams> {
  return { ...currentParams };
}

/** Get the immutable cage boundaries */
export function getCageBounds() {
  return { ...CAGE };
}

/**
 * Bayesian confidence bias for a given context.
 *
 * Apply like:
 *   const bias = getContextConfidenceBias({ regime, direction, confidence });
 *   strategyOutput.signal.confidence = clamp01(strategyOutput.signal.confidence + bias);
 */
export function getContextConfidenceBias(input: {
  regime: Outcome['regime'];
  direction: Outcome['direction'];
  confidence: number;
}): number {
  const key: ContextKey = {
    regime: input.regime,
    direction: input.direction,
    confBucket: bucketConfidence(input.confidence),
  };

  const k = encodeKey(key);
  const stats = contextPosteriors.get(k);

  // Not enough evidence → no bias.
  if (!stats || stats.trades < CAGE.minSamplesPerContext) return 0;

  // Compute (and cache) bias. If missing, compute now.
  const cached = contextBiases.get(k);
  if (typeof cached === 'number') return cached;

  const bias = computeBiasFromPosterior(stats);
  contextBiases.set(k, bias);
  return bias;
}

/**
 * Run the adaptation cycle.
 * Here, "adaptation" means updating cached context biases and emitting artifacts
 * when those biases change meaningfully.
 */
export function runAdaptation(currentCycle: number): AdaptationArtifact[] {
  cyclesSinceAdaptation++;

  // Cooldown gate
  if (cyclesSinceAdaptation < CAGE.adaptationCooldown) return [];

  const artifacts: AdaptationArtifact[] = [];

  for (const [key, stats] of contextPosteriors.entries()) {
    if (stats.trades < CAGE.minSamplesPerContext) continue;

    const newBias = computeBiasFromPosterior(stats);
    const prevBias = contextBiases.get(key) ?? 0;

    // Update cache
    contextBiases.set(key, newBias);

    // Emit artifact only if bias shifted meaningfully
    if (Math.abs(newBias - prevBias) >= CAGE.minBiasDeltaToArtifact) {
      const posteriorMean = stats.alpha / (stats.alpha + stats.beta);
      const posteriorLower = betaLowerBoundNormalApprox(stats, CAGE.oneSidedZ);

      const direction = newBias > prevBias ? 'increased' : 'decreased';
      log.info(`Context bias ${direction}`, {
        context: key,
        prev: prevBias.toFixed(3),
        next: newBias.toFixed(3),
        trades: stats.trades,
        mean: posteriorMean.toFixed(3),
        lower: posteriorLower.toFixed(3),
      });

      artifacts.push({
        type: 'adaptation_artifact',
        timestamp: new Date().toISOString(),
        cycleNumber: currentCycle,
        parameter: `contextBias:${key}`,
        previousValue: round3(prevBias),
        newValue: round3(newBias),
        cageBounds: { min: -CAGE.maxContextBiasAbs, max: CAGE.maxContextBiasAbs },
        trigger: `Bayesian posterior updated for ${key}`,
        observations: {
          sampleSize: stats.trades,
          metric: 'posteriorLowerBoundWinProb',
          value: round3(posteriorLower),
        },
        reasoning:
          `Updated bounded confidence bias for context ${key}. ` +
          `Posterior mean win-prob=${posteriorMean.toFixed(3)}, lower bound (one-sided z=${CAGE.oneSidedZ})=${posteriorLower.toFixed(3)}. ` +
          `Bias computed as clamp(scale*(lower-0.5), ±${CAGE.maxContextBiasAbs}). ` +
          `This is not reward optimization; it is evidence-weighted context reliability.`
      });
    }
  }

  if (artifacts.length > 0) {
    adaptationHistory.push(...artifacts);
  }

  cyclesSinceAdaptation = 0;
  return artifacts;
}

// ── Dashboard / MCP Accessors ──

export function getAdaptationHistory(): AdaptationArtifact[] {
  return [...adaptationHistory];
}

export function getAdaptationSummary() {
  const contexts = Array.from(contextPosteriors.entries()).map(([k, s]) => {
    const mean = s.alpha / (s.alpha + s.beta);
    const lower = s.trades >= CAGE.minSamplesPerContext ? betaLowerBoundNormalApprox(s, CAGE.oneSidedZ) : null;
    return {
      context: k,
      trades: s.trades,
      wins: s.wins,
      losses: s.losses,
      posteriorMeanWinProb: round3(mean),
      posteriorLowerBoundWinProb: lower === null ? null : round3(lower),
      avgPnlPct: s.trades ? round3(s.pnlSum / s.trades) : 0,
      bias: round3(contextBiases.get(k) ?? 0),
    };
  });

  // Sort most-sampled first (helpful for dashboards)
  contexts.sort((a, b) => b.trades - a.trades);

  return {
    currentParams: { ...currentParams },
    cage: CAGE,
    totalAdaptations: adaptationHistory.length,
    outcomesTracked: recentOutcomes.length,
    contextsTracked: contextPosteriors.size,
    contexts,
  };
}

/** Reset for testing */
export function resetAdaptation(): void {
  recentOutcomes.length = 0;
  adaptationHistory.length = 0;
  contextPosteriors.clear();
  contextBiases.clear();
  currentParams = {
    stopLossAtrMultiple: CAGE.stopLossAtrMultiple.default,
    basePositionPct: CAGE.basePositionPct.default,
    confidenceThreshold: CAGE.confidenceThreshold.default,
  };
  cyclesSinceAdaptation = 0;
}

// ──────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * Compute a bounded confidence bias from the Beta posterior.
 * We use a risk-aware lower bound to avoid overconfidence in small samples.
 */
function computeBiasFromPosterior(stats: BetaStats): number {
  // Ensure minimum sample size guard here too (belt-and-braces)
  if (stats.trades < CAGE.minSamplesPerContext) return 0;

  // Posterior lower bound on win probability
  const pLower = betaLowerBoundNormalApprox(stats, CAGE.oneSidedZ);

  // Map advantage over random (0.5) into a confidence bias
  let bias = CAGE.biasScale * (pLower - 0.5);

  // Bound the bias by cage
  bias = clamp(bias, -CAGE.maxContextBiasAbs, CAGE.maxContextBiasAbs);

  // Optional: if posterior mean is near 0.5 and uncertainty high, keep it near zero
  // (pLower already does most of this work)
  return bias;
}

/**
 * Normal approximation lower bound for Beta posterior.
 * mean = a/(a+b)
 * var  = ab / ((a+b)^2 (a+b+1))
 * lower ≈ mean - z * sqrt(var)
 *
 * This avoids heavy math libs while remaining stable and conservative.
 */
function betaLowerBoundNormalApprox(stats: BetaStats, z: number): number {
  const a = stats.alpha;
  const b = stats.beta;
  const denom = a + b;
  const mean = a / denom;
  const variance = (a * b) / (denom * denom * (denom + 1));
  const sd = Math.sqrt(Math.max(variance, 1e-12));
  const lower = mean - z * sd;
  return clamp01(lower);
}
