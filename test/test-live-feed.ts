/**
 * Quick test: verify live price feed works
 */
import { fetchLivePrice, fetchOHLCHistory, getLiveFeedStatus } from '../src/data/live-price-feed.js';

async function main() {
  console.log('=== Live Price Feed Test ===\n');

  console.log('1. Fetching current ETH price...');
  const price = await fetchLivePrice();
  if (price) {
    console.log(`   ✅ ETH = $${price.price.toFixed(2)} [${price.source}]`);
  } else {
    console.log('   ❌ Failed to fetch price');
  }

  console.log('\n2. Fetching OHLC history (3 days)...');
  const ohlc = await fetchOHLCHistory();
  if (ohlc) {
    console.log(`   ✅ Got ${ohlc.prices.length} candles`);
    console.log(`   Latest: $${ohlc.prices[ohlc.prices.length - 1].toFixed(2)}`);
    console.log(`   Oldest: $${ohlc.prices[0].toFixed(2)}`);
    console.log(`   Range: ${ohlc.timestamps[0]} → ${ohlc.timestamps[ohlc.timestamps.length - 1]}`);
  } else {
    console.log('   ❌ Failed to fetch OHLC');
  }

  console.log('\n3. Feed status:');
  console.log(getLiveFeedStatus());

  console.log('\n=== Done ===');
}

main().catch(console.error);
