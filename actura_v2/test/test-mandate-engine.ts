import { evaluateMandate, getDefaultMandate, buildMandateMetadataJson } from '../src/chain/agent-mandate.js';
import { runStrategy, resetStrategy } from '../src/strategy/momentum.js';
import { generateTrendingData } from '../src/data/price-feed.js';
import { RiskEngine } from '../src/risk/engine.js';

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string): void {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

console.log('\n🧪 AGENT MANDATE ENGINE TESTS\n');
resetStrategy();
const data = generateTrendingData('up', 100);
const strategyOutput = runStrategy(data, 10000);
const riskDecision = new RiskEngine(10000).evaluate(strategyOutput);

const mandate = getDefaultMandate(100000);
const decision = evaluateMandate({
  mandate,
  strategyOutput,
  capitalUsd: 10000,
  riskDecision,
  protocol: 'uniswap',
  asset: 'WETH/USDC',
});
assert(decision.approved === true, 'Default mandate approves normal WETH/USDC trade');
assert(decision.requiresHumanApproval === false, 'Default mandate does not require human approval for small trade');
assert(decision.checks.length >= 5, 'Mandate emits full check set');

const blocked = evaluateMandate({
  mandate: { ...mandate, allowedAssets: ['WBTC/USDC'] },
  strategyOutput,
  capitalUsd: 10000,
  riskDecision,
  protocol: 'uniswap',
  asset: 'WETH/USDC',
});
assert(blocked.approved === false, 'Mandate blocks disallowed asset');
assert(blocked.reasons.some(r => r.includes('asset_allowed')), 'Blocked asset reason captured');

const metadata = buildMandateMetadataJson(mandate) as any;
assert(metadata.maxTradeSizePct === mandate.maxTradeSizePct, 'Mandate metadata serializes max trade size');
assert(Array.isArray(metadata.allowedProtocols), 'Mandate metadata includes allowed protocols');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
