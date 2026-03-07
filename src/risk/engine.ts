/**
 * Risk Engine — Production Grade
 * 
 * Fixes from v1:
 * - Position IDs for targeted close
 * - Unrealized PnL tracked in capital calculation
 * - Total exposure limit (not just per-position)
 * - Slippage model for realistic execution
 * - Trailing stop support
 * - No double-counting PnL in circuit breaker
 */

import { config } from '../agent/config.js';
import { CircuitBreaker, type CircuitBreakerState } from './circuit-breaker.js';
import { VolatilityTracker, type VolatilityState } from './volatility.js';
import { createLogger } from '../agent/logger.js';
import type { StrategyOutput } from '../strategy/momentum.js';

const log = createLogger('RISK');

let nextPositionId = 1;

export interface RiskCheck {
  name: string;
  passed: boolean;
  value: number | string;
  limit: number | string;
  detail: string;
}

export interface RiskDecision {
  approved: boolean;
  finalPositionSize: number;
  stopLossPrice: number | null;
  checks: RiskCheck[];
  circuitBreaker: CircuitBreakerState;
  volatility: VolatilityState;
  explanation: string;
  timestamp: string;
}

export interface Position {
  id: number;
  asset: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  stopLoss: number | null;
  trailingStopDistance: number | null;
  highWaterMark: number;       // Highest price since open (for trailing)
  openedAt: string;
}

// Slippage model
const SLIPPAGE_BPS = 10;  // 0.1% average slippage

function applySlippage(price: number, side: 'LONG' | 'SHORT'): number {
  const slip = price * (SLIPPAGE_BPS / 10000);
  return side === 'LONG' ? price + slip : price - slip;
}

export class RiskEngine {
  private circuitBreaker: CircuitBreaker;
  private volatilityTracker: VolatilityTracker;
  private baseCapital: number;           // Cash capital (excludes unrealized PnL)
  private openPositions: Position[] = [];
  private tradeHistory: Array<{ id: number; pnl: number; slippage: number; timestamp: string }> = [];

  private readonly maxExposurePct: number;  // Total portfolio exposure limit

  constructor(initialCapital: number, maxExposurePct: number = 0.30) {
    this.baseCapital = initialCapital;
    this.maxExposurePct = maxExposurePct;
    this.circuitBreaker = new CircuitBreaker(
      initialCapital,
      config.maxDailyLossPct,
      config.maxDrawdownPct,
      5  // cooldown cycles
    );
    this.volatilityTracker = new VolatilityTracker(config.strategy.baselineVolatility);
  }

  /**
   * Get effective capital (base + unrealized PnL)
   */
  getCapital(): number {
    return this.baseCapital;
  }

  getEffectiveCapital(currentPrice: number): number {
    return this.baseCapital + this.getUnrealizedPnl(currentPrice);
  }

  getUnrealizedPnl(currentPrice: number): number {
    return this.openPositions.reduce((sum, pos) => {
      const pnl = pos.side === 'LONG'
        ? (currentPrice - pos.entryPrice) * pos.size
        : (pos.entryPrice - currentPrice) * pos.size;
      return sum + pnl;
    }, 0);
  }

  getCurrentExposure(currentPrice: number): number {
    return this.openPositions.reduce((sum, pos) => sum + pos.size * currentPrice, 0);
  }

