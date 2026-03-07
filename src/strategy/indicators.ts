/**
 * Technical Indicators for Actura Trading Strategy
 * Pure math — no external dependencies needed
 */

/** Simple Moving Average */
export function sma(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

/** Exponentially Weighted Moving Average of returns */
export function ewmaVolatility(prices: number[], span: number): number | null {
  if (prices.length < 3) return null;
  
  // Calculate returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  
  if (returns.length < 2) return null;
  
  const alpha = 2 / (span + 1);
  let variance = returns[0] ** 2;
  
  for (let i = 1; i < returns.length; i++) {
    variance = alpha * returns[i] ** 2 + (1 - alpha) * variance;
  }
  
  return Math.sqrt(variance);
}

/** Average True Range */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): number | null {
  if (highs.length < period + 1) return null;
  
  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }
  
  if (trueRanges.length < period) return null;
  
  // Use simple average for first ATR, then EMA
  let atrValue = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atrValue = (trueRanges[i] + (period - 1) * atrValue) / period;
  }
  
  return atrValue;
}

/** Calculate daily returns from price array */
export function dailyReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return returns;
}

/** Annualized Sharpe Ratio (assuming 365 trading days for crypto) */
export function sharpeRatio(returns: number[], riskFreeRate: number = 0): number | null {
  if (returns.length < 2) return null;
  
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return null;
  
  const dailySharpe = (meanReturn - riskFreeRate / 365) / stdDev;
  return dailySharpe * Math.sqrt(365);
}


/** Exponential Moving Average */
export function ema(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const alpha = 2 / (period + 1);
  let value = prices[prices.length - period];
  for (let i = prices.length - period + 1; i < prices.length; i++) {
    value = alpha * prices[i] + (1 - alpha) * value;
  }
  return value;
}

/** Sample standard deviation */
export function stddev(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const varSum = slice.reduce((s, v) => s + (v - mean) ** 2, 0);
  return Math.sqrt(varSum / Math.max(1, slice.length - 1));
}

/** RSI (Wilder's) */
export function rsi(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  // seed
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // One-step Wilder smoothing across the same window is enough for our rolling usage.
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/** Z-score of last price vs rolling mean/std */
export function zscore(prices: number[], period: number = 20): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const sd = stddev(slice, slice.length);
  if (!sd || sd === 0) return 0;
  return (prices[prices.length - 1] - mean) / sd;
}

/** Autocorrelation of returns at lag 1 (simple proxy for trendiness) */
export function autocorrLag1(prices: number[], period: number = 30): number | null {
  const rets = dailyReturns(prices);
  if (rets.length < period + 1) return null;
  const x = rets.slice(-period - 1, -1);
  const y = rets.slice(-period);
  const meanX = x.reduce((s, v) => s + v, 0) / x.length;
  const meanY = y.reduce((s, v) => s + v, 0) / y.length;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < period; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

/**
 * Choppiness Index (CHOP)
 * Measures how "ranging" a market is.
 * Values ~ 55-70: choppy/ranging. Values ~ 35-45: trending.
 */
export function choppinessIndex(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number | null {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) return null;

  // Sum of true range over period
  let trSum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const hi = highs[i];
    const lo = lows[i];
    const prevClose = closes[i - 1];
    const tr = Math.max(hi - lo, Math.abs(hi - prevClose), Math.abs(lo - prevClose));
    trSum += tr;
  }

  // Highest high and lowest low over period
  const hiSlice = highs.slice(-period);
  const loSlice = lows.slice(-period);
  const highestHigh = Math.max(...hiSlice);
  const lowestLow = Math.min(...loSlice);
  const range = highestHigh - lowestLow;

  if (range <= 0 || trSum <= 0) return null;

  const chop = 100 * (Math.log10(trSum / range) / Math.log10(period));
  return chop;
}

/**
 * ADX (Average Directional Index) — simplified Wilder version.
 * Provides a trend-strength signal (>= 25 is commonly considered trending).
 */
export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number | null {
  if (highs.length < period + 2 || lows.length < period + 2 || closes.length < period + 2) return null;

  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    const plusDM = (upMove > downMove && upMove > 0) ? upMove : 0;
    const minusDM = (downMove > upMove && downMove > 0) ? downMove : 0;

    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );

    trs.push(tr);
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  if (trs.length < period) return null;

  // Wilder smoothing
  let tr14 = trs.slice(0, period).reduce((s, v) => s + v, 0);
  let plus14 = plusDMs.slice(0, period).reduce((s, v) => s + v, 0);
  let minus14 = minusDMs.slice(0, period).reduce((s, v) => s + v, 0);

  const dxs: number[] = [];

  for (let i = period; i < trs.length; i++) {
    // Avoid divide by zero
    if (tr14 === 0) break;

    const plusDI = 100 * (plus14 / tr14);
    const minusDI = 100 * (minus14 / tr14);
    const diSum = plusDI + minusDI;
    const diDiff = Math.abs(plusDI - minusDI);
    const dx = diSum === 0 ? 0 : 100 * (diDiff / diSum);
    dxs.push(dx);

    // update smoothing
    tr14 = tr14 - (tr14 / period) + trs[i];
    plus14 = plus14 - (plus14 / period) + plusDMs[i];
    minus14 = minus14 - (minus14 / period) + minusDMs[i];
  }

  if (dxs.length < period) return null;

  // ADX is EMA (Wilder) of DX
  let adxVal = dxs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < dxs.length; i++) {
    adxVal = ((adxVal * (period - 1)) + dxs[i]) / period;
  }
  return adxVal;
}

/** Return over N periods */
export function returnOver(prices: number[], periods: number): number | null {
  if (prices.length < periods + 1) return null;
  const last = prices[prices.length - 1];
  const prev = prices[prices.length - 1 - periods];
  if (prev === 0) return null;
  return (last - prev) / prev;
}
