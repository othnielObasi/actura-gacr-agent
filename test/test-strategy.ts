/**
 * Strategy Tests
 * Tests indicators, signals, and the momentum strategy
 */

import { sma, ewmaVolatility, atr, sharpeRatio, dailyReturns } from '../src/strategy/indicators.js';
import { generateSignal } from '../src/strategy/signals.js';
import { runStrategy, resetStrategy } from '../src/strategy/momentum.js';
import { generateSimulatedData, generateTrendingData } from '../src/data/price-feed.js';

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

console.log('\n🧪 STRATEGY TESTS\n');

// ── Indicators ──
console.log('── Indicators ──');

assert(sma([1, 2, 3, 4, 5], 3) === 4, 'SMA(3) of [1,2,3,4,5] = 4');
assert(sma([1, 2, 3, 4, 5], 5) === 3, 'SMA(5) of [1,2,3,4,5] = 3');
assert(sma([1, 2], 5) === null, 'SMA returns null when insufficient data');

const vol = ewmaVolatility([100, 102, 101, 103, 105, 104, 106], 5);
assert(vol !== null && vol > 0, `EWMA volatility is positive: ${vol?.toFixed(6)}`);
assert(ewmaVolatility([100], 5) === null, 'EWMA returns null with 1 price');

const atrVal = atr(
  [11, 12, 13, 12, 14, 15, 14, 16, 17, 16, 15, 14, 15, 16, 17, 18],
  [9, 10, 11, 10, 12, 13, 12, 14, 15, 14, 13, 12, 13, 14, 15, 16],
  [10, 11, 12, 11, 13, 14, 13, 15, 16, 15, 14, 13, 14, 15, 16, 17],
  14
);
assert(atrVal !== null && atrVal > 0, `ATR(14) computed: ${atrVal?.toFixed(4)}`);

const returns = dailyReturns([100, 105, 103, 108, 110]);
assert(returns.length === 4, 'dailyReturns produces n-1 returns');
assert(Math.abs(returns[0] - 0.05) < 0.001, 'First return is ~5%');

const sr = sharpeRatio([0.01, 0.02, -0.005, 0.015, 0.01, -0.002, 0.008]);
assert(sr !== null && sr > 0, `Sharpe ratio positive for upward returns: ${sr?.toFixed(2)}`);

// ── Signals ──
console.log('\n── Signals ──');

const bullSignal = generateSignal({
  smaFast: 3050, smaSlow: 3000,
  prevSmaFast: 2990, prevSmaSlow: 3000,
  volatility: 0.02, baselineVolatility: 0.02,
  atr: 50, currentPrice: 3050
});
assert(bullSignal.direction === 'LONG', `Crossover up → LONG (got ${bullSignal.direction})`);
assert(bullSignal.name.includes('LONG'), `Signal name: ${bullSignal.name}`);

const bearSignal = generateSignal({
  smaFast: 2950, smaSlow: 3000,
  prevSmaFast: 3010, prevSmaSlow: 3000,
  volatility: 0.02, baselineVolatility: 0.02,
  atr: 50, currentPrice: 2950
});
assert(bearSignal.direction === 'SHORT', `Crossover down → SHORT (got ${bearSignal.direction})`);

const neutralSignal = generateSignal({
  smaFast: null, smaSlow: null,
  prevSmaFast: null, prevSmaSlow: null,
  volatility: null, baselineVolatility: 0.02,
  atr: null, currentPrice: 3000
});
assert(neutralSignal.direction === 'NEUTRAL', 'Null indicators → NEUTRAL');

// ── Strategy ──
console.log('\n── Strategy ──');

resetStrategy();
const upData = generateTrendingData('up', 100);
const output = runStrategy(upData, 10000);
assert(output.currentPrice > 0, `Current price: $${output.currentPrice.toFixed(2)}`);
assert(output.positionSize >= 0, `Position size: ${output.positionSize.toFixed(4)}`);
assert(output.indicators.smaFast !== null, `SMA fast computed: ${output.indicators.smaFast?.toFixed(2)}`);
assert(output.indicators.smaSlow !== null, `SMA slow computed: ${output.indicators.smaSlow?.toFixed(2)}`);

// Position sizing caps
resetStrategy();
const bigCapData = generateTrendingData('up', 100, 3000);
const bigOutput = runStrategy(bigCapData, 10000);
if (bigOutput.positionSize > 0) {
  const valueUsd = bigOutput.positionSize * bigOutput.currentPrice;
  assert(valueUsd <= 10000 * 0.10 + 1, `Position capped at 10% of capital: $${valueUsd.toFixed(2)}`);
}

// ── Summary ──
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
