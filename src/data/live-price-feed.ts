/**
 * Live Price Feed — Kraken primary + CoinGecko/DeFiLlama fallback
 *
 * Fetches real WETH/USDC prices from Kraken's REST API (primary).
 * Falls back to CoinGecko, then DeFiLlama if Kraken is down.
 *
 * Kraken: direct exchange data with bid/ask, spread, volume — no key needed.
 * CoinGecko free tier: ~30 calls/min (no key needed).
 * DeFiLlama: unlimited, no key needed.
 */

import type { MarketData } from '../strategy/momentum.js';
import { createLogger } from '../agent/logger.js';
import { fetchKrakenPrice, fetchKrakenOHLC } from './kraken-feed.js';

const log = createLogger('LIVE-FEED');

// ──── Configuration ────

const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true';
const COINGECKO_OHLC_URL = 'https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=30';
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
 * Tries Kraken first (direct exchange), then CoinGecko, then DeFiLlama.
 * Returns null only if all sources fail.
 */
export async function fetchLivePrice(): Promise<{ price: number; source: string } | null> {
  // Try Kraken (primary — direct exchange data)
  try {
    const krakenResult = await fetchKrakenPrice();
    if (krakenResult) {
      lastFetchedPrice = krakenResult.price;
      lastFetchTime = Date.now();
      consecutiveFailures = 0;
      return krakenResult;
    }
    log.debug('Kraken fetch returned null — trying CoinGecko');
  } catch (e) {
    log.debug('Kraken fetch failed — trying CoinGecko', { error: String(e) });
  }

  // Try CoinGecko (fallback 1)
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

  // Try DeFiLlama (fallback 2)
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

  // All three sources failed
  consecutiveFailures++;
  if (consecutiveFailures <= 2) {
    log.warn('All live price sources failed (Kraken, CoinGecko, DeFiLlama)', { consecutiveFailures });
  } else if (consecutiveFailures === MAX_CONSECUTIVE_FAILURES) {
    log.error(`Live feed failed ${MAX_CONSECUTIVE_FAILURES} consecutive times — data is stale, trading should halt`);
  }
  return null;
}

/**
 * Fetch OHLC history — Kraken primary, CoinGecko fallback.
 * Returns null if all sources fail.
 */
export async function fetchOHLCHistory(): Promise<MarketData | null> {
  // Try Kraken first (primary — direct exchange candles)
  try {
    const candles = await fetchKrakenOHLC('WETH/USDC', 60);
    if (candles && candles.length >= 20) {
      const prices = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const lows = candles.map(c => c.low);
      const timestamps = candles.map(c => c.timestamp);
      log.info('Loaded Kraken OHLC history', {
        candles: prices.length,
        latest: `$${prices[prices.length - 1].toFixed(2)}`,
        oldest: `$${prices[0].toFixed(2)}`,
      });
      return { prices, highs, lows, timestamps };
    }
    log.debug('Kraken OHLC returned insufficient data — trying CoinGecko');
  } catch (e) {
    log.warn('Kraken OHLC fetch failed — trying CoinGecko', { error: String(e) });
  }

  // Fallback: CoinGecko OHLC
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
    } else {
      // CoinGecko OHLC response: [[timestamp, open, high, low, close], ...]
      const raw = await res.json() as number[][];
      if (Array.isArray(raw) && raw.length >= 20) {
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

        if (prices.length >= 20) {
          log.info('Loaded live OHLC history', {
            candles: prices.length,
            latest: `$${prices[prices.length - 1].toFixed(2)}`,
            oldest: `$${prices[0].toFixed(2)}`,
          });
          return { prices, highs, lows, timestamps };
        }
      }
      log.warn('CoinGecko OHLC returned insufficient data');
    }
  } catch (e) {
    log.warn('CoinGecko OHLC fetch failed', { error: String(e) });
  }

  return null;
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
  const staleMs = lastFetchTime ? Date.now() - lastFetchTime : null;
  return {
    lastPrice: lastFetchedPrice,
    lastFetchTime: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
    consecutiveFailures,
    healthy: consecutiveFailures < MAX_CONSECUTIVE_FAILURES,
    staleMs,
    shouldHaltTrading: consecutiveFailures >= MAX_CONSECUTIVE_FAILURES,
  };
}
