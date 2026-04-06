/**
 * Sentiment Feed — 6-source composite: Fear & Greed, Alpha Vantage News,
 * PRISM Funding/Social/OI, Price Momentum.
 *
 * Each source normalized to [-1, +1]:
 *   -1 = extreme bearish/fear    0 = neutral    +1 = extreme bullish/greed
 *
 * The composite score is a weighted average of available sources.
 * News values are disk-cached to survive PM2 restarts.
 */

import { createLogger } from '../agent/logger.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const log = createLogger('SENTIMENT');

// ──── Disk cache for rate-limited sources ────
const CACHE_DIR = join(process.cwd(), '.actura');
const NEWS_CACHE_FILE = join(CACHE_DIR, 'news-cache.json');

function loadDiskCache(file: string): CachedValue<number> | null {
  try {
    if (!existsSync(file)) return null;
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    if (typeof data?.value === 'number' && typeof data?.fetchedAt === 'number') return data;
  } catch { /* ignore */ }
  return null;
}

function saveDiskCache(file: string, val: CachedValue<number>): void {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(val), 'utf-8');
  } catch { /* ignore */ }
}

// ──── Types ────

export interface SentimentResult {
  composite: number;          // -1 to +1 weighted average
  fearGreed: number | null;   // -1 to +1
  newsSentiment: number | null; // -1 to +1
  fundingRate: number | null; // -1 to +1
  socialSentiment: number | null; // -1 to +1 (PRISM social)
  openInterest: number | null;    // -1 to +1 (PRISM OI change)
  priceMomentum: number | null;   // -1 to +1 (PRISM 24h price change)
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
const OI_TTL_MS = 5 * 60 * 1000;             // 5 min cache
const PRICE_MOMENTUM_TTL_MS = 5 * 60 * 1000; // 5 min cache

const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1';
const ALPHAVANTAGE_API_KEY = process.env.ALPHAVANTAGE_API_KEY || '';
const ALPHAVANTAGE_NEWS_URL = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=CRYPTO:ETH,CRYPTO:BTC&limit=50&apikey=${ALPHAVANTAGE_API_KEY}`;
const KRAKEN_TICKER_URL = 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD';

const PRISM_BASE_URL = 'https://api.prismapi.ai';
const PRISM_API_KEY = process.env.PRISM_API_KEY || '';

// Weights for composite (sum to 1.0) — 6 independent sources
// Core sentiment (50%): fear/greed + news + social
// Market structure (30%): funding + price momentum  
// Derivatives (20%): open interest
const WEIGHT_FEAR_GREED = 0.20;
const WEIGHT_NEWS = 0.15;
const WEIGHT_FUNDING = 0.15;
const WEIGHT_SOCIAL = 0.15;
const WEIGHT_OI = 0.15;
const WEIGHT_PRICE_MOMENTUM = 0.20;

// ──── Cache ────

let fearGreedCache: CachedValue<number> | null = null;
let newsCache: CachedValue<number> | null = null;
let fundingCache: CachedValue<number> | null = null;
let socialCache: CachedValue<number> | null = null;
let oiCache: CachedValue<number> | null = null;
let priceMomentumCache: CachedValue<number> | null = null;

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

// ──── News Sentiment (CryptoPanic primary + Alpha Vantage fallback) ────

/**
 * Disk-persisted news cache survives PM2 restarts.
 * On startup, loads last known value from disk so we never show '-'.
 */
function getNewsFromDiskOrMemory(): number | null {
  if (newsCache && Date.now() - newsCache.fetchedAt < NEWS_TTL_MS) {
    return newsCache.value;
  }
  // Try disk cache (survives restarts, valid for 2 hours)
  const disk = loadDiskCache(NEWS_CACHE_FILE);
  if (disk && Date.now() - disk.fetchedAt < 2 * 60 * 60 * 1000) {
    newsCache = disk;
    return disk.value;
  }
  return null;
}

/**
 * Fetch news/market sentiment — PRISM primary, Alpha Vantage fallback.
 * Disk-persisted cache ensures values survive PM2 restarts.
 */
async function fetchNewsSentiment(): Promise<number | null> {
  // Check memory + disk cache first
  const cached = getNewsFromDiskOrMemory();
  if (cached !== null) return cached;

  // Try PRISM sentiment first (no daily limit)
  let result = await fetchPrismSentiment();
  let source = 'prism_sentiment';

  // Fallback to Alpha Vantage
  if (result === null && ALPHAVANTAGE_API_KEY) {
    result = await fetchAlphaVantageNews();
    source = 'alpha_vantage';
  }

  if (result !== null) {
    newsCache = { value: result, fetchedAt: Date.now() };
    saveDiskCache(NEWS_CACHE_FILE, newsCache);
    log.info('News sentiment cached to disk', { source, normalized: result.toFixed(2) });
  }

  return result;
}

/**
 * PRISM composite sentiment — combines price momentum, social engagement,
 * and developer activity into a 0-100 score.
 * Normalized to [-1, +1]: 0→-1, 50→0, 100→+1
 */
async function fetchPrismSentiment(): Promise<number | null> {
  if (!PRISM_API_KEY) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${PRISM_BASE_URL}/social/ETH/sentiment`, {
      signal: controller.signal,
      headers: { 'X-API-Key': PRISM_API_KEY, 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn('PRISM sentiment returned non-OK', { status: res.status });
      return null;
    }

    const data = await res.json() as {
      sentiment_score?: number;
      sentiment_label?: string;
      components?: {
        price_momentum?: number;
        social_engagement?: number;
        developer_activity?: number;
      };
    };

    const score = data?.sentiment_score;
    if (typeof score !== 'number' || !Number.isFinite(score)) return null;

    // 0-100 → [-1, +1]: 50 is neutral
    const normalized = Math.max(-1, Math.min(1, (score - 50) / 50));

    log.info('PRISM sentiment fetched', {
      score,
      label: data.sentiment_label,
      momentum: data.components?.price_momentum,
      social: data.components?.social_engagement,
      devActivity: data.components?.developer_activity,
      normalized: normalized.toFixed(2),
    });
    return normalized;
  } catch (err: any) {
    log.warn('PRISM sentiment fetch failed', { error: err.message?.slice(0, 80) });
    return null;
  }
}

