/**
 * Sentiment Feed — Fear & Greed + CryptoPanic News + Kraken Funding Rate
 *
 * Three independent sentiment sources, each normalized to [-1, +1]:
 *   -1 = extreme bearish/fear    0 = neutral    +1 = extreme bullish/greed
 *
 * The composite score is a weighted average of available sources.
 * All sources are free-tier and rate-limit-safe (cached with TTL).
 */

import { createLogger } from '../agent/logger.js';

const log = createLogger('SENTIMENT');

// ──── Types ────

export interface SentimentResult {
  composite: number;          // -1 to +1 weighted average
  fearGreed: number | null;   // -1 to +1
  newsSentiment: number | null; // -1 to +1
  fundingRate: number | null; // -1 to +1
  sources: string[];          // which sources contributed
  fetchedAt: string;
}

interface CachedValue<T> {
  value: T;
  fetchedAt: number;
}

// ──── Configuration ────

const FETCH_TIMEOUT_MS = 6000;
const FEAR_GREED_TTL_MS = 5 * 60 * 1000;    // 5 min cache (updates hourly upstream)
const NEWS_TTL_MS = 3 * 60 * 1000;           // 3 min cache
const FUNDING_TTL_MS = 5 * 60 * 1000;        // 5 min cache

const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY || '';
const CRYPTOPANIC_BASE = `https://cryptopanic.com/api/developer/v2/posts/?auth_token=${CRYPTOPANIC_API_KEY}&currencies=ETH,BTC&public=true`;
const CRYPTOPANIC_HOT_URL = `${CRYPTOPANIC_BASE}&kind=news`;
const CRYPTOPANIC_BULLISH_URL = `${CRYPTOPANIC_BASE}&filter=bullish`;
const CRYPTOPANIC_BEARISH_URL = `${CRYPTOPANIC_BASE}&filter=bearish`;
const KRAKEN_TICKER_URL = 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD';

// Weights for composite (sum to 1.0)
const WEIGHT_FEAR_GREED = 0.40;
const WEIGHT_NEWS = 0.35;
const WEIGHT_FUNDING = 0.25;

// ──── Cache ────

let fearGreedCache: CachedValue<number> | null = null;
let newsCache: CachedValue<number> | null = null;
let fundingCache: CachedValue<number> | null = null;

// ──── Fear & Greed Index ────

/**
 * Fetch from alternative.me Fear & Greed Index.
 * Returns 0-100 value, converted to [-1, +1]:
 *   0 (extreme fear) → -1,  50 (neutral) → 0,  100 (extreme greed) → +1
 */
async function fetchFearGreed(): Promise<number | null> {
  if (fearGreedCache && Date.now() - fearGreedCache.fetchedAt < FEAR_GREED_TTL_MS) {
    return fearGreedCache.value;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(FEAR_GREED_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) return fearGreedCache?.value ?? null;

    const data = await res.json() as { data?: Array<{ value?: string; value_classification?: string }> };
    const raw = Number(data?.data?.[0]?.value);
    if (!Number.isFinite(raw)) return fearGreedCache?.value ?? null;

    // Normalize: 0-100 → [-1, +1]
    const normalized = (raw - 50) / 50;
    const classification = data?.data?.[0]?.value_classification ?? 'unknown';

    fearGreedCache = { value: normalized, fetchedAt: Date.now() };
    log.info('Fear & Greed fetched', { raw, normalized: normalized.toFixed(2), classification });
    return normalized;
  } catch (err: any) {
    log.warn('Fear & Greed fetch failed', { error: err.message?.slice(0, 80) });
    return fearGreedCache?.value ?? null;
  }
}

// ──── CryptoPanic News Sentiment ────

/**
 * Fetch crypto news from CryptoPanic Developer v2 API.
 * Strategy: fetch hot posts, aggregate vote sentiment + count bullish/bearish tagged posts.
 * Returns [-1, +1] sentiment score.
 */
async function fetchNewsSentiment(): Promise<number | null> {
  if (newsCache && Date.now() - newsCache.fetchedAt < NEWS_TTL_MS) {
    return newsCache.value;
  }

  if (!CRYPTOPANIC_API_KEY) {
    return newsCache?.value ?? null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(CRYPTOPANIC_HOT_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn('News API returned non-OK', { status: res.status });
      return newsCache?.value ?? null;
    }

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      log.warn('News API returned non-JSON', { snippet: text.slice(0, 100) });
      return newsCache?.value ?? null;
    }

    const posts = data?.results;
    if (!posts || posts.length === 0) {
      log.warn('News API returned no posts');
      return newsCache?.value ?? null;
    }

    // Aggregate vote sentiment across posts
    let bullishVotes = 0;
    let bearishVotes = 0;

    for (const post of posts.slice(0, 20)) {
      const v = post.votes;
      if (!v) continue;
      bullishVotes += (v.positive ?? 0) + (v.liked ?? 0);
      bearishVotes += (v.negative ?? 0) + (v.disliked ?? 0);
    }

    const totalVotes = bullishVotes + bearishVotes;
    let normalized = 0;
    if (totalVotes > 0) {
      normalized = (bullishVotes - bearishVotes) / totalVotes;
    }

    // Dampen — news is noisy
    normalized = normalized * 0.8;

    newsCache = { value: normalized, fetchedAt: Date.now() };
    log.info('News sentiment fetched', {
      posts: posts.length,
      bullish: bullishVotes,
      bearish: bearishVotes,
      normalized: normalized.toFixed(2),
    });
    return normalized;
  } catch (err: any) {
    log.warn('News sentiment fetch failed', { error: err.message?.slice(0, 80) });
    return newsCache?.value ?? null;
  }
}

