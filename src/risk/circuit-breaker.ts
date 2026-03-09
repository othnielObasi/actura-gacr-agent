/**
 * Circuit Breaker — Production Grade
 * 
 * State machine: ARMED → TRIPPED → COOLING → ARMED
 * 
 * Fixes from v1:
 * - PnL tracked only via recordTradePnl (no double-counting)
 * - Cooldown period after trip before resuming
 * - Auto-reset when drawdown recovers
 * - Daily reset at midnight
 */

import { createLogger } from '../agent/logger.js';

const log = createLogger('CIRCUIT-BREAKER');

export type CBState = 'ARMED' | 'TRIPPED' | 'COOLING';

export interface CircuitBreakerState {
  state: CBState;
  active: boolean;    // True if TRIPPED or COOLING
  reason: string | null;
  dailyPnl: number;
  dailyPnlPct: number;
  peakCapital: number;
  currentDrawdown: number;
  drawdownPct: number;
  tripsToday: number;
  lastTripped: string | null;
  cooldownRemaining: number;  // cycles remaining
}

export class CircuitBreaker {
  private state: CBState = 'ARMED';
  private dailyPnl: number = 0;
  private peakCapital: number;
  private tripsToday: number = 0;
  private lastTripped: string | null = null;
  private reason: string | null = null;
  private dayStartCapital: number;
  private cooldownCycles: number = 0;

  private readonly maxDailyLossPct: number;
  private readonly maxDrawdownPct: number;
  private readonly cooldownLength: number;
  private readonly maxCooldownExtensions: number;
  private cooldownExtensions: number = 0;

  constructor(
    initialCapital: number,
    maxDailyLossPct: number = 0.02,
    maxDrawdownPct: number = 0.08,
    cooldownLength: number = 5,        // 5 cycles before resuming
    maxCooldownExtensions: number = 3  // max extensions before forced re-arm
  ) {
    this.peakCapital = initialCapital;
    this.dayStartCapital = initialCapital;
    this.maxDailyLossPct = maxDailyLossPct;
    this.maxDrawdownPct = maxDrawdownPct;
    this.cooldownLength = cooldownLength;
    this.maxCooldownExtensions = maxCooldownExtensions;
  }

  /**
   * Check if trading is allowed
   * Call BEFORE every trade decision
   */
  check(currentCapital: number): CircuitBreakerState {
    // Update peak when capital recovers (in ARMED or COOLING)
    // Keeping peak frozen during COOLING inflates drawdown and prevents recovery
    if (this.state !== 'TRIPPED' && currentCapital > this.peakCapital) {
      this.peakCapital = currentCapital;
    }

    // Calculate metrics — use capital delta OR realized PnL, whichever is worse
    const capitalDelta = currentCapital - this.dayStartCapital;
    const effectiveDailyPnl = Math.min(this.dailyPnl, capitalDelta);
    const dailyPnlPct = this.dayStartCapital > 0 ? effectiveDailyPnl / this.dayStartCapital : 0;
    const currentDrawdown = this.peakCapital - currentCapital;
    const drawdownPct = this.peakCapital > 0 ? currentDrawdown / this.peakCapital : 0;

    // State machine
    switch (this.state) {
      case 'ARMED':
        // Check daily loss
        if (dailyPnlPct < -this.maxDailyLossPct) {
          this.trip(`Daily loss ${(dailyPnlPct * 100).toFixed(2)}% exceeds ${(this.maxDailyLossPct * 100)}% limit`);
        }
        // Check drawdown
        else if (drawdownPct > this.maxDrawdownPct) {
          this.trip(`Drawdown ${(drawdownPct * 100).toFixed(2)}% exceeds ${(this.maxDrawdownPct * 100)}% limit`);
        }
        break;

      case 'TRIPPED':
        // Transition to cooling after trip
        this.state = 'COOLING';
        this.cooldownCycles = this.cooldownLength;
        log.info(`Entering cooldown (${this.cooldownLength} cycles)`);
        break;

      case 'COOLING':
        this.cooldownCycles--;
        if (this.cooldownCycles <= 0) {
          // Check if conditions have improved
          if (dailyPnlPct >= -this.maxDailyLossPct && drawdownPct <= this.maxDrawdownPct) {
            this.state = 'ARMED';
            this.reason = null;
            this.cooldownExtensions = 0;
            log.info('Cooldown complete — trading resumed');
          } else if (this.cooldownExtensions >= this.maxCooldownExtensions) {
            // Force re-arm after max extensions to prevent deadlock:
            // system can't recover capital without trading, can't trade
            // without recovering capital.
            this.state = 'ARMED';
            this.reason = null;
            this.cooldownExtensions = 0;
            log.warn(`Cooldown extended ${this.maxCooldownExtensions} times — force re-arming to allow recovery trades`);
          } else {
            // Still breached — extend cooldown, but track extensions
            this.cooldownCycles = 1;
            this.cooldownExtensions++;
            log.warn(`Cooldown expired but limits still breached — extension ${this.cooldownExtensions}/${this.maxCooldownExtensions}`);
          }
        }
        break;
    }

    return {
      state: this.state,
      active: this.state !== 'ARMED',
      reason: this.reason,
      dailyPnl: effectiveDailyPnl,
      dailyPnlPct,
      peakCapital: this.peakCapital,
      currentDrawdown,
      drawdownPct,
      tripsToday: this.tripsToday,
      lastTripped: this.lastTripped,
      cooldownRemaining: this.cooldownCycles,
    };
  }

  /** Record a realized trade PnL (only source of daily PnL tracking) */
  recordTradePnl(pnl: number): void {
    this.dailyPnl += pnl;
  }

  private trip(reason: string): void {
    this.state = 'TRIPPED';
    this.reason = reason;
    this.tripsToday++;
    this.lastTripped = new Date().toISOString();
    log.warn(`TRIPPED: ${reason}`);
  }

  /** Reset for new trading day */
  resetDaily(currentCapital: number): void {
    this.dayStartCapital = currentCapital;
    this.peakCapital = Math.max(this.peakCapital, currentCapital);
    this.dailyPnl = 0;
    this.tripsToday = 0;
    this.state = 'ARMED';
    this.reason = null;
    this.cooldownCycles = 0;
    this.cooldownExtensions = 0;
    log.info('Daily reset complete', { capital: currentCapital });
  }

  /** Force reset (manual override) */
  forceReset(): void {
    this.state = 'ARMED';
    this.reason = null;
    this.cooldownCycles = 0;
    this.cooldownExtensions = 0;
    log.warn('Force reset triggered');
  }

  isActive(): boolean {
    return this.state !== 'ARMED';
  }
}