/**
 * Alpha Vantage news — fallback source (25 req/day free tier).
 */
async function fetchAlphaVantageNews(): Promise<number | null> {

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
      return null;
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
      return null;
    }

    const articles = data?.feed;
    if (!articles || articles.length === 0) {
      log.warn('Alpha Vantage returned no articles');
      return null;
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
      return null;
    }

    // Alpha Vantage scores are already in [-1, +1] range
    // Dampen slightly since news is noisy
    const avg = totalScore / scoreCount;
    const normalized = Math.max(-1, Math.min(1, avg * 0.85));

    const bullish = articles.filter(a => (a.overall_sentiment_score ?? 0) > 0.1).length;
    const bearish = articles.filter(a => (a.overall_sentiment_score ?? 0) < -0.1).length;

    newsCache = { value: normalized, fetchedAt: Date.now() };
    log.info('Alpha Vantage news fetched', {
      articles: articles.length,
      cryptoScores: Math.round(scoreCount),
      bullish,
      bearish,
      raw: avg.toFixed(3),
      normalized: normalized.toFixed(2),
    });
    return normalized;
  } catch (err: any) {
    log.warn('Alpha Vantage fetch failed', { error: err.message?.slice(0, 80) });
    return null;
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
    // Use linear scaling for better sensitivity to small changes
    // ±1% deviation → ±0.4, ±3% → ±1.0 (clamped)
    const contrarian = -Math.max(-1, Math.min(1, deviation * 33));
    const momentum = Math.max(-1, Math.min(1, intradayMove * 25));

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
    // Response: { funding_rates: { exchange: rate|null, ... } }
    const fundingRates = data?.funding_rates ?? data?.data?.funding_rates ?? data?.data ?? data;

    let totalRate = 0;
    let count = 0;
    const entries = typeof fundingRates === 'object' && !Array.isArray(fundingRates)
      ? Object.values(fundingRates)
      : Array.isArray(fundingRates) ? fundingRates : [];
    for (const item of entries) {
      const rate = typeof item === 'number' ? item : (item?.funding_rate ?? item?.rate ?? null);
      if (typeof rate === 'number' && Number.isFinite(rate)) {
        totalRate += rate;
        count++;
      }
    }

    if (count === 0) {
      log.warn('PRISM funding: no valid rates in response', { dataKeys: Object.keys(data || {}).join(',') });
      return null;
    }

    const avgRate = totalRate / count;
    // Funding rates are typically tiny (0.0001 = 0.01%)
    // Normalize: ±0.05% → ±1.0, inverted (positive funding = bearish)
    const normalized = Math.max(-1, Math.min(1, -Math.tanh(avgRate * 2000)));
    log.info('PRISM funding fetched', { avgRate: (avgRate * 100).toFixed(4) + '%', normalized: normalized.toFixed(2), exchanges: count });
    return normalized;
  } catch (err: any) {
    log.warn('PRISM funding fetch failed', { error: err.message?.slice(0, 80) });
    return null;
  }
}

// ──── PRISM Price Momentum ────

/**
 * Fetch 24h price change from PRISM multi-source aggregated price API.
 * Converts percentage change into a directional sentiment signal.
 * +5% → bullish, -5% → bearish (clamped at ±1)
 */
