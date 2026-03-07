/**
 * Validation Artifact Tests
 * Tests artifact generation — the core differentiator
 */

import { buildTradeArtifact, buildDailySummaryArtifact, resetArtifactCounter } from '../src/trust/artifact-emitter.js';
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

console.log('\n🧪 VALIDATION ARTIFACT TESTS\n');

// ── Artifact Structure ──
console.log('── Artifact Structure ──');

resetStrategy();
resetArtifactCounter();
const engine = new RiskEngine(10000);
const data = generateTrendingData('up', 100);
const stratOutput = runStrategy(data, 10000);
const riskDecision = engine.evaluate(stratOutput);
const artifact = buildTradeArtifact(stratOutput, riskDecision, 12345);

assert(artifact.version === '1.0', 'Version is 1.0');
assert(artifact.agentName === 'Actura', `Agent name: ${artifact.agentName}`);
assert(artifact.agentId === 12345, `Agent ID: ${artifact.agentId}`);
assert(artifact.timestamp.length > 0, `Timestamp: ${artifact.timestamp}`);
assert(['trade_checkpoint', 'risk_halt'].includes(artifact.type), `Type: ${artifact.type}`);

// Strategy section
assert(artifact.strategy.name === 'VolAdjMomentum', `Strategy: ${artifact.strategy.name}`);
assert(artifact.strategy.signal.length > 0, `Signal: ${artifact.strategy.signal}`);
assert(artifact.strategy.signalConfidence >= 0 && artifact.strategy.signalConfidence <= 1, 
  `Confidence in range: ${artifact.strategy.signalConfidence}`);
assert(artifact.strategy.signalReason.length > 0, `Reason provided: ${artifact.strategy.signalReason.slice(0, 60)}...`);

// Risk section
assert(artifact.risk.baselineVolatility === 0.02, `Baseline vol: ${artifact.risk.baselineVolatility}`);
assert(typeof artifact.risk.circuitBreakerActive === 'boolean', `CB status: ${artifact.risk.circuitBreakerActive}`);
assert(typeof artifact.risk.dailyPnl === 'number', `Daily PnL tracked: ${artifact.risk.dailyPnl}`);

// Risk checks
assert(artifact.riskChecks.length >= 4, `${artifact.riskChecks.length} risk checks documented`);
for (const check of artifact.riskChecks) {
  assert(check.name.length > 0, `  Check: ${check.name} = ${check.passed} | ${check.value}`);
}

// Decision section
assert(typeof artifact.decision.approved === 'boolean', `Decision: ${artifact.decision.approved}`);
assert(artifact.decision.explanation.length > 10, `Explanation: ${artifact.decision.explanation.slice(0, 80)}...`);
assert(artifact.trustPolicyScorecard !== undefined, 'Trust policy scorecard attached');
assert((artifact.trustPolicyScorecard?.trustScore ?? 0) >= 0, `Trust score: ${artifact.trustPolicyScorecard?.trustScore}`);
assert(['trusted', 'watch', 'restricted'].includes(artifact.trustPolicyScorecard?.status ?? ''), `Trust status: ${artifact.trustPolicyScorecard?.status}`);

// Trade section (only if approved)
if (artifact.decision.approved && artifact.trade) {
  assert(artifact.trade.asset === 'WETH/USDC', `Asset: ${artifact.trade.asset}`);
  assert(['LONG', 'SHORT'].includes(artifact.trade.side), `Side: ${artifact.trade.side}`);
  assert(artifact.trade.size > 0, `Size: ${artifact.trade.size}`);
  assert(artifact.trade.entryPrice > 0, `Entry: ${artifact.trade.entryPrice}`);
  assert(artifact.trade.valueUsd > 0, `Value: $${artifact.trade.valueUsd.toFixed(2)}`);
}

// ── JSON Serialization ──
console.log('\n── JSON Serialization ──');

const json = JSON.stringify(artifact, null, 2);
assert(json.length > 500, `Artifact JSON size: ${json.length} bytes`);

const parsed = JSON.parse(json);
assert(parsed.version === artifact.version, 'Roundtrip: version preserved');
assert(parsed.strategy.name === artifact.strategy.name, 'Roundtrip: strategy preserved');
assert(parsed.riskChecks.length === artifact.riskChecks.length, 'Roundtrip: checks preserved');

console.log('\n── Sample Artifact ──');
console.log(json.slice(0, 600) + '\n  ...\n');

// ── Daily Summary ──
console.log('── Daily Summary ──');

const summary = buildDailySummaryArtifact(10250, 15, 250, 1.85, 12345);
assert(summary.type === 'daily_summary', `Type: ${summary.type}`);
assert(summary.decision.explanation.includes('15 trades'), `Summary includes trade count`);
assert(summary.trustPolicyScorecard !== undefined, 'Daily summary includes trust scorecard');

// ── Summary ──
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
