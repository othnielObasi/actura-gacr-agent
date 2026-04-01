import type { StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision } from '../risk/engine.js';
import type { DexId } from './dex-router.js';

export interface ExecutionSimulationInput {
  strategyOutput: StrategyOutput;
  riskDecision: RiskDecision;
  gasUsd?: number;
  liquidityBudgetUsd?: number;
  externalCostBps?: number;
  /** Selected DEX identifier from routing decision */
  dexId?: DexId;
  /** DEX-specific fee in bps (overrides externalCostBps when provided) */
  dexFeeBps?: number;
}

export interface ExecutionSimulationResult {
  allowed: boolean;
  reason: string;
  estimatedFillPrice: number;
  estimatedSlippageBps: number;
  estimatedGasUsd: number;
  estimatedTotalCostUsd: number;
  expectedNetEdgePct: number;
  expectedWorstCasePct: number;
  priceImpactPct: number;
  simulationVersion: string;
  dexId: DexId | null;
}

export function simulateExecution(input: ExecutionSimulationInput): ExecutionSimulationResult {
  const { strategyOutput, riskDecision } = input;
  const price = strategyOutput.currentPrice;
  const sizeUnits = riskDecision.finalPositionSize;
  const notionalUsd = sizeUnits * price;
  const vol = strategyOutput.indicators.volatility ?? riskDecision.volatility.current ?? 0.02;
  const liquidityBudgetUsd = input.liquidityBudgetUsd ?? 25000;
  const gasUsd = input.gasUsd ?? 0.35;
  const baseBps = input.dexFeeBps ?? input.externalCostBps ?? 5; // sandbox (use 8 for live)

  const sizePressure = liquidityBudgetUsd > 0 ? Math.min(1.5, notionalUsd / liquidityBudgetUsd) : 0;

  // Slippage model: base fee + volatility component + size pressure.
  // The vol multiplier is calibrated so that typical real-world ETH vol
  // (~0.001-0.003 per bar on hourly/4h candles) produces 5-25 bps slippage
  // for small trades (~$200-$500), which matches real Uniswap v3 execution.
  const volMultiplier = 600;
  const estimatedSlippageBps = round2(baseBps + vol * volMultiplier + sizePressure * 18);
  const priceImpactPct = estimatedSlippageBps / 10000;
  const sideSign = strategyOutput.signal.direction === 'SHORT' ? -1 : 1;
  const estimatedFillPrice = round4(price * (1 + sideSign * priceImpactPct));

  const stopDistPct = strategyOutput.stopLossPrice !== null
    ? Math.abs(price - strategyOutput.stopLossPrice) / price
    : Math.max(vol * 1.2, 0.01);

  const confidence = strategyOutput.signal.confidence;
  const expectedGrossEdgePct = Math.max(0, confidence * Math.max(stopDistPct * 0.85, vol * 0.8));
  const explicitCostPct = price > 0 && sizeUnits > 0 ? (gasUsd / Math.max(notionalUsd, 1e-9)) : 0;
  const totalCostPct = priceImpactPct + explicitCostPct;
  const expectedNetEdgePct = expectedGrossEdgePct - totalCostPct;
  const expectedWorstCasePct = -(stopDistPct + totalCostPct);
  const estimatedTotalCostUsd = round2(notionalUsd * priceImpactPct + gasUsd);

  let allowed = true;
  let reason = 'simulation_pass';

  if (sizeUnits <= 0 || strategyOutput.signal.direction === 'NEUTRAL') {
    allowed = false;
    reason = 'no_executable_trade';
  } else if (estimatedSlippageBps > 120) {
    allowed = false;
    reason = 'slippage_too_high';
  } else if (expectedNetEdgePct <= 0) { // require positive net edge (costs don't exceed expected profit)
    allowed = false;
    reason = 'net_edge_too_low';
  } else if (riskDecision.volatility.regime === 'extreme') {
    allowed = false;
    reason = 'extreme_volatility_simulation_block';
  }

  return {
    allowed,
    reason,
    estimatedFillPrice,
    estimatedSlippageBps,
    estimatedGasUsd: gasUsd,
    estimatedTotalCostUsd,
    expectedNetEdgePct: round4(expectedNetEdgePct),
    expectedWorstCasePct: round4(expectedWorstCasePct),
    priceImpactPct: round4(priceImpactPct),
    simulationVersion: '1.0',
    dexId: input.dexId ?? null,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
