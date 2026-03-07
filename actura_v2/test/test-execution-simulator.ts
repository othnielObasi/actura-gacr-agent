import { simulateExecution } from '../src/chain/execution-simulator.js';
import { runStrategy, resetStrategy } from '../src/strategy/momentum.js';
import { generateTrendingData, generateChoppyData } from '../src/data/price-feed.js';
import { RiskEngine } from '../src/risk/engine.js';

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string): void {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

console.log('\n🧪 EXECUTION SIMULATOR TESTS\n');
resetStrategy();
const trend = generateTrendingData('up', 100);
const strat = runStrategy(trend, 10000);
const risk = new RiskEngine(10000).evaluate(strat);
const sim = simulateExecution({ strategyOutput: strat, riskDecision: risk, gasUsd: 0.2, liquidityBudgetUsd: 50000 });
assert(typeof sim.allowed === 'boolean', 'Simulation returns boolean allow flag');
assert(sim.estimatedSlippageBps > 0, 'Simulation computes slippage');
assert(sim.estimatedTotalCostUsd >= sim.estimatedGasUsd, 'Simulation computes total cost');

resetStrategy();
const choppy = generateChoppyData(100);
const strat2 = runStrategy(choppy, 10000);
const risk2 = new RiskEngine(10000).evaluate(strat2);
const sim2 = simulateExecution({ strategyOutput: strat2, riskDecision: risk2, gasUsd: 10, liquidityBudgetUsd: 500 });
assert(['slippage_too_high', 'net_edge_too_low', 'no_executable_trade', 'extreme_volatility_simulation_block', 'simulation_pass'].includes(sim2.reason), 'Simulation emits known reason');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
