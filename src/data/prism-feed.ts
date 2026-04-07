/**
 * PRISM Feed — AI-Powered Market Intelligence from Strykr
 *
 * Provides two independent data streams:
 *   1. AI Signals: direction, strength, RSI, MACD, Bollinger signals
 *   2. Risk Metrics: external volatility, Sharpe, Sortino, drawdown
 *
 * Used as a signal booster/confirmation for the primary SMA strategy.
 * NOT a replacement — PRISM signals are one input into the confidence model.
 *
 * API: https://api.prismapi.ai
 * Rate: Free tier + $10 credits (~15K calls via LABLAB code)
 */

import { createLogger } from '../agent/logger.js';

const log = createLogger('PRISM');

const PRISM_BASE_URL = 'https://api.prismapi.ai';
const FETCH_TIMEOUT_MS = 5000;
const SIGNALS_TTL_MS = 3 * 60 * 1000;   // 3 min cache
const RISK_TTL_MS = 10 * 60 * 1000;     // 10 min cache

// ──── Types ────

export interface PrismSignal {
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
  bullishScore: number;
  bearishScore: number;
  netScore: number;
  currentPrice: number;
  rsi: number | null;
  macd: number | null;
  macdHistogram: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  activeSignals: Array<{ type: string; signal: string; value: number }>;
  signalCount: number;
  timestamp: string;
}

export interface PrismRisk {
  dailyVolatility: number;
  annualVolatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  avgDailyReturn: number;
  positiveDaysPct: number;
  timestamp: string;
}

export interface PrismData {
  signal: PrismSignal | null;
  risk: PrismRisk | null;
  sources: string[];
}

// ──── Cache ────

interface CachedValue<T> { value: T; fetchedAt: number; }

let signalCache: CachedValue<PrismSignal> | null = null;
let riskCache: CachedValue<PrismRisk> | null = null;

const PRISM_API_KEY = process.env.PRISM_API_KEY || '';

// ──── Fetch Helpers ────

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (PRISM_API_KEY) {
      headers['X-API-Key'] = PRISM_API_KEY;
    }
    return await fetch(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

// ──── Signal Fetcher ────

async function fetchPrismSignal(symbol: string = 'ETH'): Promise<PrismSignal | null> {
  const now = Date.now();
  if (signalCache && (now - signalCache.fetchedAt) < SIGNALS_TTL_MS) {
    return signalCache.value;
  }

  try {
    const res = await fetchWithTimeout(`${PRISM_BASE_URL}/signals/${symbol}`, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      log.warn('PRISM signals API error', { status: res.status });
      return signalCache?.value ?? null;
    }

    const data = await res.json() as any;
    const item = data?.data?.[0];
    if (!item) {
      log.warn('PRISM signals: no data returned');
      return signalCache?.value ?? null;
    }

    const signal: PrismSignal = {
      direction: item.overall_signal || item.direction || 'neutral',
      strength: item.strength || 'weak',
      bullishScore: item.bullish_score ?? 0,
      bearishScore: item.bearish_score ?? 0,
      netScore: item.net_score ?? 0,
      currentPrice: item.current_price ?? 0,
      rsi: item.indicators?.rsi ?? null,
      macd: item.indicators?.macd ?? null,
      macdHistogram: item.indicators?.macd_histogram ?? null,
      bollingerUpper: item.indicators?.bollinger_upper ?? null,
      bollingerLower: item.indicators?.bollinger_lower ?? null,
      activeSignals: item.active_signals ?? [],
      signalCount: item.signal_count ?? 0,
      timestamp: item.timestamp ?? new Date().toISOString(),
    };

    signalCache = { value: signal, fetchedAt: now };
    log.info('PRISM signal fetched', {
      direction: signal.direction,
      strength: signal.strength,
      rsi: signal.rsi?.toFixed(1),
      macd: signal.macdHistogram?.toFixed(2),
      signals: signal.signalCount,
    });
    return signal;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      log.warn('PRISM signals timeout');
    } else {
      log.warn('PRISM signals fetch failed', { error: err.message?.slice(0, 80) });
    }
    return signalCache?.value ?? null;
  }
}

// ──── Risk Fetcher ────

