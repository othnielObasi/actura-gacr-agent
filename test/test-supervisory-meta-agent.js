/**
 * Supervisory Meta-Agent tests
 */
import { evaluateSupervisoryDecision, applySupervisorySizing } from '../src/agent/supervisory-meta-agent.js';
let passed = 0;
let failed = 0;
function assert(condition, name) {
    if (condition) {
        console.log(`  ✅ ${name}`);
        passed++;
    }
    else {
        console.log(`  ❌ ${name}`);
        failed++;
    }
}
console.log('\n🧪 SUPERVISORY META-AGENT TESTS\n');
const trusted = evaluateSupervisoryDecision({
    trustScore: 93,
    drawdownPct: 0.012,
    structureRegime: 'TRENDING',
    edgeAllowed: true,
    volatilityRegime: 'normal',
    currentOpenPositions: 1,
    maxOpenPositions: 5,
});
assert(trusted.canTrade === true, 'Trusted trending state allows trading');
assert(['allowed', 'throttled'].includes(trusted.status), `Status valid: ${trusted.status}`);
assert(trusted.capitalLimitPct >= 0.08, `Capital ladder grants healthy cap: ${trusted.capitalLimitPct}`);
const stressed = evaluateSupervisoryDecision({
    trustScore: 74,
    drawdownPct: 0.031,
    structureRegime: 'STRESSED',
    edgeAllowed: true,
    volatilityRegime: 'high',
    currentOpenPositions: 1,
    maxOpenPositions: 5,
});
assert(stressed.canTrade === false, 'Stress + lower trust pauses trading');
assert(stressed.status === 'paused', `Stress status paused: ${stressed.status}`);
const noEdge = evaluateSupervisoryDecision({
    trustScore: 95,
    drawdownPct: 0.0,
    structureRegime: 'TRENDING',
    edgeAllowed: false,
    volatilityRegime: 'normal',
    currentOpenPositions: 0,
    maxOpenPositions: 5,
});
assert(noEdge.canTrade === false, 'Edge gate can block trading');
assert(noEdge.restrictions.includes('edge_gate'), 'Edge restriction recorded');
const resized = applySupervisorySizing(0.1, 10000, 3000, trusted);
assert(resized > 0, `Supervisory sizing returns positive units: ${resized}`);
assert(resized <= 0.1, 'Supervisory sizing never expands requested units');
const zeroed = applySupervisorySizing(0.1, 10000, 3000, stressed);
assert(zeroed === 0, 'Paused supervisory decision zeroes size');
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
//# sourceMappingURL=test-supervisory-meta-agent.js.map