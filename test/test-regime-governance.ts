import { recordTradeOutcome, getContextConfidenceBias } from '../src/strategy/adaptive-learning.js';
import { RegimeGovernanceController } from '../src/strategy/regime-governance.js';

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

console.log('\n🧪 REGIME GOVERNANCE TESTS\n');

for (let i = 0; i < 8; i++) {
  recordTradeOutcome({
    direction: 'LONG',
    entryPrice: 100,
    exitPrice: 103,
    pnlPct: 3,
    stopHit: false,
    regime: 'high',
    confidence: 0.7,
    timestamp: new Date().toISOString(),
  });
}
for (let i = 0; i < 2; i++) {
  recordTradeOutcome({
    direction: 'LONG',
    entryPrice: 100,
    exitPrice: 98,
    pnlPct: -2,
    stopHit: true,
    regime: 'high',
    confidence: 0.7,
    timestamp: new Date().toISOString(),
  });
}

const bias = getContextConfidenceBias({ regime: 'high', direction: 'LONG', confidence: 0.7 });
assert(bias > 0, `Context bias is positive for winning regime/direction: ${bias.toFixed(4)}`);

const gov = new RegimeGovernanceController();
const first = gov.step({ cycleNumber: 1, volatility: 0.045, drawdownPct: 0.01, direction: 'LONG', confidence: 0.7, regime: 'extreme' });
assert(first.profileName === 'EXTREME_DEFENSIVE', `Extreme volatility selects defensive profile (got ${first.profileName})`);
assert(first.adjustedConfidence >= 0 && first.adjustedConfidence <= 1, 'Adjusted confidence remains bounded');

const second = gov.step({ cycleNumber: 2, volatility: 0.044, drawdownPct: 0.08, direction: 'LONG', confidence: 0.7, regime: 'extreme' });
assert(second.profile.stopLossAtrMultiple >= 1.5, 'Defensive profile keeps wider stop loss');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
