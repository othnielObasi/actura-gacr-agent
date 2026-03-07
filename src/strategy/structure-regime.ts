/**
 * Structure Regime Classifier
 * ---------------------------
 * Distinguishes TRENDING vs RANGING vs STRESSED vs UNCERTAIN using
 * trend strength (ADX), choppiness (CHOP), autocorrelation, and volatility context.
 *
 * Goal: improve Sharpe and drawdown by avoiding "trend strategies in chop" and
 * scaling posture in stress.
 *
 * This is intentionally lightweight and auditable (no black box).
 */

export type StructureRegime = 'TRENDING' | 'RANGING' | 'STRESSED' | 'UNCERTAIN';

export interface StructureRegimeInput {
  adx: number | null;             // trend strength
  choppiness: number | null;      // range-ness
  autocorr1: number | null;       // lag-1 return autocorr
  volRatio: number | null;        // volatility / baselineVolatility
}

export interface StructureRegimeResult {
  regime: StructureRegime;
  confidenceMultiplier: number;   // multiplies signal confidence
  sizeMultiplier: number;         // multiplies position sizing
  reason: string;
  metrics: {
    adx: number | null;
    choppiness: number | null;
    autocorr1: number | null;
    volRatio: number | null;
  };
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

export function classifyStructureRegime(input: StructureRegimeInput): StructureRegimeResult {
  const { adx, choppiness, autocorr1, volRatio } = input;

  // Defaults
  let regime: StructureRegime = 'UNCERTAIN';
  let confidenceMultiplier = 1.0;
  let sizeMultiplier = 1.0;
  const parts: string[] = [];

  const v = volRatio ?? 1.0;
  const a = adx ?? 0;
  const c = choppiness ?? 50;
  const ac = autocorr1 ?? 0;

  // Stress detection: very high volatility + choppy structure → defensive posture
  if (v >= 1.8 && c >= 55) {
    regime = 'STRESSED';
    confidenceMultiplier = 0.55;
    sizeMultiplier = 0.60;
    parts.push(`stress: volRatio ${v.toFixed(2)} and CHOP ${c.toFixed(1)}`);
  }
  // Trending detection: strong trend + low chop + positive autocorr
  else if (a >= 25 && c <= 48 && ac >= 0.10) {
    regime = 'TRENDING';
    confidenceMultiplier = 1.10;
    sizeMultiplier = 1.05;
    parts.push(`trend: ADX ${a.toFixed(1)}, CHOP ${c.toFixed(1)}, AC1 ${ac.toFixed(2)}`);
  }
  // Ranging detection: weak trend or high chop
  else if (a <= 18 || c >= 55 || Math.abs(ac) <= 0.05) {
    regime = 'RANGING';
    confidenceMultiplier = 0.75;
    sizeMultiplier = 0.80;
    parts.push(`range: ADX ${a.toFixed(1)}, CHOP ${c.toFixed(1)}, AC1 ${ac.toFixed(2)}`);
  } else {
    regime = 'UNCERTAIN';
    confidenceMultiplier = 0.90;
    sizeMultiplier = 0.90;
    parts.push(`uncertain: ADX ${a.toFixed(1)}, CHOP ${c.toFixed(1)}, AC1 ${ac.toFixed(2)}`);
  }

  // Additional mild volatility penalty (keeps confidence from spiking in noisy markets)
  const volPenalty = clamp(1.0 / Math.max(1.0, v), 0.65, 1.0);
  confidenceMultiplier = clamp(confidenceMultiplier * volPenalty, 0.40, 1.20);

  return {
    regime,
    confidenceMultiplier,
    sizeMultiplier,
    reason: parts.join('; '),
    metrics: { adx, choppiness, autocorr1, volRatio }
  };
}