async function fetchPriceMomentum(): Promise<number | null> {
  if (priceMomentumCache && Date.now() - priceMomentumCache.fetchedAt < PRICE_MOMENTUM_TTL_MS) {
    return priceMomentumCache.value;
  }

  if (!PRISM_API_KEY) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${PRISM_BASE_URL}/crypto/price/ETH`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'X-API-Key': PRISM_API_KEY },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn('PRISM price API error', { status: res.status });
      return priceMomentumCache?.value ?? null;
    }

    const data = await res.json() as any;
    const changePct = data?.change_24h_pct;

    if (typeof changePct !== 'number' || !Number.isFinite(changePct)) {
      log.warn('PRISM price: no change_24h_pct', { dataKeys: Object.keys(data || {}).join(',') });
      return priceMomentumCache?.value ?? null;
    }

    // ±10% 24h change → ±1.0
    const normalized = Math.max(-1, Math.min(1, changePct / 10));

    priceMomentumCache = { value: normalized, fetchedAt: Date.now() };
    log.info('PRISM price momentum fetched', { changePct: changePct.toFixed(2) + '%', normalized: normalized.toFixed(2), sources: data?.sources_used ?? 0 });
    return normalized;
  } catch (err: any) {
    log.warn('PRISM price momentum failed', { error: err.message?.slice(0, 80) });
    return priceMomentumCache?.value ?? null;
  }
}

// ──── PRISM Open Interest ────

/**
 * Fetch aggregated open interest from PRISM.
 * Rising OI = new money entering = trend strengthening.
 * Falling OI = positions closing = trend weakening.
 * We measure OI change rate as a sentiment signal.
 */
let prevOiValue: number | null = null;

async function fetchOpenInterest(): Promise<number | null> {
  if (oiCache && Date.now() - oiCache.fetchedAt < OI_TTL_MS) {
    return oiCache.value;
  }

  if (!PRISM_API_KEY) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${PRISM_BASE_URL}/dex/ETH/oi/all`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'X-API-Key': PRISM_API_KEY },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn('PRISM OI API error', { status: res.status });
      return oiCache?.value ?? null;
    }

    const data = await res.json() as any;
    const oiData = data?.data ?? data;

    // Extract total OI value
    let totalOI: number | null = null;

    if (typeof oiData?.total_oi === 'number') {
      totalOI = oiData.total_oi;
    } else if (typeof oiData?.open_interest === 'number') {
      totalOI = oiData.open_interest;
    } else if (typeof oiData?.oi === 'number') {
      totalOI = oiData.oi;
    } else if (Array.isArray(oiData) && oiData.length > 0) {
      // Sum across exchanges
      totalOI = 0;
      for (const item of oiData) {
        const val = item?.oi ?? item?.open_interest ?? item?.total_oi;
        if (typeof val === 'number') totalOI += val;
      }
    } else if (typeof oiData === 'object' && oiData !== null) {
      // Object keyed by exchange
      totalOI = 0;
      for (const val of Object.values(oiData)) {
        const v = typeof val === 'number' ? val : (val as any)?.oi ?? (val as any)?.open_interest;
        if (typeof v === 'number') totalOI += v;
      }
    }

    if (totalOI === null || !Number.isFinite(totalOI) || totalOI <= 0) {
      log.warn('PRISM OI: could not extract open interest', { dataKeys: Object.keys(oiData || {}).join(',') });
      return oiCache?.value ?? null;
    }

    // Compare with previous reading to get change rate
    let normalized = 0;
    if (prevOiValue !== null && prevOiValue > 0) {
      const changePct = (totalOI - prevOiValue) / prevOiValue;
      // Rising OI is directionally neutral but confirms trends
      // ±5% change → ±1.0
      // Positive = OI rising = trend conviction = mild bullish bias (trending markets tend bullish)
      normalized = Math.max(-1, Math.min(1, changePct * 20));
    }
    prevOiValue = totalOI;

    oiCache = { value: normalized, fetchedAt: Date.now() };
    log.info('PRISM OI fetched', { totalOI: totalOI.toFixed(0), changePct: prevOiValue ? ((totalOI / prevOiValue - 1) * 100).toFixed(2) + '%' : 'first', normalized: normalized.toFixed(2) });
    return normalized;
  } catch (err: any) {
    log.warn('PRISM OI failed', { error: err.message?.slice(0, 80) });
    return oiCache?.value ?? null;
  }
}

/**
 * Fetch all sentiment sources in parallel and return weighted composite.
 * Gracefully degrades: if a source fails, remaining sources are re-weighted.
 */
export async function fetchSentiment(): Promise<SentimentResult> {
  const [fg, news, funding, social, oi, priceMom] = await Promise.all([
    fetchFearGreed(),
    fetchNewsSentiment(),
    fetchFundingProxy(),
    fetchSocialSentiment(),
    fetchOpenInterest(),
    fetchPriceMomentum(),
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
  if (oi !== null) {
    weightedSum += oi * WEIGHT_OI;
    totalWeight += WEIGHT_OI;
    sources.push('open_interest');
  }
  if (priceMom !== null) {
    weightedSum += priceMom * WEIGHT_PRICE_MOMENTUM;
    totalWeight += WEIGHT_PRICE_MOMENTUM;
    sources.push('price_momentum');
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
    openInterest: oi,
    priceMomentum: priceMom,
    sources,
    fetchedAt: new Date().toISOString(),
  };
}
