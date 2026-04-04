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
  socialSentiment: number | null; // -1 to +1 (PRISM social)
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
const NEWS_TTL_MS = 60 * 60 * 1000;          // 60 min cache (Alpha Vantage free tier: 25 req/day)
const FUNDING_TTL_MS = 5 * 60 * 1000;        // 5 min cache
const SOCIAL_TTL_MS = 5 * 60 * 1000;         // 5 min cache

const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1';
const ALPHAVANTAGE_API_KEY = process.env.ALPHAVANTAGE_API_KEY || '';
const ALPHAVANTAGE_NEWS_URL = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=CRYPTO:ETH,CRYPTO:BTC&limit=50&apikey=${ALPHAVANTAGE_API_KEY}`;
const KRAKEN_TICKER_URL = 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD';

const PRISM_BASE_URL = 'https://api.prismapi.ai';
const PRISM_API_KEY = process.env.PRISM_API_KEY || '';

// Weights for composite (sum to 1.0) — balanced across 4 independent sources
const WEIGHT_FEAR_GREED = 0.25;
const WEIGHT_NEWS = 0.25;
const WEIGHT_FUNDING = 0.25;
const WEIGHT_SOCIAL = 0.25;

// ──── Cache ────

let fearGreedCache: CachedValue<number> | null = null;
let newsCache: CachedValue<number> | null = null;
let fundingCache: CachedValue<number> | null = null;
let socialCache: CachedValue<number> | null = null;

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

    // Normalize: 0-100 → [-1, +1] with contrarian extremes
    // At extremes (<20 or >80), fear/greed historically marks reversals.
    // Dampen the raw signal toward neutral at extremes to avoid always-bearish bias.
    let normalized = (raw - 50) / 50;
    const classification = data?.data?.[0]?.value_classification ?? 'unknown';

    if (raw <= 20) {
      // Extreme fear → contrarian: dampen bearishness, shift toward neutral/bullish
      // F&G=0 → +0.3 (mild bullish), F&G=10 → -0.1, F&G=20 → -0.2
      normalized = -0.2 + (20 - raw) / 20 * 0.5;
      log.info('Fear & Greed: contrarian override (extreme fear)', { raw, original: ((raw - 50) / 50).toFixed(2), contrarian: normalized.toFixed(2) });
    } else if (raw >= 80) {
      // Extreme greed → contrarian: dampen bullishness, shift toward neutral/bearish
      // F&G=80 → +0.2, F&G=90 → +0.1, F&G=100 → -0.3
      normalized = 0.2 - (raw - 80) / 20 * 0.5;
      log.info('Fear & Greed: contrarian override (extreme greed)', { raw, original: ((raw - 50) / 50).toFixed(2), contrarian: normalized.toFixed(2) });
    }

    fearGreedCache = { value: normalized, fetchedAt: Date.now() };
    log.info('Fear & Greed fetched', { raw, normalized: normalized.toFixed(2), classification });
    return normalized;
  } catch (err: any) {
    log.warn('Fear & Greed fetch failed', { error: err.message?.slice(0, 80) });
    return fearGreedCache?.value ?? null;
  }
}

// ──── Alpha Vantage News Sentiment ────

/**
 * Fetch pre-scored news sentiment from Alpha Vantage.
 * Returns articles with per-ticker sentiment scores already computed.
 * We average the ticker_sentiment_score for CRYPTO:ETH and CRYPTO:BTC across articles.
 *
 * Alpha Vantage scores: -1 (Bearish) to +1 (Bullish), already normalized.
 * Free tier: 25 requests/day → 60-min cache keeps us under limit.
 */
async function fetchNewsSentiment(): Promise<number | null> {
  if (newsCache && Date.now() - newsCache.fetchedAt < NEWS_TTL_MS) {
    return newsCache.value;
  }

  if (!ALPHAVANTAGE_API_KEY) {
    log.warn('No ALPHAVANTAGE_API_KEY — skipping news sentiment');
    return newsCache?.value ?? null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(ALPHAVANTAGE_NEWS_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn('Alpha Vantage returned non-OK', { status: res.status });
      return newsCache?.value ?? null;
    }

    const data = await res.json() as {
      feed?: Array<{
        title?: string;
        overall_sentiment_score?: number;
        overall_sentiment_label?: string;
        ticker_sentiment?: Array<{
          ticker?: string;
          ticker_sentiment_score?: string;
          ticker_sentiment_label?: string;
          relevance_score?: string;
        }>;
      }>;
      Information?: string;
      Note?: string;
    };

    // Check for rate limit or error messages
    if (data.Information || data.Note) {
      log.warn('Alpha Vantage API message', { msg: (data.Information || data.Note || '').slice(0, 100) });
      return newsCache?.value ?? null;
    }

    const articles = data?.feed;
    if (!articles || articles.length === 0) {
      log.warn('Alpha Vantage returned no articles');
      return newsCache?.value ?? null;
    }

    // Extract crypto-specific sentiment: average ticker scores for ETH and BTC
    let totalScore = 0;
    let scoreCount = 0;

    for (const article of articles) {
      const tickers = article.ticker_sentiment || [];
      for (const t of tickers) {
        const ticker = t.ticker || '';
        if (ticker === 'CRYPTO:ETH' || ticker === 'CRYPTO:BTC') {
          const score = Number(t.ticker_sentiment_score);
          const relevance = Number(t.relevance_score);
          if (Number.isFinite(score) && Number.isFinite(relevance) && relevance > 0) {
            // Weight by relevance — more relevant articles matter more
            totalScore += score * relevance;
            scoreCount += relevance;
          }
        }
      }
    }

    // If no crypto-specific scores, fall back to overall article sentiment
    if (scoreCount === 0) {
      for (const article of articles) {
        const score = Number(article.overall_sentiment_score);
        if (Number.isFinite(score)) {
          totalScore += score;
          scoreCount += 1;
        }
      }
    }

    if (scoreCount === 0) {
      log.warn('Alpha Vantage: no sentiment scores found');
      return newsCache?.value ?? null;
    }

    // Alpha Vantage scores are already in [-1, +1] range
    // Dampen slightly since news is noisy
    const avg = totalScore / scoreCount;
    const normalized = Math.max(-1, Math.min(1, avg * 0.85));

    const bullish = articles.filter(a => (a.overall_sentiment_score ?? 0) > 0.1).length;
    const bearish = articles.filter(a => (a.overall_sentiment_score ?? 0) < -0.1).length;

    newsCache = { value: normalized, fetchedAt: Date.now() };
    log.info('News sentiment fetched', {
      source: 'alpha_vantage',
      articles: articles.length,
      cryptoScores: Math.round(scoreCount),
      bullish,
      bearish,
      raw: avg.toFixed(3),
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

// ──── PRISM Social Sentiment ────

/**
 * Fetch crowd social sentiment from PRISM API.
 * Returns a normalized [-1, +1] score based on social media analysis.
 */
async function fetchSocialSentiment(): Promise<number | null> {
  if (socialCache && Date.now() - socialCache.fetchedAt < SOCIAL_TTL_MS) {
    return socialCache.value;
  }

  if (!PRISM_API_KEY) {
    return socialCache?.value ?? null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'X-API-Key': PRISM_API_KEY,
    };

    const res = await fetch(`${PRISM_BASE_URL}/social/ETH/sentiment`, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn('PRISM social sentiment API error', { status: res.status });
      return socialCache?.value ?? null;
    }

    const data = await res.json() as any;

    // Extract sentiment score — PRISM returns various formats
    // Look for a normalized score or compute from bullish/bearish ratio
    let normalized: number | null = null;

    if (typeof data?.sentiment_score === 'number') {
      // Direct score, typically -1 to +1 or 0-100
      const raw = data.sentiment_score;
      normalized = raw > 1 || raw < -1 ? (raw - 50) / 50 : raw;
    } else if (typeof data?.data?.sentiment_score === 'number') {
      const raw = data.data.sentiment_score;
      normalized = raw > 1 || raw < -1 ? (raw - 50) / 50 : raw;
    } else if (typeof data?.bullish === 'number' && typeof data?.bearish === 'number') {
      const total = data.bullish + data.bearish + (data.neutral ?? 0);
      if (total > 0) {
        normalized = (data.bullish - data.bearish) / total;
      }
    } else if (typeof data?.data?.bullish === 'number' && typeof data?.data?.bearish === 'number') {
      const d = data.data;
      const total = d.bullish + d.bearish + (d.neutral ?? 0);
      if (total > 0) {
        normalized = (d.bullish - d.bearish) / total;
      }
    }

    if (normalized === null || !Number.isFinite(normalized)) {
      log.warn('PRISM social: could not extract sentiment score');
      return socialCache?.value ?? null;
    }

    normalized = Math.max(-1, Math.min(1, normalized));
    socialCache = { value: normalized, fetchedAt: Date.now() };
    log.info('PRISM social sentiment fetched', { normalized: normalized.toFixed(2) });
    return normalized;
  } catch (err: any) {
    log.warn('PRISM social sentiment failed', { error: err.message?.slice(0, 80) });
    return socialCache?.value ?? null;
  }
}

// ──── PRISM Real Funding Rate ────

/**
 * Fetch real perpetual funding rates from PRISM.
 * Positive funding = longs paying shorts = crowded longs = contrarian bearish.
 * Negative funding = shorts paying longs = crowded shorts = contrarian bullish.
 */
async function fetchPrismFunding(): Promise<number | null> {
  if (!PRISM_API_KEY) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${PRISM_BASE_URL}/dex/ETH/funding/all`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'X-API-Key': PRISM_API_KEY },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json() as any;
    const rates = data?.data ?? data?.rates ?? data;

    // Average funding rates across exchanges
    let totalRate = 0;
    let count = 0;
    const rateValues = Array.isArray(rates) ? rates : Object.values(rates);
    for (const item of rateValues) {
      const rate = typeof item === 'number' ? item : (item?.funding_rate ?? item?.rate ?? null);
      if (typeof rate === 'number' && Number.isFinite(rate)) {
        totalRate += rate;
        count++;
      }
    }

    if (count === 0) return null;

    const avgRate = totalRate / count;
    // Funding rates are typically tiny (0.0001 = 0.01%)
    // Normalize: ±0.05% → ±1.0, inverted (positive funding = bearish)
    const normalized = Math.max(-1, Math.min(1, -Math.tanh(avgRate * 2000)));
    log.info('PRISM funding fetched', { avgRate: (avgRate * 100).toFixed(4) + '%', normalized: normalized.toFixed(2), exchanges: count });
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Fetch all sentiment sources in parallel and return weighted composite.
 * Gracefully degrades: if a source fails, remaining sources are re-weighted.
 */
