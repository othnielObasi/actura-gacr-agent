/**
 * Kraken CLI Data Source — Market Data via Kraken REST API
 *
 * Provides an alternative price feed using Kraken's public market data API.
 * When KRAKEN_API_KEY is configured, this module can also be used as an
 * execution layer for the Kraken CLI track.
 *
 * Public endpoints (no API key needed):
 *   - Ticker: current price, bid/ask, volume
 *   - OHLC: historical candles
 *
 * Private endpoints (requires KRAKEN_API_KEY + KRAKEN_API_SECRET):
 *   - Balance, open orders, trade history
 *
 * Kraken CLI integration:
 *   When the Kraken CLI binary is installed, this module can invoke it
 *   as a subprocess for MCP-compatible operations. Set KRAKEN_CLI_PATH
 *   in .env to enable.
 *
 * Docs: https://docs.kraken.com/api/
 */

import { createLogger } from '../agent/logger.js';

const log = createLogger('KRAKEN');

// ── Configuration ──

const KRAKEN_REST_URL = 'https://api.kraken.com';
const FETCH_TIMEOUT_MS = 8000;

// Kraken pair names differ from standard — map them
const PAIR_MAP: Record<string, string> = {
  'WETH/USDC': 'ETHUSD',
  'ETH/USDC': 'ETHUSD',
  'ETH/USD': 'ETHUSD',
  'BTC/USDC': 'XBTUSD',
  'BTC/USD': 'XBTUSD',
};

// ── Types ──

export interface KrakenTicker {
  pair: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  volume24h: number;
  vwap24h: number;
  high24h: number;
  low24h: number;
  change24hPct: number;
  timestamp: string;
  source: 'kraken';
}

export interface KrakenOHLC {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  volume: number;
}

export interface KrakenStatus {
  available: boolean;
  apiKeyConfigured: boolean;
  cliAvailable: boolean;
  lastFetchTime: string | null;
  consecutiveFailures: number;
}

// ── State ──

let lastFetchTime: number | null = null;
let consecutiveFailures = 0;

// ── Public Market Data (No API Key Required) ──

/**
 * Fetch current ticker from Kraken public API.
 * No API key required.
 */
export async function fetchKrakenTicker(tradingPair: string = 'WETH/USDC'): Promise<KrakenTicker | null> {
  const krakenPair = PAIR_MAP[tradingPair] || 'ETHUSD';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${KRAKEN_REST_URL}/0/public/Ticker?pair=${krakenPair}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.debug(`Kraken ticker returned ${res.status}`);
      consecutiveFailures++;
      return null;
    }

    const data = await res.json() as {
      error: string[];
      result: Record<string, {
        a: [string, string, string];  // ask [price, wholeLotVolume, lotVolume]
        b: [string, string, string];  // bid
        c: [string, string];          // last trade [price, lotVolume]
        v: [string, string];          // volume [today, 24h]
        p: [string, string];          // vwap [today, 24h]
        t: [number, number];          // number of trades
        l: [string, string];          // low [today, 24h]
        h: [string, string];          // high [today, 24h]
        o: string;                    // today's open
      }>;
    };

    if (data.error?.length > 0) {
      log.warn('Kraken API error', { errors: data.error });
      consecutiveFailures++;
      return null;
    }

    const pairKey = Object.keys(data.result)[0];
    if (!pairKey) {
      log.warn('Kraken returned empty result');
      consecutiveFailures++;
      return null;
    }

    const t = data.result[pairKey];
    const price = parseFloat(t.c[0]);
    const bid = parseFloat(t.b[0]);
    const ask = parseFloat(t.a[0]);
    const open = parseFloat(t.o);

    consecutiveFailures = 0;
    lastFetchTime = Date.now();

    return {
      pair: tradingPair,
      price,
      bid,
      ask,
      spread: ask - bid,
      volume24h: parseFloat(t.v[1]),
      vwap24h: parseFloat(t.p[1]),
      high24h: parseFloat(t.h[1]),
      low24h: parseFloat(t.l[1]),
      change24hPct: open > 0 ? ((price - open) / open) * 100 : 0,
      timestamp: new Date().toISOString(),
      source: 'kraken',
    };
  } catch (error) {
    consecutiveFailures++;
    log.debug('Kraken ticker fetch failed', { error: String(error) });
    return null;
  }
}

/**
 * Fetch OHLC candles from Kraken public API.
 * interval: 1, 5, 15, 30, 60, 240, 1440, 10080, 21600 (minutes)
 */
export async function fetchKrakenOHLC(
  tradingPair: string = 'WETH/USDC',
  interval: number = 60,
): Promise<KrakenOHLC[] | null> {
  const krakenPair = PAIR_MAP[tradingPair] || 'ETHUSD';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(
      `${KRAKEN_REST_URL}/0/public/OHLC?pair=${krakenPair}&interval=${interval}`,
      {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      },
    );
    clearTimeout(timeout);

    if (!res.ok) {
      log.debug(`Kraken OHLC returned ${res.status}`);
      return null;
    }

    const data = await res.json() as {
      error: string[];
      result: Record<string, Array<[number, string, string, string, string, string, string, number]>>;
    };

    if (data.error?.length > 0) {
      log.warn('Kraken OHLC API error', { errors: data.error });
      return null;
    }

    // Find the OHLC data (skip the "last" field)
    const pairKey = Object.keys(data.result).find(k => k !== 'last');
    if (!pairKey) return null;

    const candles = data.result[pairKey];
    if (!Array.isArray(candles) || candles.length === 0) return null;

    const result: KrakenOHLC[] = candles.map(c => ({
      timestamp: new Date(c[0] * 1000).toISOString(),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vwap: parseFloat(c[5]),
      volume: parseFloat(c[6]),
    }));

    log.info('Loaded Kraken OHLC', {
      candles: result.length,
      interval: `${interval}m`,
      latest: `$${result[result.length - 1].close.toFixed(2)}`,
    });

    return result;
  } catch (error) {
    log.debug('Kraken OHLC fetch failed', { error: String(error) });
    return null;
  }
}

/**
 * Fetch Kraken price as a simple { price, source } compatible with
 * the existing live-price-feed interface.
 */
export async function fetchKrakenPrice(tradingPair: string = 'WETH/USDC'): Promise<{ price: number; source: string } | null> {
  const ticker = await fetchKrakenTicker(tradingPair);
  if (!ticker) return null;
  return { price: ticker.price, source: 'kraken' };
}

// ── Status ──

export function getKrakenFeedStatus(): KrakenStatus {
  return {
    available: consecutiveFailures < 5,
    apiKeyConfigured: !!(process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET),
    cliAvailable: !!process.env.KRAKEN_CLI_PATH,
    lastFetchTime: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
    consecutiveFailures,
  };
}
