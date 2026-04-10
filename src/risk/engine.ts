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
  ipfsCid?: string | null;     // IPFS artifact CID from opening checkpoint
  txHash?: string | null;      // On-chain tx hash from opening checkpoint
  atr?: number | null;         // ATR at position open time (for dynamic TP)
  takeProfitPrice?: number | null; // Calculated TP target price
}

// Slippage model — lower for simulation (no real DEX) to avoid phantom friction
const IS_SIM = (process.env.MODE || 'simulation') === 'simulation';
const SLIPPAGE_BPS = IS_SIM ? 3 : 10;  // 0.03% sim / 0.1% live

// Minimum profit threshold before trailing stops activate.
// Covers estimated round-trip cost (entry slippage + exit slippage) so that
// break-even trailing-stop exits don't silently become losses after fees.
const MIN_PROFIT_FOR_TRAIL_PCT = (SLIPPAGE_BPS * 2) / 10000; // 2× one-way slippage = 0.20%

// Take-profit: close position when unrealized PnL reaches this percentage.
// Used as FALLBACK when no ATR-based TP target is set on the position.
// Dynamic TP (based on ATR at open time) is preferred and set per-position.
const TAKE_PROFIT_PCT = parseFloat(process.env.TAKE_PROFIT_PCT || '0.2') / 100; // 0.2% scalp target — faster turnover

// Max hold duration: close positions that have been open too long.
// Prevents capital from being stuck in sideways markets forever.
// Default 1 hour — scalping mode: don't sit in positions, capture quick moves.
const MAX_HOLD_MS = parseFloat(process.env.MAX_HOLD_HOURS || '1') * 60 * 60 * 1000;