// ──── Kraken Funding Rate (via 24h price change proxy) ────

/**
 * Uses Kraken's 24h VWAP vs last price as a crowding proxy.
 * If price is significantly above VWAP → longs are crowded → bearish signal.
 * If price is significantly below VWAP → shorts are crowded → bullish signal.
 *
 * This approximates funding rate direction without needing futures API access.
 * Returns [-1, +1].
 */
async function fetchFundingProxy(): Promise<number | null> {
  if (fundingCache && Date.now() - fundingCache.fetchedAt < FUNDING_TTL_MS) {
    return fundingCache.value;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(KRAKEN_TICKER_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) return fundingCache?.value ?? null;

    const data = await res.json() as {
      error?: string[];
      result?: Record<string, {
        c?: [string, string];    // last trade price [price, volume]
        p?: [string, string];    // VWAP [today, last24h]
        o?: string;              // today's opening price
      }>;
    };

    if (data?.error?.length) return fundingCache?.value ?? null;

    // Find the ETH pair (key varies: XETHZUSD or ETHUSD)
    const pairData = Object.values(data?.result ?? {})[0];
    if (!pairData) return fundingCache?.value ?? null;

    const lastPrice = Number(pairData.c?.[0]);
    const vwap24h = Number(pairData.p?.[1]);
    const openPrice = Number(pairData.o);

    if (!Number.isFinite(lastPrice) || !Number.isFinite(vwap24h) || vwap24h <= 0) {
      return fundingCache?.value ?? null;
    }

    // Price deviation from VWAP as % of price
    // Positive = price above VWAP (longs crowded → contrarian bearish)
    // We INVERT because crowded longs → mean reversion risk → bearish signal
    const deviation = (lastPrice - vwap24h) / vwap24h;

    // Also factor in intraday move for momentum context
    let intradayMove = 0;
    if (Number.isFinite(openPrice) && openPrice > 0) {
      intradayMove = (lastPrice - openPrice) / openPrice;
    }

    // Blend: contrarian VWAP deviation + momentum intraday
    // The contrarian signal is stronger near extremes
    const contrarian = -Math.tanh(deviation * 40);   // ±2.5% → ±1.0 (inverted)
    const momentum = Math.tanh(intradayMove * 30);    // ±3.3% → ±1.0

    const normalized = 0.6 * contrarian + 0.4 * momentum;

    fundingCache = { value: normalized, fetchedAt: Date.now() };
    log.info('Funding proxy fetched', {
      lastPrice: lastPrice.toFixed(2),
      vwap24h: vwap24h.toFixed(2),
      deviation: (deviation * 100).toFixed(3) + '%',
      normalized: normalized.toFixed(2),
    });
    return normalized;
  } catch (err: any) {
    log.warn('Funding proxy fetch failed', { error: err.message?.slice(0, 80) });
    return fundingCache?.value ?? null;
  }
}

// ──── Composite ────

/**
 * Fetch all sentiment sources in parallel and return weighted composite.
 * Gracefully degrades: if a source fails, remaining sources are re-weighted.
 */
export async function fetchSentiment(): Promise<SentimentResult> {
  const [fg, news, funding] = await Promise.all([
    fetchFearGreed(),
    fetchNewsSentiment(),
    fetchFundingProxy(),
  ]);

  const sources: string[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  if (fg !== null) {
    weightedSum += fg * WEIGHT_FEAR_GREED;
    totalWeight += WEIGHT_FEAR_GREED;
    sources.push('fear_greed');
  }
  if (news !== null) {
    weightedSum += news * WEIGHT_NEWS;
    totalWeight += WEIGHT_NEWS;
    sources.push('news');
  }
  if (funding !== null) {
    weightedSum += funding * WEIGHT_FUNDING;
    totalWeight += WEIGHT_FUNDING;
    sources.push('funding_proxy');
  }

  const composite = totalWeight > 0 ? weightedSum / totalWeight : 0;

  return {
    composite,
    fearGreed: fg,
    newsSentiment: news,
    fundingRate: funding,
    sources,
    fetchedAt: new Date().toISOString(),
  };
}