async function fetchPrismRisk(symbol: string = 'ETH'): Promise<PrismRisk | null> {
  const now = Date.now();
  if (riskCache && (now - riskCache.fetchedAt) < RISK_TTL_MS) {
    return riskCache.value;
  }

  try {
    const res = await fetchWithTimeout(`${PRISM_BASE_URL}/risk/${symbol}`, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      log.warn('PRISM risk API error', { status: res.status });
      return riskCache?.value ?? null;
    }

    const data = await res.json() as any;

    const risk: PrismRisk = {
      dailyVolatility: data.daily_volatility ?? 0,
      annualVolatility: data.annual_volatility ?? 0,
      sharpeRatio: data.sharpe_ratio ?? 0,
      sortinoRatio: data.sortino_ratio ?? 0,
      maxDrawdown: data.max_drawdown ?? 0,
      currentDrawdown: data.current_drawdown ?? 0,
      avgDailyReturn: data.avg_daily_return ?? 0,
      positiveDaysPct: data.positive_days_pct ?? 0,
      timestamp: data.timestamp ?? new Date().toISOString(),
    };

    riskCache = { value: risk, fetchedAt: now };
    log.info('PRISM risk fetched', {
      dailyVol: risk.dailyVolatility.toFixed(2),
      sharpe: risk.sharpeRatio.toFixed(2),
      maxDD: risk.maxDrawdown.toFixed(1) + '%',
      currentDD: risk.currentDrawdown.toFixed(1) + '%',
    });
    return risk;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      log.warn('PRISM risk timeout');
    } else {
      log.warn('PRISM risk fetch failed', { error: err.message?.slice(0, 80) });
    }
    return riskCache?.value ?? null;
  }
}

// ──── Public API ────

/**
 * Fetch PRISM signals + risk for a given symbol.
 * Both calls are independent and cached separately.
 */
export async function fetchPrismData(symbol: string = 'ETH'): Promise<PrismData> {
  const [signal, risk] = await Promise.all([
    fetchPrismSignal(symbol),
    fetchPrismRisk(symbol),
  ]);

  const sources: string[] = [];
  if (signal) sources.push('prism_signals');
  if (risk) sources.push('prism_risk');

  return { signal, risk, sources };
}

/**
 * Convert PRISM signal to a confidence modifier (0 to +0.15).
 * CONFIRMATION-ONLY: PRISM can boost confidence when it agrees,
 * but never penalizes the primary strategy when it disagrees.
 *
 * Rationale: PRISM uses technical indicators (RSI, MACD) while our
 * sentiment feed uses crowd psychology (Fear & Greed). These can
 * legitimately disagree (price rising during extreme fear). Letting
 * PRISM veto the primary signal killed valid trades (e.g. cycle 517).
 *
 * Logic:
 *   - If PRISM direction agrees with our signal → boost confidence
 *   - If PRISM direction disagrees → no penalty (return 0)
 *   - Strength scales the boost magnitude
 */
export function prismConfidenceModifier(
  prismSignal: PrismSignal | null,
  ourDirection: 'LONG' | 'SHORT' | 'NEUTRAL',
): number {
  if (!prismSignal || ourDirection === 'NEUTRAL') return 0;

  const prismBullish = prismSignal.direction === 'bullish';
  const prismBearish = prismSignal.direction === 'bearish';
  const weAreLong = ourDirection === 'LONG';
  const weAreShort = ourDirection === 'SHORT';

  const agrees = (prismBullish && weAreLong) || (prismBearish && weAreShort);

  const strengthMultiplier = prismSignal.strength === 'strong' ? 1.0
    : prismSignal.strength === 'moderate' ? 0.65
    : 0.35;

  // Confirmation-only: boost when aligned, ignore when conflicting
  if (agrees) return 0.15 * strengthMultiplier;
  return 0;
}

// ──── Asset Resolution ────

export interface PrismResolveResult {
  symbol: string;
  name: string | null;
  chain: string | null;
  contractAddress: string | null;
  priceUsd: number | null;
  resolved: boolean;
  timestamp: string;
}

let resolveCache: CachedValue<PrismResolveResult> | null = null;
const RESOLVE_TTL_MS = 30 * 60 * 1000; // 30 min cache (rarely changes)

/**
 * Resolve an asset symbol via PRISM /resolve/{asset}.
 * Returns metadata about the asset: chain, contract, price, etc.
 */
export async function fetchPrismResolve(symbol: string = 'ETH'): Promise<PrismResolveResult | null> {
  const now = Date.now();
  if (resolveCache && (now - resolveCache.fetchedAt) < RESOLVE_TTL_MS) {
    return resolveCache.value;
  }

  try {
    const res = await fetchWithTimeout(`${PRISM_BASE_URL}/resolve/${symbol}`, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      log.warn('PRISM resolve API error', { status: res.status, symbol });
      return resolveCache?.value ?? null;
    }

    const data = await res.json() as any;

    const result: PrismResolveResult = {
      symbol: data?.symbol || symbol,
      name: data?.name || data?.asset_name || null,
      chain: data?.chain || data?.network || null,
      contractAddress: data?.contract_address || data?.address || null,
      priceUsd: data?.price_usd ?? data?.price ?? null,
      resolved: true,
      timestamp: data?.timestamp ?? new Date().toISOString(),
    };

    resolveCache = { value: result, fetchedAt: now };
    log.info('PRISM asset resolved', {
      symbol: result.symbol,
      name: result.name,
      chain: result.chain,
      price: result.priceUsd,
    });
    return result;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      log.warn('PRISM resolve timeout', { symbol });
    } else {
      log.warn('PRISM resolve fetch failed', { symbol, error: err.message?.slice(0, 80) });
    }
    return resolveCache?.value ?? null;
  }
}
