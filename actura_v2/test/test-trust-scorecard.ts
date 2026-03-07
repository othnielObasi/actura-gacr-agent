/**
 * Trust Policy Scorecard tests
 */

import { buildTradeArtifact } from '../src/trust/artifact-emitter.js';
import { buildTrustPolicyScorecard, getTrustHistory, resetTrustScorecards } from '../src/trust/trust-policy-scorecard.js';
import { runStrategy, resetStrategy } from '../src/strategy/momentum.js';
import { RiskEngine } from '../src/risk/engine.js';
import { generateTrendingData } from '../src/data/price-feed.js';

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

console.log('\n🧪 TRUST POLICY SCORECARD TESTS\n');
resetStrategy();
resetTrustScorecards();
const engine = new RiskEngine(10000);
const data = generateTrendingData('up', 100);
const strategy = runStrategy(data, 10000);
const risk = engine.evaluate(strategy);
const artifact = buildTradeArtifact(strategy, risk, 12345);

assert(artifact.trustPolicyScorecard !== undefined, 'Artifact contains trust scorecard');
assert((artifact.trustPolicyScorecard?.dimensions.policyCompliance ?? -1) >= 0, 'Policy score present');
assert((artifact.trustPolicyScorecard?.dimensions.validationCompleteness ?? -1) >= 0, 'Validation score present');
assert((artifact.trustPolicyScorecard?.trustScore ?? -1) >= 0 && (artifact.trustPolicyScorecard?.trustScore ?? 101) <= 100, 'Trust score bounded 0-100');

const followup = buildTrustPolicyScorecard({
  agentId: 12345,
  actionId: 'trade-followup-1',
  timestamp: new Date().toISOString(),
  strategyOutput: strategy,
  riskDecision: risk,
  artifact,
  outcome: { pnlPct: 0.012, slippageBps: 8, executionMatchedIntent: true },
  stage: 'post_execution',
});

assert(followup.dimensions.outcomeQuality > 80, `Outcome quality improved: ${followup.dimensions.outcomeQuality}`);
assert(['trusted', 'watch', 'restricted'].includes(followup.status), `Status valid: ${followup.status}`);
assert(getTrustHistory(12345, 10).length >= 2, 'Trust history records actions over time');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

assert((followup.capitalMultiplier ?? 0) > 0, 'Capital multiplier attached to scorecard');
assert(typeof followup.trustTier === 'string' && followup.trustTier.length > 0, 'Trust tier attached to scorecard');