  /**
   * Evaluate a strategy output — 6 risk checks
   */
  evaluate(strategyOutput: StrategyOutput): RiskDecision {
    const timestamp = new Date().toISOString();
    const checks: RiskCheck[] = [];
    const currentPrice = strategyOutput.currentPrice;

    // Update volatility
    if (strategyOutput.indicators.volatility !== null) {
      this.volatilityTracker.update(strategyOutput.indicators.volatility);
    }
    const volState = this.volatilityTracker.getState();

    // Effective capital includes unrealized PnL
    const effectiveCap = this.getEffectiveCapital(currentPrice);

    // Check 1: Circuit breaker
    const cbState = this.circuitBreaker.check(effectiveCap);
    checks.push({
      name: 'circuit_breaker',
      passed: !cbState.active,
      value: cbState.active ? `${cbState.state}` : 'ARMED',
      limit: 'ARMED',
      detail: cbState.active
        ? `${cbState.reason} (cooldown: ${cbState.cooldownRemaining})`
        : `Daily: ${(cbState.dailyPnlPct * 100).toFixed(2)}%, DD: ${(cbState.drawdownPct * 100).toFixed(2)}%`,
    });

    // Check 2: Signal quality
    const signalOk = strategyOutput.signal.direction !== 'NEUTRAL' && strategyOutput.signal.confidence > 0.1;
    checks.push({
      name: 'signal_quality',
      passed: signalOk,
      value: `${strategyOutput.signal.direction} (${strategyOutput.signal.confidence})`,
      limit: 'confidence > 0.1',
      detail: strategyOutput.signal.reason,
    });

    // Check 3: Per-position size
    const proposedValueUsd = strategyOutput.positionSize * currentPrice;
    const positionPct = this.baseCapital > 0 ? proposedValueUsd / this.baseCapital : 0;
    const positionOk = positionPct <= config.maxPositionPct;
    checks.push({
      name: 'max_position_size',
      passed: positionOk,
      value: `${(positionPct * 100).toFixed(2)}%`,
      limit: `${(config.maxPositionPct * 100).toFixed(1)}%`,
      detail: positionOk ? 'Within limit' : 'Will be capped',
    });

    // Check 4: Total exposure
    const currentExposure = this.getCurrentExposure(currentPrice);
    const newExposure = currentExposure + proposedValueUsd;
    const exposurePct = this.baseCapital > 0 ? newExposure / this.baseCapital : 0;
    const exposureOk = exposurePct <= this.maxExposurePct;
    checks.push({
      name: 'total_exposure',
      passed: exposureOk,
      value: `${(exposurePct * 100).toFixed(1)}%`,
      limit: `${(this.maxExposurePct * 100).toFixed(0)}%`,
      detail: exposureOk
        ? `Exposure: $${currentExposure.toFixed(0)} + $${proposedValueUsd.toFixed(0)} = $${newExposure.toFixed(0)}`
        : `Would exceed ${(this.maxExposurePct * 100)}% total exposure`,
    });

    // Check 5: Volatility regime
    const volOk = volState.regime !== 'extreme';
    checks.push({
      name: 'volatility_regime',
      passed: volOk,
      value: `${volState.regime} (${volState.ratio.toFixed(2)}x)`,
      limit: 'not extreme (< 2.0x)',
      detail: volOk ? 'Acceptable' : 'Extreme — rejected',
    });

    // Check 6: Position conflict
    const hasConflict = this.openPositions.some(p =>
      p.side !== strategyOutput.signal.direction && strategyOutput.signal.direction !== 'NEUTRAL'
    );
    checks.push({
      name: 'position_conflict',
      passed: !hasConflict,
      value: hasConflict ? 'CONFLICT' : 'CLEAR',
      limit: 'no opposing',
      detail: hasConflict ? 'Close opposing position first' : `${this.openPositions.length} open`,
    });

    // Decision
    const allPassed = checks.every(c => c.passed);
    let finalPositionSize = allPassed ? strategyOutput.positionSize : 0;

    // Cap per-position
    if (finalPositionSize > 0) {
      const maxUnits = (this.baseCapital * config.maxPositionPct) / currentPrice;
      finalPositionSize = Math.min(finalPositionSize, maxUnits);

      // Also cap by remaining exposure headroom
      const headroom = (this.baseCapital * this.maxExposurePct) - currentExposure;
      if (headroom > 0) {
        const maxByExposure = headroom / currentPrice;
        finalPositionSize = Math.min(finalPositionSize, maxByExposure);
      }
    }

    // Explanation
    const failedChecks = checks.filter(c => !c.passed);
    let explanation: string;
    if (allPassed && finalPositionSize > 0) {
      explanation = `APPROVED: ${strategyOutput.signal.name}. ${strategyOutput.signal.reason} Vol ${volState.ratio.toFixed(2)}x. ${checks.length} checks passed.`;
    } else if (strategyOutput.signal.direction === 'NEUTRAL') {
      explanation = 'No trade: NEUTRAL signal.';
    } else {
      explanation = `REJECTED: ${failedChecks.map(c => c.name).join(', ')}. ${failedChecks.map(c => c.detail).join('. ')}`;
    }

    return {
      approved: allPassed && finalPositionSize > 0,
      finalPositionSize,
      stopLossPrice: strategyOutput.stopLossPrice,
      checks,
      circuitBreaker: cbState,
      volatility: volState,
      explanation,
      timestamp,
    };
  }

