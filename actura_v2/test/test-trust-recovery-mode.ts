import {
  getLatestObservation,
  getRecoveryState,
  recordTrustObservation,
  resetReputationHistory,
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

console.log('\n🧪 TRUST RECOVERY MODE TESTS\n');
resetReputationHistory();

const agentId = 42;
const drop = recordTrustObservation({ agentId, trustScore: 68, previousScore: 84, timestamp: '2026-03-06T00:00:00Z' });
assert(drop.recoveryMode === true, 'Recovery mode activates after trust deterioration');
assert(drop.trustTier === 'probation' || drop.trustTier === 'limited', `Effective tier throttled in recovery (${drop.trustTier})`);

recordTrustObservation({ agentId, trustScore: 83, previousScore: 68, timestamp: '2026-03-06T01:00:00Z' });
recordTrustObservation({ agentId, trustScore: 85, previousScore: 83, timestamp: '2026-03-06T02:00:00Z' });
const restored = recordTrustObservation({ agentId, trustScore: 87, previousScore: 85, timestamp: '2026-03-06T03:00:00Z' });
assert(restored.recoveryMode === false, 'Recovery mode clears after consecutive compliant actions');
assert(getRecoveryState(agentId).active === false, 'Recovery state stored as inactive');
assert((getLatestObservation(agentId)?.trustTier ?? '') === 'standard', 'Tier restores after recovery completes');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
