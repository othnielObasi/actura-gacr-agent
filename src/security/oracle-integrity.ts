export interface OracleIntegrityInput {
  prices: number[];
  highs: number[];
  lows: number[];
  timestamps: string[];
  externalPrice?: number | null;
  maxMedianDeviationPct?: number;
  maxExternalDeviationPct?: number;
  maxSingleBarMovePct?: number;
  maxSingleBarRangePct?: number;
  staleAfterMinutes?: number;
}

export interface OracleIntegrityResult {
  passed: boolean;
  status: 'healthy' | 'watch' | 'blocked';
  currentPrice: number;
  medianReferencePrice: number;
  twap5: number;
  singleBarMovePct: number;
  singleBarRangePct: number;
  deviationFromMedianPct: number;
  externalDeviationPct: number | null;
  staleMinutes: number;
  reasons: string[];
  blockers: string[];
}

export function evaluateOracleIntegrity(input: OracleIntegrityInput): OracleIntegrityResult {
  const currentPrice = input.prices[input.prices.length - 1] ?? 0;
  const last9 = input.prices.slice(-9);
  const medianReferencePrice = median(last9.length ? last9 : input.prices);
  const twap5 = average(input.prices.slice(-5));
  const prevPrice = input.prices[input.prices.length - 2] ?? currentPrice;
  const lastHigh = input.highs[input.highs.length - 1] ?? currentPrice;
  const lastLow = input.lows[input.lows.length - 1] ?? currentPrice;
  const deviationFromMedianPct = pctDiff(currentPrice, medianReferencePrice);
  const externalDeviationPct = input.externalPrice ? pctDiff(currentPrice, input.externalPrice) : null;
  const singleBarMovePct = prevPrice > 0 ? Math.abs(currentPrice - prevPrice) / prevPrice : 0;
  const singleBarRangePct = currentPrice > 0 ? Math.abs(lastHigh - lastLow) / currentPrice : 0;
  const staleMinutes = computeStalenessMinutes(input.timestamps[input.timestamps.length - 1]);

  const maxMedianDeviationPct = input.maxMedianDeviationPct ?? 0.08;
  const maxExternalDeviationPct = input.maxExternalDeviationPct ?? 0.03;
  const maxSingleBarMovePct = input.maxSingleBarMovePct ?? 0.08;
  const maxSingleBarRangePct = input.maxSingleBarRangePct ?? 0.12;
  const staleAfterMinutes = input.staleAfterMinutes ?? 30;  // 30 min (tighter for production)

  const reasons: string[] = [];
  const blockers: string[] = [];

  if (deviationFromMedianPct > maxMedianDeviationPct) {
    blockers.push(`median_deviation ${fmtPct(deviationFromMedianPct)} > ${fmtPct(maxMedianDeviationPct)}`);
  } else if (deviationFromMedianPct > maxMedianDeviationPct * 0.7) {
    reasons.push(`median_deviation_watch ${fmtPct(deviationFromMedianPct)}`);
  }

  if (externalDeviationPct !== null) {
    if (externalDeviationPct > maxExternalDeviationPct) blockers.push(`external_deviation ${fmtPct(externalDeviationPct)} > ${fmtPct(maxExternalDeviationPct)}`);
    else if (externalDeviationPct > maxExternalDeviationPct * 0.7) reasons.push(`external_deviation_watch ${fmtPct(externalDeviationPct)}`);
  }

  if (singleBarMovePct > maxSingleBarMovePct) blockers.push(`single_bar_move ${fmtPct(singleBarMovePct)} > ${fmtPct(maxSingleBarMovePct)}`);
  else if (singleBarMovePct > maxSingleBarMovePct * 0.7) reasons.push(`single_bar_move_watch ${fmtPct(singleBarMovePct)}`);

  if (singleBarRangePct > maxSingleBarRangePct) blockers.push(`single_bar_range ${fmtPct(singleBarRangePct)} > ${fmtPct(maxSingleBarRangePct)}`);

  // Multi-bar cumulative move: catch flash crashes spread across 2-3 bars
  // that individually pass the single-bar check.
  const maxMultiBarMovePct = 0.10;  // 10% over 3 bars
  if (input.prices.length >= 4) {
    const price3BarsAgo = input.prices[input.prices.length - 4];
    const cumulativeMovePct = price3BarsAgo > 0
      ? Math.abs(currentPrice - price3BarsAgo) / price3BarsAgo
      : 0;
    if (cumulativeMovePct > maxMultiBarMovePct) {
      blockers.push(`multi_bar_move_3 ${fmtPct(cumulativeMovePct)} > ${fmtPct(maxMultiBarMovePct)}`);
    } else if (cumulativeMovePct > maxMultiBarMovePct * 0.7) {
      reasons.push(`multi_bar_move_watch ${fmtPct(cumulativeMovePct)}`);
    }
  }

  if (staleMinutes > staleAfterMinutes) blockers.push(`stale_price_feed ${staleMinutes.toFixed(1)}m > ${staleAfterMinutes}m`);

  let status: OracleIntegrityResult['status'] = 'healthy';
  if (blockers.length > 0) status = 'blocked';
  else if (reasons.length > 0) status = 'watch';

  return {
    passed: blockers.length === 0,
    status,
    currentPrice,
    medianReferencePrice: round4(medianReferencePrice),
    twap5: round4(twap5),
    singleBarMovePct: round4(singleBarMovePct),
    singleBarRangePct: round4(singleBarRangePct),
    deviationFromMedianPct: round4(deviationFromMedianPct),
    externalDeviationPct: externalDeviationPct === null ? null : round4(externalDeviationPct),
    staleMinutes: round2(staleMinutes),
    reasons,
    blockers,
  };
}

function median(values: number[]): number {
  const arr = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (arr.length === 0) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}
function average(values: number[]): number {
  const arr = values.filter(Number.isFinite);
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function pctDiff(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return Math.abs(a - b) / Math.abs(b);
}
function computeStalenessMinutes(ts?: string): number {
  if (!ts) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - new Date(ts).getTime();
  return ms / 60000;
}
function fmtPct(v: number): string { return `${(v * 100).toFixed(2)}%`; }
function round2(v: number): number { return Math.round(v * 100) / 100; }
function round4(v: number): number { return Math.round(v * 10000) / 10000; }
