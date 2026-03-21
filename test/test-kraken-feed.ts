/**
 * Kraken Feed Tests — verifies Kraken REST API data parsing
 * Tests the public ticker & OHLC endpoints against Kraken's live API.
 */

import { fetchKrakenTicker, fetchKrakenOHLC, fetchKrakenPrice, getKrakenFeedStatus } from '../src/data/kraken-feed.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

console.log('\n🧪 KRAKEN FEED TESTS\n');

// ── Status Baseline ──
console.log('── Status Before Fetching ──');

const statusBefore = getKrakenFeedStatus();
assert(typeof statusBefore.available === 'boolean', 'Status has available flag');
assert(typeof statusBefore.apiKeyConfigured === 'boolean', 'Status has apiKeyConfigured');
assert(typeof statusBefore.cliAvailable === 'boolean', 'Status has cliAvailable');
assert(statusBefore.consecutiveFailures >= 0, 'Consecutive failures >= 0');

// ── Live Ticker ──
console.log('\n── Live Ticker Fetch ──');

const ticker = await fetchKrakenTicker('WETH/USDC');
if (ticker) {
  assert(ticker.source === 'kraken', `Source is kraken`);
  assert(ticker.price > 0, `Price is positive: $${ticker.price}`);
  assert(ticker.bid > 0, `Bid is positive: $${ticker.bid}`);
  assert(ticker.ask > 0, `Ask is positive: $${ticker.ask}`);
  assert(ticker.ask >= ticker.bid, 'Ask >= Bid (no crossed spread)');
  assert(ticker.spread >= 0, `Spread is non-negative: $${ticker.spread.toFixed(2)}`);
  assert(ticker.volume24h > 0, `24h volume > 0: ${ticker.volume24h}`);
  assert(ticker.vwap24h > 0, `24h VWAP > 0: $${ticker.vwap24h}`);
  assert(ticker.pair === 'WETH/USDC', `Pair echoed correctly`);
  assert(typeof ticker.change24hPct === 'number', 'Change pct is number');
} else {
  // Network may be unavailable in CI — mark as skipped
  console.log('  ⏭️  Ticker fetch returned null (network unavailable?) — skipping live tests');
}

// ── Live OHLC ──
console.log('\n── Live OHLC Fetch ──');

const ohlc = await fetchKrakenOHLC('WETH/USDC', 60);
if (ohlc) {
  assert(ohlc.length > 0, `Got ${ohlc.length} candles`);
  const latest = ohlc[ohlc.length - 1];
  assert(latest.open > 0, `Latest open: $${latest.open}`);
  assert(latest.high >= latest.low, 'High >= Low');
  assert(latest.close > 0, `Latest close: $${latest.close}`);
  assert(latest.volume >= 0, `Volume >= 0`);
} else {
  console.log('  ⏭️  OHLC fetch returned null — skipping');
}

// ── Simple Price Interface ──
console.log('\n── Simple Price Fetch ──');

const simple = await fetchKrakenPrice('WETH/USDC');
if (simple) {
  assert(simple.source === 'kraken', 'Simple source is kraken');
  assert(simple.price > 0, `Simple price: $${simple.price}`);
} else {
  console.log('  ⏭️  Simple price returned null — skipping');
}

// ── Status After Fetching ──
console.log('\n── Status After Fetching ──');

const statusAfter = getKrakenFeedStatus();
if (ticker) {
  assert(statusAfter.lastFetchTime !== null, 'lastFetchTime is set after successful fetch');
  assert(statusAfter.consecutiveFailures === 0, 'Failures reset on success');
}

// ── Pair Mapping ──
console.log('\n── Pair Mapping ──');

// BTC pair should also work
const btcTicker = await fetchKrakenTicker('BTC/USD');
if (btcTicker) {
  assert(btcTicker.price > 1000, `BTC price > $1000: $${btcTicker.price}`);
  assert(btcTicker.source === 'kraken', 'BTC source is kraken');
} else {
  console.log('  ⏭️  BTC ticker returned null — skipping');
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
