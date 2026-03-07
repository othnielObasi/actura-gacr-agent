import assert from 'assert';
import {
  computeMaxDrawdown,
  computeProfitFactor,
  computeRiskAdjustedMetrics,
  equityToReturns,
} from '../src/analytics/performance-metrics.js';

const equity = [
  { timestamp: '2026-03-07T10:00:00Z', equity: 10000 },
  { timestamp: '2026-03-07T10:05:00Z', equity: 10100 },
  { timestamp: '2026-03-07T10:10:00Z', equity: 10050 },
  { timestamp: '2026-03-07T10:15:00Z', equity: 10250 },
  { timestamp: '2026-03-07T10:20:00Z', equity: 10180 },
];

const trades = [
  { pnl: 100 },
  { pnl: -50 },
  { pnl: 200 },
  { pnl: -70 },
];

const returns = equityToReturns(equity);
assert.strictEqual(returns.length, 4);
assert.ok(returns[0] > 0);

const drawdown = computeMaxDrawdown(equity);
assert.ok(drawdown > 0);
assert.ok(drawdown < 0.02);

const pf = computeProfitFactor(trades);
assert.ok(pf > 2);

const metrics = computeRiskAdjustedMetrics(equity, trades, 0);
assert.ok(metrics.totalReturn > 0);
assert.ok(metrics.maxDrawdown === drawdown);
assert.ok(metrics.profitFactor === pf);
assert.ok(metrics.winRate === 0.5);
assert.ok(Number.isFinite(metrics.sharpeRatio));
assert.ok(Number.isFinite(metrics.sortinoRatio));
assert.ok(Number.isFinite(metrics.calmarRatio));

console.log('Performance metrics tests passed');
