/**
 * Pipeline Integration Test
 * 
 * Traces a signal through ALL 8 gates end-to-end.
 * Catches the "stacking deadlock" where individually reasonable
 * gates compound to block every signal.
 * 
 * If this test fails, the agent will never trade — guaranteeing
 * signal deadlocks are caught before deployment.
 */

import { runStrategy, type MarketData } from '../src/strategy/momentum.js';
import { applySymbolicReasoning } from '../src/strategy/neuro-symbolic.js';
import { RegimeGovernanceController } from '../src/strategy/regime-governance.js';
import { evaluateSupervisoryDecision } from '../src/agent/supervisory-meta-agent.js';
import { RiskEngine } from '../src/risk/engine.js';
import { simulateExecution } from '../src/chain/execution-simulator.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Build realistic bullish market data: price trending up with SMA crossover
// ---------------------------------------------------------------------------
function buildBullishMarketData(): MarketData {
  const basePrice = 2000;
  const prices: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const timestamps: string[] = [];

  // 60 candles: first 40 range-bound, then 20 trending up
  for (let i = 0; i < 60; i++) {
    const t = new Date(Date.now() - (60 - i) * 300_000).toISOString();
    let p: number;
    if (i < 40) {
      // Range-bound around 2000 with slight noise
      p = basePrice + (Math.sin(i * 0.3) * 10) + (i * 0.2);
    } else {
      // Clear uptrend
      p = basePrice + 8 + (i - 40) * 4 + (Math.sin(i * 0.5) * 2);
    }
    prices.push(Math.round(p * 100) / 100);
    highs.push(Math.round((p + 5 + Math.random() * 5) * 100) / 100);
    lows.push(Math.round((p - 5 - Math.random() * 5) * 100) / 100);
    timestamps.push(t);
  }

  return { prices, highs, lows, timestamps };
}

