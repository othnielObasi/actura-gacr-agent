import {
  deriveReputationStatus,
  getCapitalLimitPct,
  getCapitalMultiplier,
  getLatestObservation,
  getReputationHistory,
  recordTrustObservation,
  resetReputationHistory,
  resolveTrustTier,
} from '../src/trust/reputation-evolution.js';

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

console.log('\n🧪 REPUTATION EVOLUTION TESTS\n');
resetReputationHistory();

const obs1 = recordTrustObservation({ agentId: 7, trustScore: 78, previousScore: null, timestamp: '2026-03-06T00:00:00Z' });
const obs2 = recordTrustObservation({ agentId: 7, trustScore: 91, previousScore: 78, timestamp: '2026-03-06T01:00:00Z' });

assert(obs1.trustTier === 'limited', `Score 78 => limited (${obs1.trustTier})`);
assert(obs2.rawTrustTier === 'elevated', `Score 91 raw tier => elevated (${obs2.rawTrustTier})`);
assert(obs2.trustDelta === 13, `Trust delta computed (${obs2.trustDelta})`);
assert(getCapitalMultiplier(91) === 1.0, 'Elevated tier multiplier is 1.0x');
assert(getCapitalLimitPct(78) === 0.06, 'Limited tier capital cap is 6%');
assert(deriveReputationStatus(91) === 'trusted', 'Status trusted for high score');
assert(resolveTrustTier(55).tier === 'probation', 'Low score maps to probation');
assert(getReputationHistory(7, 10).length === 2, 'History stores observations');
assert(getLatestObservation(7)?.trustScore === 91, 'Latest observation returned');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

assert(typeof obs2.recoveryMode === 'boolean', 'Recovery mode flag present');
