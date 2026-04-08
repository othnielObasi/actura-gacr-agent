/**
 * Scheduler
 * Production-grade trading loop with:
 * - Interval-based execution (not a for-loop)
 * - Graceful shutdown on SIGINT/SIGTERM
 * - Error recovery (cycle failures don't kill the agent)
 * - Daily reset of circuit breaker
 * - Health tracking
 */

import { createLogger } from './logger.js';
import { config } from './config.js';

const log = createLogger('SCHEDULER');

export interface SchedulerState {
  running: boolean;
  cycleCount: number;
  errorCount: number;
  lastCycleAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  uptime: number;  // seconds
  consecutiveErrors: number;
}

export type CycleFunction = () => Promise<void>;
export type ShutdownHook = () => void | Promise<void>;

export class Scheduler {
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private cycleCount = 0;
  private errorCount = 0;
  private consecutiveErrors = 0;
  private lastCycleAt: string | null = null;
  private lastErrorAt: string | null = null;
  private lastError: string | null = null;
  private startedAt: number = 0;
  private shutdownHooks: ShutdownHook[] = [];
  private dailyResetTimer: ReturnType<typeof setInterval> | null = null;
  private cycleFn: CycleFunction | null = null;
  private dailyResetFn: (() => void) | null = null;

  private readonly maxConsecutiveErrors: number;
  private readonly intervalMs: number;

  constructor(intervalMs?: number, maxConsecutiveErrors: number = 10) {
    this.intervalMs = intervalMs || config.tradingIntervalMs;
    this.maxConsecutiveErrors = maxConsecutiveErrors;
  }

  private signalHandlersRegistered = false;

  /**
   * Start the scheduler
   */
  start(cycleFn: CycleFunction, dailyResetFn?: () => void): void {
    if (this.running) {
      log.warn('Scheduler already running');
      return;
    }

    this.cycleFn = cycleFn;
    this.dailyResetFn = dailyResetFn || null;
    this.running = true;
    this.startedAt = Date.now();

    // Register shutdown handlers (only once to prevent duplicate stacking)
    if (!this.signalHandlersRegistered) {
      this.signalHandlersRegistered = true;
      process.on('SIGINT', () => this.shutdown('SIGINT'));
      process.on('SIGTERM', () => this.shutdown('SIGTERM'));
      process.on('uncaughtException', (err) => {
        log.fatal('Uncaught exception', { error: err.message, stack: err.stack });
        // RPC / network errors should not kill the agent — only truly fatal errors should
        const msg = err.message || '';
        const isRpcError = msg.includes('SERVER_ERROR') || msg.includes('UNKNOWN_ERROR')
          || msg.includes('NETWORK_ERROR') || msg.includes('TIMEOUT')
          || msg.includes('could not coalesce') || msg.includes('server response')
          || msg.includes('missing response') || msg.includes('batch');
        if (isRpcError) {
          log.warn('RPC/network error caught — continuing (not shutting down)');
          this.consecutiveErrors++;
        } else {
          this.shutdown('uncaughtException');
        }
      });
      process.on('unhandledRejection', (reason) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        log.warn('Unhandled rejection (suppressed)', { error: msg.slice(0, 200) });
      });
    }

    log.info(`Scheduler started (interval: ${this.intervalMs}ms)`);

    // Run first cycle immediately
    this.executeCycle();

    // Then run on interval
    this.interval = setInterval(() => this.executeCycle(), this.intervalMs);

    // Daily reset — runs at midnight UTC
    this.scheduleDailyReset();
  }

  /**
   * Execute one trading cycle with error handling
   */
  private async executeCycle(): Promise<void> {
    if (!this.running || !this.cycleFn) return;

    try {
      await this.cycleFn();
      this.cycleCount++;
      this.consecutiveErrors = 0;
      this.lastCycleAt = new Date().toISOString();
    } catch (error) {
      this.errorCount++;
      this.consecutiveErrors++;
      this.lastErrorAt = new Date().toISOString();
      this.lastError = error instanceof Error ? error.message : String(error);

      log.error(`Cycle ${this.cycleCount + 1} failed (${this.consecutiveErrors} consecutive)`, {
        error: this.lastError,
      });

      // Circuit breaker: too many consecutive errors → pause
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        log.fatal(`${this.maxConsecutiveErrors} consecutive errors — pausing scheduler for 60s`);
        this.pause();
        setTimeout(() => {
          log.info('Resuming scheduler after error cooldown');
          this.consecutiveErrors = 0;
          this.resume();
        }, 60000);
      }
    }
  }

  /**
   * Schedule daily reset at midnight UTC
   */
  private scheduleDailyReset(): void {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setUTCHours(24, 0, 0, 0);
    const msUntilMidnight = nextMidnight.getTime() - now.getTime();

    setTimeout(() => {
      this.doDailyReset();
      // Then repeat every 24h
      this.dailyResetTimer = setInterval(() => this.doDailyReset(), 86400000);
    }, msUntilMidnight);

    log.info(`Daily reset scheduled in ${Math.round(msUntilMidnight / 60000)} minutes`);
  }

  private doDailyReset(): void {
    log.info('Daily reset triggered');
    if (this.dailyResetFn) {
      try {
        this.dailyResetFn();
      } catch (e) {
        log.error('Daily reset failed', { error: String(e) });
      }
    }
  }

  /** Pause without full shutdown */
  pause(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    log.info('Scheduler paused');
  }

  /** Resume after pause */
  resume(): void {
    if (!this.running || this.interval) return;
    this.interval = setInterval(() => this.executeCycle(), this.intervalMs);
    log.info('Scheduler resumed');
  }

  /**
   * Graceful shutdown
   */
  async shutdown(reason: string = 'manual'): Promise<void> {
    if (!this.running) return;
    this.running = false;

    log.info(`Shutting down (reason: ${reason})`);

    // Stop timers
    if (this.interval) clearInterval(this.interval);
    if (this.dailyResetTimer) clearInterval(this.dailyResetTimer);

    // Run shutdown hooks
    for (const hook of this.shutdownHooks) {
      try {
        await hook();
      } catch (e) {
        log.error('Shutdown hook failed', { error: String(e) });
      }
    }

    log.info(`Shutdown complete. Ran ${this.cycleCount} cycles, ${this.errorCount} errors.`);

    // If called from signal handler, exit cleanly
    if (reason === 'SIGINT' || reason === 'SIGTERM') {
      process.exit(0);
    }
  }

  /** Register a shutdown hook */
  onShutdown(hook: ShutdownHook): void {
    this.shutdownHooks.push(hook);
  }

  /** Get scheduler state */
  getState(): SchedulerState {
    return {
      running: this.running,
      cycleCount: this.cycleCount,
      errorCount: this.errorCount,
      lastCycleAt: this.lastCycleAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      uptime: this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  getCycleCount(): number {
    return this.cycleCount;
  }
}