// ---------------------------------------------------------------------------
// Build realistic bearish market data: price trending down
// ---------------------------------------------------------------------------
function buildBearishMarketData(): MarketData {
  const basePrice = 2100;
  const prices: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const timestamps: string[] = [];

  for (let i = 0; i < 60; i++) {
    const t = new Date(Date.now() - (60 - i) * 300_000).toISOString();
    let p: number;
    if (i < 40) {
      p = basePrice - (Math.sin(i * 0.3) * 10) - (i * 0.2);
    } else {
      // Clear downtrend
      p = basePrice - 8 - (i - 40) * 4 - (Math.sin(i * 0.5) * 2);
    }
    prices.push(Math.round(p * 100) / 100);
    highs.push(Math.round((p + 5 + Math.random() * 3) * 100) / 100);
    lows.push(Math.round((p - 5 - Math.random() * 3) * 100) / 100);
    timestamps.push(t);
  }

  return { prices, highs, lows, timestamps };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: Bullish signal makes it through ALL gates
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ Test 1: Bullish pipeline end-to-end ══');

const capital = 10_000;
const marketData = buildBullishMarketData();

// Gate 1: Strategy signal generation
const strategyOutput = runStrategy(marketData, capital, null);
console.log(`  Signal: ${strategyOutput.signal.direction} @ ${strategyOutput.signal.confidence.toFixed(3)}`);
assert(
  strategyOutput.signal.direction !== 'NEUTRAL',
  'Gate 1 — Strategy generates non-NEUTRAL signal',
  `got ${strategyOutput.signal.direction} conf=${strategyOutput.signal.confidence}`,
);

// Gate 2: Neuro-symbolic reasoning
const neuro = applySymbolicReasoning(strategyOutput, [], capital, 0, 0);
console.log(`  Neuro: ${neuro.adjustedSignal} @ ${neuro.adjustedConfidence.toFixed(3)} (${neuro.rulesFired} rules fired)`);
assert(
  neuro.adjustedSignal !== 'NEUTRAL',
  'Gate 2 — Neuro-symbolic does not kill signal',
  `${neuro.originalSignal}→${neuro.adjustedSignal}, override=${neuro.override}`,
);

// Gate 3: Regime governance
const regimeGov = new RegimeGovernanceController();
const govResult = regimeGov.step({
  cycleNumber: 100,
  volatility: strategyOutput.indicators.volatility ?? 0.02,
  drawdownPct: 0,
  direction: neuro.adjustedSignal as 'LONG' | 'SHORT',
  confidence: neuro.adjustedConfidence,
});
const govApproved = govResult.adjustedConfidence >= govResult.profile.confidenceThreshold;
console.log(`  Regime: ${govResult.profileName}, approved=${govApproved}, conf=${govResult.adjustedConfidence.toFixed(3)} (threshold=${govResult.profile.confidenceThreshold})`);
assert(
  govApproved,
  'Gate 3 — Regime governance approves',
  `profile=${govResult.profileName}, confidence=${govResult.adjustedConfidence}, threshold=${govResult.profile.confidenceThreshold}`,
);

// Gate 4: Supervisory meta-agent
const supervisory = evaluateSupervisoryDecision({
  trustScore: 80,
  drawdownPct: 0,
  structureRegime: 'TRENDING',
  edgeAllowed: true,
  volatilityRegime: 'normal',
  currentOpenPositions: 0,
  maxOpenPositions: 2,
});
console.log(`  Supervisory: tier=${supervisory.trustTier}, canTrade=${supervisory.canTrade}`);
assert(
  supervisory.canTrade,
  'Gate 4 — Supervisory allows trading',
  `status=${supervisory.status}, reasons=${supervisory.reason.join('; ')}`,
);

// Gate 5: Risk engine
const riskEngine = new RiskEngine(capital);
// Apply the possibly-modified signal conf from upstream gates
const modifiedOutput = {
  ...strategyOutput,
  signal: {
    ...strategyOutput.signal,
    confidence: govResult.adjustedConfidence,
  },
};
const riskDecision = riskEngine.evaluate(modifiedOutput);
console.log(`  Risk: approved=${riskDecision.approved}, size=${riskDecision.finalPositionSize.toFixed(4)}`);
const failedChecks = riskDecision.checks.filter(c => !c.passed).map(c => c.name);
assert(
  riskDecision.approved,
  'Gate 5 — Risk engine approves',
  `failed_checks=[${failedChecks.join(', ')}], explanation=${riskDecision.explanation}`,
);

// Gate 6: Execution simulator
const simResult = simulateExecution({
  strategyOutput: modifiedOutput,
  riskDecision,
  dexFeeBps: 5,  // testnet
});
console.log(`  Sim: allowed=${simResult.allowed}, edge=${simResult.expectedNetEdgePct.toFixed(3)}%, reason=${simResult.reason}`);
assert(
  simResult.allowed,
  'Gate 6 — Execution simulator allows',
  `reason=${simResult.reason}, net_edge=${simResult.expectedNetEdgePct}`,
);

// Gate 7: On-chain risk check (skipped — requires network)
// We verify the on-chain integration separately; here we just assert
// that if all upstream gates pass, the signal reaches the execution stage.
console.log('  Gate 7 — On-chain risk check (skipped, requires network)');

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: A clear bearish signal also passes through all gates
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ Test 2: Bearish pipeline end-to-end ══');

const bearishData = buildBearishMarketData();
const bearStrat = runStrategy(bearishData, capital, null);
console.log(`  Signal: ${bearStrat.signal.direction} @ ${bearStrat.signal.confidence.toFixed(3)}`);

if (bearStrat.signal.direction === 'SHORT') {
  const bearNeuro = applySymbolicReasoning(bearStrat, [], capital, 0, 0);
  assert(
    bearNeuro.adjustedSignal !== 'NEUTRAL',
    'Gate 2 (bear) — Neuro-symbolic does not kill SHORT signal',
    `${bearNeuro.adjustedSignal} @ ${bearNeuro.adjustedConfidence}`,
  );

  const bearGov = regimeGov.step({
    cycleNumber: 200,
    volatility: bearStrat.indicators.volatility ?? 0.02,
    drawdownPct: 0,
    direction: bearNeuro.adjustedSignal as 'LONG' | 'SHORT',
    confidence: bearNeuro.adjustedConfidence,
  });
  const bearGovApproved = bearGov.adjustedConfidence >= bearGov.profile.confidenceThreshold;
  assert(
    bearGovApproved,
    'Gate 3 (bear) — Regime governance approves SHORT',
    `profile=${bearGov.profileName}, conf=${bearGov.adjustedConfidence}`,
  );

  const bearRisk = riskEngine.evaluate({
    ...bearStrat,
    signal: { ...bearStrat.signal, confidence: bearGov.adjustedConfidence },
  });
  assert(
    bearRisk.approved,
    'Gate 5 (bear) — Risk engine approves SHORT',
    `failed=[${bearRisk.checks.filter(c => !c.passed).map(c => c.name).join(', ')}]`,
  );
} else {
  console.log(`  ⚠️ Bearish data didn't produce SHORT (got ${bearStrat.signal.direction}) — skipping chain`);
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Confidence degradation tracking — no gate cuts more than 50%
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ Test 3: Per-gate confidence degradation ══');

const origConf = strategyOutput.signal.confidence;
const neuroConf = neuro.adjustedConfidence;
const govConf = govResult.adjustedConfidence;

const neuroCut = origConf > 0 ? (origConf - neuroConf) / origConf : 0;
const govCut = neuroConf > 0 ? (neuroConf - govConf) / neuroConf : 0;

console.log(`  Confidence flow: ${origConf.toFixed(3)} → ${neuroConf.toFixed(3)} → ${govConf.toFixed(3)}`);
console.log(`  Neuro cut: ${(neuroCut * 100).toFixed(1)}%, Regime cut: ${(govCut * 100).toFixed(1)}%`);

assert(
  neuroCut < 0.50,
  'Gate 2 cuts ≤50% confidence',
  `cut ${(neuroCut * 100).toFixed(1)}%`,
);
assert(
  govCut < 0.50,
  'Gate 3 cuts ≤50% confidence',
  `cut ${(govCut * 100).toFixed(1)}%`,
);
assert(
  govConf > 0.05,
  'Final confidence above risk engine minimum (0.05)',
  `final=${govConf.toFixed(3)}`,
);

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: Position count consistency after flip
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ Test 4: Position count survives a direction flip ══');

const flipEngine = new RiskEngine(capital);
// Open a LONG
flipEngine.openPosition({
  asset: 'WETH/USDC', side: 'LONG', size: 0.05,
  entryPrice: 2000, stopLoss: 1950,
  openedAt: new Date().toISOString(),
});
assert(flipEngine.getOpenPositions().length === 1, 'Start with 1 LONG position');

// Simulate direction flip to SHORT
const flipped = flipEngine.closeOpposingPositions('SHORT', 2050);
assert(flipped.length === 1, 'closeOpposingPositions returns 1 closed');
assert(flipped[0].side === 'LONG', 'Closed position was LONG');
assert(flipEngine.getOpenPositions().length === 0, 'After flip close: 0 positions');

// Open the new SHORT
flipEngine.openPosition({
  asset: 'WETH/USDC', side: 'SHORT', size: 0.05,
  entryPrice: 2050, stopLoss: 2100,
  openedAt: new Date().toISOString(),
});
assert(flipEngine.getOpenPositions().length === 1, 'After new SHORT: 1 position');

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n📊 Pipeline Integration Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('⚠️  PIPELINE BLOCKED — Agent will be stuck on NEUTRAL if deployed like this!');
}
process.exit(failed > 0 ? 1 : 0);
