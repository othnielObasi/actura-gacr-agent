/**
 * Live Price Feed — CoinGecko + Fallback
 *
 * Fetches real WETH/USDC prices from CoinGecko's free API.
 * Falls back to DeFiLlama if CoinGecko rate-limits.
 * Falls back to simulation ONLY if both APIs fail.
 *
 * CoinGecko free tier: ~30 calls/min (no key needed).
 * DeFiLlama: unlimited, no key needed.
 */

import type { MarketData } from '../strategy/momentum.js';
import { createLogger } from '../agent/logger.js';

const log = createLogger('LIVE-FEED');

// ──── Configuration ────

const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true';
const COINGECKO_OHLC_URL = 'https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=7';
const DEFILLAMA_PRICE_URL = 'https://coins.llama.fi/prices/current/coingecko:ethereum';

const FETCH_TIMEOUT_MS = 8000;

// ──── State ────

let lastFetchedPrice: number | null = null;
let lastFetchTime = 0;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

// ──── Public API ────

/**
 * Fetch the current live ETH price in USD.
 * Tries CoinGecko first, then DeFiLlama as fallback.
 * Returns null only if all sources fail.
 */
export async function fetchLivePrice(): Promise<{ price: number; source: string } | null> {
  // Try CoinGecko
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(COINGECKO_PRICE_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json() as { ethereum?: { usd?: number } };
      const price = data?.ethereum?.usd;
      if (typeof price === 'number' && price > 0) {
        lastFetchedPrice = price;
        lastFetchTime = Date.now();
        consecutiveFailures = 0;
        return { price, source: 'coingecko' };
      }
    }
    log.debug(`CoinGecko returned ${res.status} — trying DeFiLlama`);
  } catch (e) {
    log.debug('CoinGecko fetch failed — trying DeFiLlama', { error: String(e) });
  }

  // Try DeFiLlama
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(DEFILLAMA_PRICE_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json() as { coins?: { 'coingecko:ethereum'?: { price?: number } } };
      const price = data?.coins?.['coingecko:ethereum']?.price;
      if (typeof price === 'number' && price > 0) {
        lastFetchedPrice = price;
        lastFetchTime = Date.now();
        consecutiveFailures = 0;
        return { price, source: 'defillama' };
      }
    }
    log.debug(`DeFiLlama returned ${res.status}`);
  } catch (e) {
    log.debug('DeFiLlama fetch failed', { error: String(e) });
  }

  // Both failed
  consecutiveFailures++;
  if (consecutiveFailures <= 2) {
    log.warn('All live price sources failed', { consecutiveFailures });
  }
  return null;
}

/**
 * Fetch OHLC history from CoinGecko (3 days of 1h candles).
 * Returns null if fetch fails.
 */
export async function fetchOHLCHistory(): Promise<MarketData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(COINGECKO_OHLC_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn(`CoinGecko OHLC returned ${res.status}`);
      return null;
    }

    // CoinGecko OHLC response: [[timestamp, open, high, low, close], ...]
    const raw = await res.json() as number[][];
    if (!Array.isArray(raw) || raw.length < 20) {
      log.warn('CoinGecko OHLC returned insufficient data', { count: raw?.length ?? 0 });
      return null;
    }

    const prices: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];
    const timestamps: string[] = [];

    for (const candle of raw) {
      if (!Array.isArray(candle) || candle.length < 5) continue;
      const [ts, _open, high, low, close] = candle;
      prices.push(close);
      highs.push(high);
      lows.push(low);
      timestamps.push(new Date(ts).toISOString());
    }

    if (prices.length < 20) return null;

    log.info('Loaded live OHLC history', {
      candles: prices.length,
      latest: `$${prices[prices.length - 1].toFixed(2)}`,
      oldest: `$${prices[0].toFixed(2)}`,
    });

    return { prices, highs, lows, timestamps };
  } catch (e) {
    log.warn('Failed to fetch OHLC history', { error: String(e) });
    return null;
  }
}

/**
 * Build a live candle from a price fetch.
 * Uses the previous price to estimate high/low range.
 */
export function buildLiveCandle(
  currentPrice: number,
  previousPrice: number,
): { timestamp: string; open: number; high: number; low: number; close: number; volume: number } {
  const move = Math.abs(currentPrice - previousPrice);
  const range = Math.max(move * 0.3, currentPrice * 0.001); // at least 0.1% range

  return {
    timestamp: new Date().toISOString(),
    open: previousPrice,
    high: Math.max(currentPrice, previousPrice) + range * Math.random(),
    low: Math.min(currentPrice, previousPrice) - range * Math.random(),
    close: currentPrice,
    volume: 0, // CoinGecko free tier doesn't give per-candle volume
  };
}

// ──── Status ────

export function getLiveFeedStatus() {
  return {
    lastPrice: lastFetchedPrice,
    lastFetchTime: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
    consecutiveFailures,
    healthy: consecutiveFailures < MAX_CONSECUTIVE_FAILURES,
    staleMs: lastFetchTime ? Date.now() - lastFetchTime : null,
  };
}