  /** Open a position with slippage */
  openPosition(params: {
    asset: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPrice: number;
    stopLoss: number | null;
    openedAt: string;
  }): Position {
    const executionPrice = applySlippage(params.entryPrice, params.side);
    const trailingDist = params.stopLoss !== null ? Math.abs(executionPrice - params.stopLoss) : null;

    const position: Position = {
      id: nextPositionId++,
      asset: params.asset,
      side: params.side,
      size: params.size,
      entryPrice: executionPrice,
      stopLoss: params.stopLoss,
      trailingStopDistance: trailingDist,
      highWaterMark: executionPrice,
      openedAt: params.openedAt,
    };

    this.openPositions.push(position);

    const slippageUsd = Math.abs(executionPrice - params.entryPrice) * params.size;
    log.debug(`Position opened`, {
      id: position.id, side: params.side, size: params.size,
      requested: params.entryPrice, executed: executionPrice,
      slippage: `$${slippageUsd.toFixed(4)}`,
    });

    return position;
  }

  /** Close a specific position by ID */
  closePositionById(positionId: number, exitPrice: number): number {
    const idx = this.openPositions.findIndex(p => p.id === positionId);
    if (idx === -1) {
      log.warn(`Position ${positionId} not found for close`);
      return 0;
    }
    return this.closeAtIndex(idx, exitPrice);
  }

  /** Close first matching position by asset (backward compat) */
  closePosition(asset: string, exitPrice: number): number {
    const idx = this.openPositions.findIndex(p => p.asset === asset);
    if (idx === -1) return 0;
    return this.closeAtIndex(idx, exitPrice);
  }

  private closeAtIndex(idx: number, exitPrice: number): number {
    const pos = this.openPositions[idx];
    const executionPrice = applySlippage(exitPrice, pos.side === 'LONG' ? 'SHORT' : 'LONG');

    const pnl = pos.side === 'LONG'
      ? (executionPrice - pos.entryPrice) * pos.size
      : (pos.entryPrice - executionPrice) * pos.size;

    const slippage = Math.abs(exitPrice - executionPrice) * pos.size;

    this.baseCapital += pnl;
    this.circuitBreaker.recordTradePnl(pnl);
    this.tradeHistory.push({
      id: pos.id,
      pnl,
      slippage,
      timestamp: new Date().toISOString(),
    });
    this.openPositions.splice(idx, 1);

    return pnl;
  }

  /**
   * Update trailing stops and check all stop-losses
   * Returns array of closed position IDs
   */
  updateStops(currentPrice: number): Array<{ id: number; pnl: number }> {
    const closed: Array<{ id: number; pnl: number }> = [];

    // Iterate in reverse so splicing doesn't skip elements
    for (let i = this.openPositions.length - 1; i >= 0; i--) {
      const pos = this.openPositions[i];

      // Update trailing stop
      if (pos.trailingStopDistance !== null) {
        if (pos.side === 'LONG' && currentPrice > pos.highWaterMark) {
          pos.highWaterMark = currentPrice;
          pos.stopLoss = currentPrice - pos.trailingStopDistance;
        } else if (pos.side === 'SHORT' && currentPrice < pos.highWaterMark) {
          pos.highWaterMark = currentPrice;
          pos.stopLoss = currentPrice + pos.trailingStopDistance;
        }
      }

      // Check stop-loss
      if (pos.stopLoss !== null) {
        const stopped = (pos.side === 'LONG' && currentPrice <= pos.stopLoss) ||
                        (pos.side === 'SHORT' && currentPrice >= pos.stopLoss);
        if (stopped) {
          const pnl = this.closeAtIndex(i, currentPrice);
          closed.push({ id: pos.id, pnl });
          log.info(`Stop-loss hit: position #${pos.id}`, {
            side: pos.side, entry: pos.entryPrice, exit: currentPrice,
            pnl: Math.round(pnl * 100) / 100,
          });
        }
      }
    }

    return closed;
  }

  /** Get status for dashboard/MCP */
  getStatus() {
    return {
      capital: this.baseCapital,
      openPositions: this.openPositions.map(p => ({
        ...p,
      })),
      circuitBreaker: this.circuitBreaker.check(this.baseCapital),
      volatility: this.volatilityTracker.getState(),
      totalTrades: this.tradeHistory.length,
      recentPnl: this.tradeHistory.slice(-10),
      maxExposurePct: this.maxExposurePct,
    };
  }

  getOpenPositions(): Position[] {
    return [...this.openPositions];
  }

  /** Reset (for daily or testing) */
  reset(capital: number): void {
    this.baseCapital = capital;
    this.openPositions = [];
    this.tradeHistory = [];
    this.circuitBreaker = new CircuitBreaker(capital, config.maxDailyLossPct, config.maxDrawdownPct, 5);
    this.volatilityTracker.reset();
    nextPositionId = 1;
  }

  /** Daily reset — keep positions, reset circuit breaker */
  resetDaily(): void {
    this.circuitBreaker.resetDaily(this.baseCapital);
  }
}
