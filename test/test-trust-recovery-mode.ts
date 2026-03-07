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
// --- Default regime (UNKNOWN) — requires 3 compliant cycles ---
const drop = recordTrustObservation({ agentId, trustScore: 68, previousScore: 84, timestamp: '2026-03-06T00:00:00Z' });
assert(drop.recoveryMode === true, 'Recovery mode activates after trust deterioration');
assert(drop.trustTier === 'probation' || drop.trustTier === 'limited', `Effective tier throttled in recovery (${drop.trustTier})`);

recordTrustObservation({ agentId, trustScore: 83, previousScore: 68, timestamp: '2026-03-06T01:00:00Z' });
recordTrustObservation({ agentId, trustScore: 85, previousScore: 83, timestamp: '2026-03-06T02:00:00Z' });
const restored = recordTrustObservation({ agentId, trustScore: 87, previousScore: 85, timestamp: '2026-03-06T03:00:00Z' });
assert(restored.recoveryMode === false, 'Recovery mode clears after 3 compliant actions (UNKNOWN regime)');
assert(getRecoveryState(agentId).active === false, 'Recovery state stored as inactive');
assert((getLatestObservation(agentId)?.trustTier ?? '') === 'standard', 'Tier restores after recovery completes');

// --- TRENDING regime — requires only 2 compliant cycles ---
resetReputationHistory();
const agent2 = 43;
recordTrustObservation({ agentId: agent2, trustScore: 68, previousScore: 84, timestamp: '2026-03-07T00:00:00Z', regime: 'TRENDING' });
recordTrustObservation({ agentId: agent2, trustScore: 83, previousScore: 68, timestamp: '2026-03-07T01:00:00Z', regime: 'TRENDING' });
const trendRestore = recordTrustObservation({ agentId: agent2, trustScore: 86, previousScore: 83, timestamp: '2026-03-07T02:00:00Z', regime: 'TRENDING' });
assert(trendRestore.recoveryMode === false, 'TRENDING regime exits recovery after 2 compliant cycles');

// --- STRESSED regime — requires 4 compliant cycles ---
resetReputationHistory();
const agent3 = 44;
recordTrustObservation({ agentId: agent3, trustScore: 68, previousScore: 84, timestamp: '2026-03-08T00:00:00Z', regime: 'STRESSED' });
recordTrustObservation({ agentId: agent3, trustScore: 83, previousScore: 68, timestamp: '2026-03-08T01:00:00Z', regime: 'STRESSED' });
recordTrustObservation({ agentId: agent3, trustScore: 85, previousScore: 83, timestamp: '2026-03-08T02:00:00Z', regime: 'STRESSED' });
const stressStill = recordTrustObservation({ agentId: agent3, trustScore: 87, previousScore: 85, timestamp: '2026-03-08T03:00:00Z', regime: 'STRESSED' });
assert(stressStill.recoveryMode === true, 'STRESSED regime still in recovery after 3 cycles (needs 4)');
const stressDone = recordTrustObservation({ agentId: agent3, trustScore: 89, previousScore: 87, timestamp: '2026-03-08T04:00:00Z', regime: 'STRESSED' });
assert(stressDone.recoveryMode === false, 'STRESSED regime exits recovery after 4 compliant cycles');

// --- Graduated deduction: minor dip reduces streak by 1 instead of full reset ---
resetReputationHistory();
const agent4 = 45;
recordTrustObservation({ agentId: agent4, trustScore: 68, previousScore: 84, timestamp: '2026-03-09T00:00:00Z' });
recordTrustObservation({ agentId: agent4, trustScore: 83, previousScore: 68, timestamp: '2026-03-09T01:00:00Z' });
assert(getRecoveryState(agent4).streak === 1, 'Streak is 1 after first compliant cycle');
// Minor dip below trigger score (trustDelta = -4, above -5 threshold)
recordTrustObservation({ agentId: agent4, trustScore: 79, previousScore: 83, timestamp: '2026-03-09T02:00:00Z' });
assert(getRecoveryState(agent4).streak === 0, 'Graduated deduction: streak decremented by 1 (not hard reset)');
assert(getRecoveryState(agent4).active === true, 'Still in recovery after minor dip');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
