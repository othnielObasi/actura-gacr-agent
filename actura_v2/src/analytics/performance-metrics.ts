export interface EquityPoint {
  timestamp: string | number | Date;
  equity: number;
}

export interface TradeOutcome {
  pnl: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  meanReturn: number;
  volatility: number;
  downsideDeviation: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  calmarRatio: number;
  profitFactor: number;
  winRate: number;
  periods: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function downsideStdDev(values: number[]): number {
  const downside = values.filter((v) => v < 0);
  if (downside.length === 0) return 0;
  return stdDev(downside);
}

export function equityToReturns(points: EquityPoint[]): number[] {
  if (points.length < 2) return [];
  const sorted = [...points].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  const returns: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1].equity;
    const curr = sorted[i].equity;
    if (prev <= 0) throw new Error('Equity must be positive to compute returns');
    returns.push((curr - prev) / prev);
  }
  return returns;
}

export function computeMaxDrawdown(points: EquityPoint[]): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  let peak = sorted[0].equity;
  let maxDrawdown = 0;
  for (const point of sorted) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) {
      const dd = (peak - point.equity) / peak;
      maxDrawdown = Math.max(maxDrawdown, dd);
    }
  }
  return maxDrawdown;
}

export function computeProfitFactor(trades: TradeOutcome[]): number {
  const grossProfit = trades.filter((t) => t.pnl > 0).reduce((acc, t) => acc + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((acc, t) => acc + t.pnl, 0));
  if (grossLoss === 0) return grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  return grossProfit / grossLoss;
}

export function computeWinRate(trades: TradeOutcome[]): number {
  if (trades.length === 0) return 0;
  const wins = trades.filter((t) => t.pnl > 0).length;
  return wins / trades.length;
}

export function computeRiskAdjustedMetrics(
  equityPoints: EquityPoint[],
  trades: TradeOutcome[] = [],
  riskFreeRatePerPeriod = 0,
): PerformanceMetrics {
  if (equityPoints.length < 2) {
    return {
      totalReturn: 0,
      meanReturn: 0,
      volatility: 0,
      downsideDeviation: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      calmarRatio: 0,
      profitFactor: computeProfitFactor(trades),
      winRate: computeWinRate(trades),
      periods: 0,
    };
  }

  const returns = equityToReturns(equityPoints);
  const meanReturn = mean(returns);
  const excessReturn = meanReturn - riskFreeRatePerPeriod;
  const volatility = stdDev(returns);
  const downsideDeviation = downsideStdDev(returns);
  const maxDrawdown = computeMaxDrawdown(equityPoints);
  const first = equityPoints[0].equity;
  const last = equityPoints[equityPoints.length - 1].equity;
  const totalReturn = first > 0 ? (last - first) / first : 0;

  return {
    totalReturn,
    meanReturn,
    volatility,
    downsideDeviation,
    sharpeRatio: volatility > 0 ? excessReturn / volatility : 0,
    sortinoRatio: downsideDeviation > 0 ? excessReturn / downsideDeviation : 0,
    maxDrawdown,
    calmarRatio: maxDrawdown > 0 ? totalReturn / maxDrawdown : 0,
    profitFactor: computeProfitFactor(trades),
    winRate: computeWinRate(trades),
    periods: returns.length,
  };
}
