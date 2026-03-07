import type { StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision } from '../risk/engine.js';

export interface ExecutionSimulationInput {
  strategyOutput: StrategyOutput;
  riskDecision: RiskDecision;
  gasUsd?: number;
  liquidityBudgetUsd?: number;
  externalCostBps?: number;
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
}

export function simulateExecution(input: ExecutionSimulationInput): ExecutionSimulationResult {
  const { strategyOutput, riskDecision } = input;
  const price = strategyOutput.currentPrice;
  const sizeUnits = riskDecision.finalPositionSize;
  const notionalUsd = sizeUnits * price;
  const vol = strategyOutput.indicators.volatility ?? riskDecision.volatility.current ?? 0.02;
  const liquidityBudgetUsd = input.liquidityBudgetUsd ?? 25000;
  const gasUsd = input.gasUsd ?? 0.35;
  const baseBps = input.externalCostBps ?? 8;

  const sizePressure = liquidityBudgetUsd > 0 ? Math.min(1.5, notionalUsd / liquidityBudgetUsd) : 0;
  const estimatedSlippageBps = round2(baseBps + vol * 4500 + sizePressure * 18);
  const priceImpactPct = estimatedSlippageBps / 10000;
  const sideSign = strategyOutput.signal.direction === 'SHORT' ? -1 : 1;
  const estimatedFillPrice = round4(price * (1 + sideSign * priceImpactPct));

  const stopDistPct = strategyOutput.stopLossPrice !== null
    ? Math.abs(price - strategyOutput.stopLossPrice) / price
    : Math.max(vol * 1.2, 0.01);

  const confidence = strategyOutput.signal.confidence;
  const expectedGrossEdgePct = Math.max(0, confidence * Math.max(stopDistPct * 0.75, vol * 0.6));
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
  } else if (estimatedSlippageBps > 75) {
    allowed = false;
    reason = 'slippage_too_high';
  } else if (expectedNetEdgePct <= 0.0005) {
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
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
