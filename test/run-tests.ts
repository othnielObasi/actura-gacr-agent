/**
 * Test Runner — runs all Actura tests
 */

import { spawnSync } from 'child_process';
import path from 'path';

const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cmdFor = (file: string) => [process.execPath, tsxCli, file];

const tests = [
  { name: 'Strategy & Indicators', cmd: cmdFor('test/test-strategy.ts') },
  { name: 'Risk Engine', cmd: cmdFor('test/test-risk.ts') },
  { name: 'Validation Artifacts', cmd: cmdFor('test/test-artifacts.ts') },
  { name: 'Chain Integration', cmd: cmdFor('test/test-chain.ts') },
  { name: 'Agent Mandate Engine', cmd: cmdFor('test/test-mandate-engine.ts') },
  { name: 'Execution Simulator', cmd: cmdFor('test/test-execution-simulator.ts') },
  { name: 'DEX Router', cmd: cmdFor('test/test-dex-router.ts') },
  { name: 'Oracle Integrity Guard', cmd: cmdFor('test/test-oracle-integrity.ts') },
  { name: 'Trust Policy Scorecard', cmd: cmdFor('test/test-trust-scorecard.ts') },
  { name: 'Reputation Evolution', cmd: cmdFor('test/test-reputation-evolution.ts') },
  { name: 'Trust Recovery Mode', cmd: cmdFor('test/test-trust-recovery-mode.ts') },
  { name: 'Supervisory Meta-Agent', cmd: cmdFor('test/test-supervisory-meta-agent.ts') },
  { name: 'Operator Control', cmd: cmdFor('test/test-operator-control.ts') },
  { name: 'Regime Governance', cmd: cmdFor('test/test-regime-governance.ts') },
  { name: 'Performance Metrics', cmd: cmdFor('test/test-performance-metrics.ts') },
  { name: 'MCP Surface', cmd: cmdFor('test/test-mcp-surface.ts') },
  { name: 'EIP-1271 Signature Verification', cmd: cmdFor('test/test-eip1271.ts') },
  { name: 'Kraken Feed', cmd: cmdFor('test/test-kraken-feed.ts') },
  { name: 'Event Indexer', cmd: cmdFor('test/test-event-indexer.ts') },
  { name: 'Pipeline Integration', cmd: cmdFor('test/test-pipeline-integration.ts') },
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

  const passed = !result.error && result.status === 0;

  if (passed) {
    console.log(`✅ ${test.name} — PASSED\n`);
  } else {
    console.log(`❌ ${test.name} — FAILED\n`);
    allPassed = false;
  }
}

console.log('═══════════════════════════════════════════');
if (allPassed) {
  console.log('  ALL TESTS PASSED ✅');
} else {
  console.log('  SOME TESTS FAILED ❌');
}
console.log('═══════════════════════════════════════════\n');

process.exit(allPassed ? 0 : 1);
