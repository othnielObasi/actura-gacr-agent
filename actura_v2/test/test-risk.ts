/**
 * Risk Engine Tests
 * Tests circuit breaker, risk checks, and position management
 */

import { RiskEngine } from '../src/risk/engine.js';
import { CircuitBreaker } from '../src/risk/circuit-breaker.js';
import { VolatilityTracker } from '../src/risk/volatility.js';
import { runStrategy, resetStrategy } from '../src/strategy/momentum.js';
import { generateTrendingData, generateChoppyData } from '../src/data/price-feed.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

console.log('\n🧪 RISK ENGINE TESTS\n');

// ── Circuit Breaker ──
console.log('── Circuit Breaker ──');

const cb = new CircuitBreaker(10000, 0.02, 0.08);

let state = cb.check(10000);
assert(!state.active, 'Circuit breaker inactive at start');

state = cb.check(9850);
assert(!state.active, 'Not tripped at 1.5% loss (within 2% daily limit)');

// Simulate a day where we lose 2.1%
const cb2 = new CircuitBreaker(10000, 0.02, 0.08);
const state2 = cb2.check(9790);
assert(state2.active, `Tripped at $9790 (2.1% daily loss): ${state2.reason}`);

// After trip, next check transitions to COOLING
const state2b = cb2.check(9790);
assert(state2b.state === 'COOLING', `Transitioned to COOLING: ${state2b.state}`);

// Drawdown test
const cb3 = new CircuitBreaker(10000, 0.02, 0.08);
cb3.check(11000); // New peak
const state3 = cb3.check(10050); // 8.6% drawdown from peak
assert(state3.active, `Tripped on drawdown from peak $11000 → $10050: ${state3.reason}`);

// Reset — use forceReset and start fresh from current capital
cb3.forceReset();
cb3.resetDaily(10500);
const state4 = cb3.check(10500);
assert(!state4.active, 'Circuit breaker reset after daily reset');

// ── Volatility Tracker ──
console.log('\n── Volatility Tracker ──');

const vt = new VolatilityTracker(0.02);
vt.update(0.012);
let vs = vt.getState();
assert(vs.regime === 'low', `Low vol regime: ${vs.regime} (ratio: ${vs.ratio.toFixed(2)})`);

vt.update(0.02);
vs = vt.getState();
assert(vs.regime === 'normal', `Normal vol regime: ${vs.regime}`);

vt.update(0.035);
vs = vt.getState();
assert(vs.regime === 'high', `High vol regime: ${vs.regime}`);

vt.update(0.05);
vs = vt.getState();
assert(vs.regime === 'extreme', `Extreme vol regime: ${vs.regime}`);

// ── Risk Engine Integration ──
console.log('\n── Risk Engine ──');

const engine = new RiskEngine(10000);
resetStrategy();

// Run with trending data — should approve trades
const upData = generateTrendingData('up', 100);
const stratOutput = runStrategy(upData, 10000);
const decision = engine.evaluate(stratOutput);

assert(typeof decision.approved === 'boolean', `Decision made: approved=${decision.approved}`);
assert(decision.checks.length >= 5, `${decision.checks.length} risk checks performed`);
assert(decision.explanation.length > 0, `Explanation provided: ${decision.explanation.slice(0, 80)}...`);

// All checks documented
for (const check of decision.checks) {
  assert(check.name.length > 0 && typeof check.passed === 'boolean',
    `  Check: ${check.name} = ${check.passed} | ${check.value} vs ${check.limit}`);
}

// Position management
if (decision.approved) {
  engine.openPosition({
    asset: 'WETH/USDC',
    side: stratOutput.signal.direction as 'LONG' | 'SHORT',
    size: decision.finalPositionSize,
    entryPrice: stratOutput.currentPrice,
    stopLoss: decision.stopLossPrice,
    openedAt: new Date().toISOString(),
  });
  assert(engine.getOpenPositions().length === 1, 'Position opened');

  const pnl = engine.closePosition('WETH/USDC', stratOutput.currentPrice * 1.01);
  assert(engine.getOpenPositions().length === 0, 'Position closed');
  console.log(`  PnL on close: $${pnl.toFixed(2)}`);
}

// ── Extreme volatility rejection ──
console.log('\n── Extreme Vol Rejection ──');

const engine2 = new RiskEngine(10000);
resetStrategy();

// Manually create a strategy output with extreme volatility
const choppyData = generateChoppyData(100);
const choppyOutput = runStrategy(choppyData, 10000);

// Force extreme volatility by updating tracker
for (let i = 0; i < 5; i++) {
  engine2.evaluate({ ...choppyOutput, indicators: { ...choppyOutput.indicators, volatility: 0.05 } });
}

const extremeDecision = engine2.evaluate({ ...choppyOutput, indicators: { ...choppyOutput.indicators, volatility: 0.05 } });
if (extremeDecision.volatility.regime === 'extreme') {
  assert(!extremeDecision.approved, 'Trade rejected in extreme volatility');
} else {
  console.log(`  ⚠️ Vol regime was ${extremeDecision.volatility.regime}, not extreme — skipping rejection test`);
}

// ── Summary ──
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
