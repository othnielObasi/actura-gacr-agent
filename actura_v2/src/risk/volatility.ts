/**
 * Volatility Tracker
 * Rolling EWMA volatility with regime detection
 */

export type VolatilityRegime = 'low' | 'normal' | 'high' | 'extreme';

export interface VolatilityState {
  current: number;
  baseline: number;
  ratio: number;         // current / baseline
  regime: VolatilityRegime;
  percentile: number;    // Where current vol sits in recent history
}

export class VolatilityTracker {
  private history: number[] = [];
  private readonly maxHistory = 200;
  private readonly baseline: number;

  constructor(baselineVolatility: number = 0.02) {
    this.baseline = baselineVolatility;
  }

  /** Add a new volatility reading */
  update(volatility: number): VolatilityState {
    this.history.push(volatility);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    return this.getState();
  }

  /** Get current volatility state */
  getState(): VolatilityState {
    const current = this.history.length > 0 
      ? this.history[this.history.length - 1] 
      : this.baseline;
    
    const ratio = current / this.baseline;
    const regime = this.classifyRegime(ratio);
    const percentile = this.calculatePercentile(current);

    return { current, baseline: this.baseline, ratio, regime, percentile };
  }

  private classifyRegime(ratio: number): VolatilityRegime {
    if (ratio < 0.7) return 'low';
    if (ratio <= 1.3) return 'normal';
    if (ratio <= 2.0) return 'high';
    return 'extreme';
  }

  private calculatePercentile(value: number): number {
    if (this.history.length < 2) return 50;
    const sorted = [...this.history].sort((a, b) => a - b);
    const rank = sorted.findIndex(v => v >= value);
    return Math.round((rank / sorted.length) * 100);
  }

  /** Reset state (for testing) */
  reset(): void {
    this.history = [];
  }
}
