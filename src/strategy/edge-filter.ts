/**
 * Expected Edge Filter (Additional Sharpe Module)
 * ----------------------------------------------
 * Purpose: reduce churn and improve Sharpe by skipping trades where the
 * expected move (based on ATR + confidence) is not large enough to overcome
 * execution costs (slippage + spread proxy).
 *
 * This is common in real trading: don't trade unless expected edge > costs.
 *
 * It is deterministic, auditable, and bounded.
 */

export interface EdgeFilterInput {
  currentPrice: number;
  atr: number | null;
  confidence: number;       // 0..1
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
  // Estimated all-in cost in bps (slippage + spread + fees proxy)
  costBps?: number;
  // Minimum edge multiple over cost (e.g. 1.5x means require 1.5 * cost)
  minEdgeMultiple?: number;
}

export interface EdgeFilterResult {
  allowed: boolean;
  expectedEdgePct: number;
  estimatedCostPct: number;
  reason: string;
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

export function evaluateEdge(input: EdgeFilterInput): EdgeFilterResult {
  const costBps = input.costBps ?? 10; // 0.10% sandbox default (use 20-25 for live)
  const minEdgeMultiple = input.minEdgeMultiple ?? 0.5; // aggressive scalping: allow trades with 0.5x edge over cost

  // If no trade, allow trivially
  if (input.side === 'NEUTRAL') {
    return {
      allowed: true,
      expectedEdgePct: 0,
      estimatedCostPct: costBps / 10000,
      reason: 'NEUTRAL signal'
    };
  }

  if (input.atr === null || input.currentPrice <= 0) {
    // Not enough data → be conservative and allow risk engine to gate
    return {
      allowed: true,
      expectedEdgePct: 0,
      estimatedCostPct: costBps / 10000,
      reason: 'No ATR available; skipping edge filter'
    };
  }

  // Expected move proxy: confidence * ATR% (bounded)
  const atrPct = input.atr / input.currentPrice; // e.g. 0.01 = 1%
  const expectedEdgePct = clamp(input.confidence * atrPct, 0, 0.10); // cap 10%

  const estimatedCostPct = costBps / 10000;
  const required = estimatedCostPct * minEdgeMultiple;

  if (expectedEdgePct < required) {
    return {
      allowed: false,
      expectedEdgePct,
      estimatedCostPct,
      reason: `Edge too small: expected ${(expectedEdgePct*100).toFixed(2)}% < required ${(required*100).toFixed(2)}% (cost ${(estimatedCostPct*100).toFixed(2)}%)`
    };
  }

  return {
    allowed: true,
    expectedEdgePct,
    estimatedCostPct,
    reason: `Edge OK: expected ${(expectedEdgePct*100).toFixed(2)}% ≥ required ${(required*100).toFixed(2)}%`
  };
}