export async function fetchSentiment(): Promise<SentimentResult> {
  const [fg, news, funding, social] = await Promise.all([
    fetchFearGreed(),
    fetchNewsSentiment(),
    fetchFundingProxy(),
    fetchSocialSentiment(),
  ]);

  // Try PRISM real funding as upgrade over Kraken VWAP proxy
  let effectiveFunding = funding;
  let fundingSource = 'funding_proxy';
  if (PRISM_API_KEY) {
    const prismFunding = await fetchPrismFunding();
    if (prismFunding !== null) {
      effectiveFunding = prismFunding;
      fundingSource = 'prism_funding';
    }
  }

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
  if (effectiveFunding !== null) {
    weightedSum += effectiveFunding * WEIGHT_FUNDING;
    totalWeight += WEIGHT_FUNDING;
    sources.push(fundingSource);
  }
  if (social !== null) {
    weightedSum += social * WEIGHT_SOCIAL;
    totalWeight += WEIGHT_SOCIAL;
    sources.push('prism_social');
  }

  const composite = totalWeight > 0 ? weightedSum / totalWeight : 0;

  if (totalWeight === 0) {
    log.warn('All sentiment sources returned null — composite forced to 0 (neutral). Check API keys and network.');
  }

  return {
    composite,
    fearGreed: fg,
    newsSentiment: news,
    fundingRate: effectiveFunding,
    socialSentiment: social,
    sources,
    fetchedAt: new Date().toISOString(),
  };
}
