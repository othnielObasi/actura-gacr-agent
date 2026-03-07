/**
 * Test Runner — runs all Actura tests
 */
import { spawnSync } from 'child_process';
const tests = [
    { name: 'Strategy & Indicators', cmd: ['npx', 'tsx', 'test/test-strategy.ts'] },
    { name: 'Risk Engine', cmd: ['npx', 'tsx', 'test/test-risk.ts'] },
    { name: 'Validation Artifacts', cmd: ['npx', 'tsx', 'test/test-artifacts.ts'] },
    { name: 'Chain Integration', cmd: ['npx', 'tsx', 'test/test-chain.ts'] },
    { name: 'Agent Mandate Engine', cmd: ['npx', 'tsx', 'test/test-mandate-engine.ts'] },
    { name: 'Execution Simulator', cmd: ['npx', 'tsx', 'test/test-execution-simulator.ts'] },
    { name: 'Oracle Integrity Guard', cmd: ['npx', 'tsx', 'test/test-oracle-integrity.ts'] },
    { name: 'Trust Policy Scorecard', cmd: ['npx', 'tsx', 'test/test-trust-scorecard.ts'] },
    { name: 'Supervisory Meta-Agent', cmd: ['npx', 'tsx', 'test/test-supervisory-meta-agent.ts'] },
];
console.log('');
console.log('═══════════════════════════════════════════');
console.log('  ACTURA TEST SUITE');
console.log('═══════════════════════════════════════════');
console.log('');
let allPassed = true;
for (const test of tests) {
    console.log(`\n▶ Running: ${test.name}`);
    console.log('─'.repeat(45));
    const result = spawnSync(test.cmd[0], test.cmd.slice(1), {
        stdio: 'inherit',
        cwd: process.cwd(),
        shell: false,
    });
    const passed = !result.error && (result.status === 0 || (result.status === null && result.signal === null));
    if (passed) {
        console.log(`✅ ${test.name} — PASSED\n`);
    }
    else {
        console.log(`❌ ${test.name} — FAILED\n`);
        allPassed = false;
    }
}
console.log('═══════════════════════════════════════════');
if (allPassed) {
    console.log('  ALL TESTS PASSED ✅');
}
else {
    console.log('  SOME TESTS FAILED ❌');
}
console.log('═══════════════════════════════════════════\n');
process.exit(allPassed ? 0 : 1);
//# sourceMappingURL=run-tests.js.map