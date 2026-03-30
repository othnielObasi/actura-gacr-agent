import { routeTrade, getDexProfile, getAvailableDexes, getDexFeeBps, type DexId } from '../src/chain/dex-router.js';

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string): void {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

(async () => {
console.log('\n🧪 DEX ROUTER TESTS\n');

// ── Basic routing ──
console.log('── Basic Routing ──');
const route1 = await routeTrade({
  asset: 'WETH/USDC',
  side: 'LONG',
  notionalUsd: 300,
  volatility: 0.02,
  isTestnet: false,
  enabledDexes: ['aerodrome', 'uniswap'],
});
assert(route1.selectedDex === 'aerodrome' || route1.selectedDex === 'uniswap', `Selected DEX is valid: ${route1.selectedDex}`);
assert(route1.quotes.length === 2, `Got quotes from both DEXes: ${route1.quotes.length}`);
assert(route1.rationale.length > 0, 'Rationale provided');
assert(route1.routingVersion === '1.0', 'Routing version set');
assert(route1.savingsBps >= 0, `Savings non-negative: ${route1.savingsBps} bps`);

// ── Testnet fallback ──
console.log('── Testnet Fallback ──');
const route2 = await routeTrade({
  asset: 'WETH/USDC',
  side: 'SHORT',
  notionalUsd: 200,
  volatility: 0.015,
  isTestnet: true,
  enabledDexes: ['aerodrome', 'uniswap'],
});
assert(route2.selectedDex === 'uniswap', `Testnet selects uniswap (aerodrome unavailable): ${route2.selectedDex}`);
const aeroQuote = route2.quotes.find(q => q.dex === 'aerodrome');
assert(aeroQuote !== undefined && !aeroQuote.available, 'Aerodrome marked unavailable on testnet');

// ── Single DEX ──
console.log('── Single DEX ──');
const route3 = await routeTrade({
  asset: 'WETH/USDC',
  side: 'LONG',
  notionalUsd: 500,
  volatility: 0.03,
  isTestnet: false,
  enabledDexes: ['aerodrome'],
});
assert(route3.selectedDex === 'aerodrome', 'Single DEX mode selects aerodrome');
assert(route3.quotes.length === 1, 'Only one quote when single DEX');

// ── Quote structure ──
console.log('── Quote Structure ──');
for (const q of route1.quotes) {
  assert(q.estimatedFeeBps > 0, `${q.dex} fee > 0: ${q.estimatedFeeBps} bps`);
  assert(q.estimatedSlippageBps >= 0, `${q.dex} slippage >= 0: ${q.estimatedSlippageBps} bps`);
  assert(q.estimatedTotalCostBps > 0, `${q.dex} total cost > 0: ${q.estimatedTotalCostBps} bps`);
  assert(q.liquidityScore > 0 && q.liquidityScore <= 1, `${q.dex} liquidity score in [0,1]: ${q.liquidityScore}`);
}

// ── Profile helpers ──
console.log('── Profile Helpers ──');
const aeroProfile = getDexProfile('aerodrome');
assert(aeroProfile !== undefined, 'Aerodrome profile exists');
assert(aeroProfile!.name === 'Aerodrome Finance', `Aerodrome name: ${aeroProfile!.name}`);

const uniProfile = getDexProfile('uniswap');
assert(uniProfile !== undefined, 'Uniswap profile exists');

const mainnetDexes = getAvailableDexes(false);
assert(mainnetDexes.includes('aerodrome'), 'Aerodrome available on mainnet');
assert(mainnetDexes.includes('uniswap'), 'Uniswap available on mainnet');

const testnetDexes = getAvailableDexes(true);
assert(!testnetDexes.includes('aerodrome'), 'Aerodrome NOT available on testnet');
assert(testnetDexes.includes('uniswap'), 'Uniswap available on testnet');

assert(getDexFeeBps('aerodrome') === 30, `Aerodrome fee: ${getDexFeeBps('aerodrome')} bps`);
assert(getDexFeeBps('uniswap') === 30, `Uniswap fee: ${getDexFeeBps('uniswap')} bps`);

// ── High volatility routing ──
console.log('── High Volatility ──');
const route4 = await routeTrade({
  asset: 'WETH/USDC',
  side: 'LONG',
  notionalUsd: 300,
  volatility: 0.05,
  isTestnet: false,
});
assert(route4.quotes.every(q => q.estimatedSlippageBps > route1.quotes.find(r => r.dex === q.dex)!.estimatedSlippageBps || !q.available),
  'Higher vol → higher slippage estimates');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
})();