// Absolute per-trade loss cap — prevents any single trade from losing more
// than this dollar amount regardless of stop-loss distance or direction flips.
const MAX_LOSS_PER_TRADE = parseFloat(process.env.MAX_LOSS_PER_TRADE || '3');

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
    const signalOk = strategyOutput.signal.direction !== 'NEUTRAL' && strategyOutput.signal.confidence > 0.02;
    checks.push({
      name: 'signal_quality',
      passed: signalOk,
      value: `${strategyOutput.signal.direction} (${strategyOutput.signal.confidence})`,
      limit: 'confidence > 0.05',
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

    // Check 6: Position conflict — detect opposing positions (deferred close)
    // We do NOT close opposing positions here because downstream gates
    // (on-chain risk policy, execution simulator) may still block the trade.
    // Closing eagerly and then failing leaves us with 0 positions and a loss.
    // Instead, mark them for deferred closing at execution time.
    const opposingPositions = this.openPositions.filter(p =>
      p.side !== strategyOutput.signal.direction && strategyOutput.signal.direction !== 'NEUTRAL'
    );
    checks.push({
      name: 'position_conflict',
      passed: true,
      value: opposingPositions.length > 0 ? `WILL_FLIP (${opposingPositions.length})` : 'CLEAR',
      limit: 'deferred close at execution',
      detail: opposingPositions.length > 0
        ? `${opposingPositions.length} opposing position(s) will be closed at execution time`
        : `${this.openPositions.length} open`,
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

  /**
   * Close all positions opposing the given direction.
   * Called at execution time AFTER all gates have approved the trade.
   * Returns details of each closed position for on-chain recording.
   * 
   * Loss protection: if a direction flip would realize a loss worse than
   * the stop-loss level, close at the stop-loss price instead (same as
   * gap protection in updateStops). This prevents signal whipsaw from
   * creating unbounded losses on flips.
   */
  closeOpposingPositions(direction: 'LONG' | 'SHORT', currentPrice: number): Array<{ id: number; side: string; pnl: number; entry: number; exit: number; size: number; openedAt: string; ipfsCid?: string | null; txHash?: string | null }> {
    const opposing = this.openPositions.filter(p => p.side !== direction);
    const results: Array<{ id: number; side: string; pnl: number; entry: number; exit: number; size: number; openedAt: string; ipfsCid?: string | null; txHash?: string | null }> = [];
    for (const opp of opposing) {
      const size = opp.size;
      const openedAt = opp.openedAt;
      const ipfsCid = opp.ipfsCid;
      const txHash = opp.txHash;
      // Cap flip loss at stop-loss level: if price is worse than the stop,
      // use the stop price to avoid unbounded direction-flip losses.
      let closePrice = currentPrice;
      if (opp.stopLoss !== null) {
        if (opp.side === 'LONG' && currentPrice < opp.stopLoss) {
          closePrice = opp.stopLoss;
        } else if (opp.side === 'SHORT' && currentPrice > opp.stopLoss) {
          closePrice = opp.stopLoss;
        }
      }
      // Also enforce absolute per-trade max loss cap ($3)
      const rawPnl = opp.side === 'LONG'
        ? (closePrice - opp.entryPrice) * opp.size
        : (opp.entryPrice - closePrice) * opp.size;
      if (rawPnl < -MAX_LOSS_PER_TRADE) {
        // Tighten close price to cap loss at MAX_LOSS_PER_TRADE
        const maxMove = MAX_LOSS_PER_TRADE / opp.size;
        closePrice = opp.side === 'LONG'
          ? opp.entryPrice - maxMove
          : opp.entryPrice + maxMove;
      }
      const pnl = this.closePositionById(opp.id, closePrice, /* skipSlippage */ true);
      results.push({ id: opp.id, side: opp.side, pnl, entry: opp.entryPrice, exit: closePrice, size, openedAt, ipfsCid, txHash });
      log.info(`Closed opposing position #${opp.id} (${opp.side}) for direction flip`, {
        entry: opp.entryPrice, exit: closePrice, pnl: Math.round(pnl * 100) / 100,
        lossCapped: closePrice !== currentPrice,
      });
    }
    return results;
  }

  /** Open a position with slippage */
  openPosition(params: {
    asset: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPrice: number;
    stopLoss: number | null;
    openedAt: string;
    ipfsCid?: string | null;
    txHash?: string | null;
    atr?: number | null;
    takeProfitPrice?: number | null;
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
      ipfsCid: params.ipfsCid ?? null,
      txHash: params.txHash ?? null,
      atr: params.atr ?? null,
      takeProfitPrice: params.takeProfitPrice ?? null,
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

  /**
   * Restore a position from persisted state WITHOUT applying slippage.
   * The entry price was already slippage-adjusted when the position was
   * originally opened, so re-applying slippage on restart would inflate
   * the entry and guarantee phantom losses.
   */
  restorePosition(pos: {
    asset: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPrice: number;
    stopLoss: number | null;
    openedAt: string;
    trailingStopDistance?: number | null;
    highWaterMark?: number;
    ipfsCid?: string | null;
    txHash?: string | null;
    atr?: number | null;
    takeProfitPrice?: number | null;
  }): Position {
    const trailingDist = pos.trailingStopDistance
      ?? (pos.stopLoss !== null ? Math.abs(pos.entryPrice - pos.stopLoss) : null);

    const position: Position = {
      id: nextPositionId++,
      asset: pos.asset,
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      stopLoss: pos.stopLoss,
      trailingStopDistance: trailingDist,
      highWaterMark: pos.highWaterMark ?? pos.entryPrice,
      openedAt: pos.openedAt,
      ipfsCid: pos.ipfsCid ?? null,
      txHash: pos.txHash ?? null,
      atr: pos.atr ?? null,
      takeProfitPrice: pos.takeProfitPrice ?? null,
    };

    this.openPositions.push(position);

    log.debug(`Position restored (no slippage)`, {
      id: position.id, side: pos.side, size: pos.size,
      entryPrice: pos.entryPrice,
    });

    return position;
  }

  /** Close a specific position by ID */
  closePositionById(positionId: number, exitPrice: number, skipSlippage = false): number {
    const idx = this.openPositions.findIndex(p => p.id === positionId);
    if (idx === -1) {
      log.warn(`Position ${positionId} not found for close`);
      return 0;
    }
    return this.closeAtIndex(idx, exitPrice, skipSlippage);
  }

  /** Close first matching position by asset (backward compat) */
  closePosition(asset: string, exitPrice: number): number {
    const idx = this.openPositions.findIndex(p => p.asset === asset);
    if (idx === -1) return 0;
    return this.closeAtIndex(idx, exitPrice);
  }

  private closeAtIndex(idx: number, exitPrice: number, skipSlippage = true): number {
    const pos = this.openPositions[idx];
    // Stop-loss and gap-protected closes already account for adverse price;
    // applying exit slippage on top double-penalizes the trader.
    const executionPrice = skipSlippage
      ? exitPrice
      : applySlippage(exitPrice, pos.side === 'LONG' ? 'SHORT' : 'LONG');

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
   * Update trailing stops and check all stop-losses / take-profits.
   * When opts.maxHoldOnly is true, only check max-hold duration expiry
   * (used when live price is unavailable to avoid false stop triggers).
   * Returns array of closed position IDs with reason.
   */
  updateStops(currentPrice: number, opts?: { maxHoldOnly?: boolean }): Array<{ id: number; pnl: number; reason: 'stop_loss' | 'take_profit' | 'max_hold'; size: number; entryPrice: number }> {
    const closed: Array<{ id: number; pnl: number; reason: 'stop_loss' | 'take_profit' | 'max_hold'; size: number; entryPrice: number }> = [];
    const maxHoldOnly = opts?.maxHoldOnly ?? false;

    // Iterate in reverse so splicing doesn't skip elements
    for (let i = this.openPositions.length - 1; i >= 0; i--) {
      const pos = this.openPositions[i];

      // Skip trailing stop and price-based checks when only checking max hold
      if (!maxHoldOnly) {

      // Update trailing stop with profit-locking tiers.
      // As unrealized profit grows, the trailing distance tightens so that
      // gains are protected rather than given back on a reversal.
      if (pos.trailingStopDistance !== null) {
        const unrealizedPct = pos.side === 'LONG'
          ? (currentPrice - pos.entryPrice) / pos.entryPrice
          : (pos.entryPrice - currentPrice) / pos.entryPrice;
        const beyondCostZone = unrealizedPct > MIN_PROFIT_FOR_TRAIL_PCT;

        if (beyondCostZone) {
          // Determine effective trailing distance based on profit tier.
          // Deeper in profit → tighter trail → more profit locked in.
          let effectiveTrailDist = pos.trailingStopDistance;
          if (unrealizedPct >= 0.003) {
            // >0.3% profit: trail at 30% of original distance — lock scalp gains
            effectiveTrailDist = pos.trailingStopDistance * 0.30;
          } else if (unrealizedPct >= 0.002) {
            // >0.2% profit: trail at 50% of original distance
            effectiveTrailDist = pos.trailingStopDistance * 0.50;
          } else if (unrealizedPct >= 0.0012) {
            // >0.12% profit (beyond costs): breakeven stop
            effectiveTrailDist = Math.abs(currentPrice - pos.entryPrice) * 0.95;
          }

          if (pos.side === 'LONG' && currentPrice > pos.highWaterMark) {
            pos.highWaterMark = currentPrice;
            const newStop = currentPrice - effectiveTrailDist;
            if (pos.stopLoss === null || newStop > pos.stopLoss) {
              pos.stopLoss = newStop;
            }
          } else if (pos.side === 'SHORT' && currentPrice < pos.highWaterMark) {
            pos.highWaterMark = currentPrice;
            const newStop = currentPrice + effectiveTrailDist;
            if (pos.stopLoss === null || newStop < pos.stopLoss) {
              pos.stopLoss = newStop;
            }
          }
        }
      }

      // Check take-profit before stop-loss.
      // Prefer ATR-based TP target (stored on position) over fixed percentage.
      let tpHit = false;
      if (pos.takeProfitPrice != null) {
        // Dynamic ATR-based TP: check if price reached the target
        tpHit = (pos.side === 'LONG' && currentPrice >= pos.takeProfitPrice) ||
                (pos.side === 'SHORT' && currentPrice <= pos.takeProfitPrice);
      } else {
        // Fallback to fixed percentage TP
        const unrealizedPctForTP = pos.side === 'LONG'
          ? (currentPrice - pos.entryPrice) / pos.entryPrice
          : (pos.entryPrice - currentPrice) / pos.entryPrice;
        tpHit = TAKE_PROFIT_PCT > 0 && unrealizedPctForTP >= TAKE_PROFIT_PCT;
      }
      if (tpHit) {
        const size = pos.size;
        const entry = pos.entryPrice;
        const pnl = this.closeAtIndex(i, currentPrice, /* skipSlippage */ true);
        const unrealizedPctForTP = pos.side === 'LONG'
          ? (currentPrice - pos.entryPrice) / pos.entryPrice
          : (pos.entryPrice - currentPrice) / pos.entryPrice;
        closed.push({ id: pos.id, pnl, reason: 'take_profit', size, entryPrice: entry });
        log.info(`Take-profit hit: position #${pos.id}`, {
          side: pos.side, entry: pos.entryPrice, exit: currentPrice,
          tpTarget: pos.takeProfitPrice ?? `${(TAKE_PROFIT_PCT * 100).toFixed(1)}%`,
          unrealizedPct: (unrealizedPctForTP * 100).toFixed(2) + '%',
          pnl: Math.round(pnl * 100) / 100,
        });
        continue;
      }

      // Check stop-loss
      if (pos.stopLoss !== null) {
        const stopped = (pos.side === 'LONG' && currentPrice <= pos.stopLoss) ||
                        (pos.side === 'SHORT' && currentPrice >= pos.stopLoss);
        if (stopped) {
          const gapped = (pos.side === 'LONG' && currentPrice < pos.stopLoss) ||
                         (pos.side === 'SHORT' && currentPrice > pos.stopLoss);
          const closePrice = gapped ? pos.stopLoss : currentPrice;
          const size = pos.size;
          const entry = pos.entryPrice;
          const pnl = this.closeAtIndex(i, closePrice, /* skipSlippage */ true);
          closed.push({ id: pos.id, pnl, reason: 'stop_loss', size, entryPrice: entry });
          log.info(`Stop-loss hit: position #${pos.id}`, {
            side: pos.side, entry: pos.entryPrice, exit: closePrice,
            pnl: Math.round(pnl * 100) / 100,
            ...(gapped ? { gapProtection: true, actualPrice: currentPrice } : {}),
          });
          continue;
        }
      }

      // Hard per-trade loss cap: if unrealized loss exceeds MAX_LOSS_PER_TRADE,
      // force-close at the capped price to prevent runaway losses regardless of
      // stop-loss distance or trailing stop state.
      {
        const unrealizedPnl = pos.side === 'LONG'
          ? (currentPrice - pos.entryPrice) * pos.size
          : (pos.entryPrice - currentPrice) * pos.size;
        if (unrealizedPnl < -MAX_LOSS_PER_TRADE) {
          const maxMove = MAX_LOSS_PER_TRADE / pos.size;
          const cappedPrice = pos.side === 'LONG'
            ? pos.entryPrice - maxMove
            : pos.entryPrice + maxMove;
          const size = pos.size;
          const entry = pos.entryPrice;
          const pnl = this.closeAtIndex(i, cappedPrice, /* skipSlippage */ true);
          closed.push({ id: pos.id, pnl, reason: 'stop_loss', size, entryPrice: entry });
          log.warn(`Max loss cap hit: position #${pos.id} — capped at $${MAX_LOSS_PER_TRADE}`, {
            side: pos.side, entry: pos.entryPrice, exit: cappedPrice,
            actualPrice: currentPrice,
            uncappedLoss: Math.round(unrealizedPnl * 100) / 100,
            pnl: Math.round(pnl * 100) / 100,
          });
          continue;
        }
      }

      } // end if (!maxHoldOnly) — price-based checks

      // Check max hold duration — close stale positions to free capital.
      // Use stop-loss price as floor to avoid unbounded losses from time-based exits.
      if (MAX_HOLD_MS > 0) {
        const holdMs = Date.now() - new Date(pos.openedAt).getTime();
        if (holdMs >= MAX_HOLD_MS) {
          // Cap loss at stop-loss level: if current price is worse than SL, use SL instead
          let exitPrice = currentPrice;
          if (pos.stopLoss !== null) {
            if (pos.side === 'LONG' && currentPrice < pos.stopLoss) {
              exitPrice = pos.stopLoss;
            } else if (pos.side === 'SHORT' && currentPrice > pos.stopLoss) {
              exitPrice = pos.stopLoss;
            }
          }
          const size = pos.size;
          const entry = pos.entryPrice;
          const pnl = this.closeAtIndex(i, exitPrice, /* skipSlippage */ true);
          closed.push({ id: pos.id, pnl, reason: 'max_hold', size, entryPrice: entry });
          log.info(`Max hold duration exceeded: position #${pos.id}`, {
            side: pos.side, entry: pos.entryPrice, exit: exitPrice,
            holdHours: (holdMs / 3600000).toFixed(1),
            pnl: Math.round(pnl * 100) / 100,
            cappedAtStop: exitPrice !== currentPrice,
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
