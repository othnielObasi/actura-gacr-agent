/**
 * State Persistence
 * Saves agent state to disk so restarts don't lose positions or history
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const log = createLogger('STATE');
const STATE_DIR = join(process.cwd(), '.actura');
const STATE_FILE = join(STATE_DIR, 'state.json');
const PRICE_HISTORY_FILE = join(STATE_DIR, 'price-history.json');

export interface PersistedState {
  capital: number;
  openPositions: Array<{
    asset: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPrice: number;
    stopLoss: number | null;
    trailingStopDistance?: number | null;
    highWaterMark?: number;
    openedAt: string;
    ipfsCid?: string | null;
    txHash?: string | null;
  }>;
  peakCapital: number;
  totalTrades: number;
  totalPnl: number;
  agentId: number | null;
  lastCycle: number;
  lastSavedAt: string;
}

/**
 * Save state to disk
 */
export function saveState(state: PersistedState): void {
  try {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }

    const data = JSON.stringify({
      ...state,
      lastSavedAt: new Date().toISOString(),
    }, null, 2);

    writeFileSync(STATE_FILE, data, 'utf-8');
    log.debug('State saved', { capital: state.capital, positions: state.openPositions.length });
  } catch (error) {
    log.error('Failed to save state', { error: String(error) });
  }
}

/**
 * Load state from disk
 */
export function loadState(): PersistedState | null {
  try {
    if (!existsSync(STATE_FILE)) {
      log.info('No saved state found — starting fresh');
      return null;
    }

    const data = readFileSync(STATE_FILE, 'utf-8');
    const state = JSON.parse(data) as PersistedState;

    log.info('State loaded', {
      capital: state.capital,
      positions: state.openPositions.length,
      lastCycle: state.lastCycle,
      savedAt: state.lastSavedAt,
    });

    return state;
  } catch (error) {
    log.error('Failed to load state — starting fresh', { error: String(error) });
    return null;
  }
}

/**
 * Delete state file (for testing or reset)
 */
export function clearState(): void {
  try {
    if (existsSync(STATE_FILE)) {
      writeFileSync(STATE_FILE, '{}', 'utf-8');
      log.info('State cleared');
    }
  } catch (error) {
    log.error('Failed to clear state', { error: String(error) });
  }
}

// ──── Price History Persistence ────

interface PersistedPriceHistory {
  prices: number[];
  highs: number[];
  lows: number[];
  timestamps: string[];
  savedAt: string;
}

/**
 * Save price history to disk so SMA50 survives restarts.
 * Called alongside state persistence.
 */
export function savePriceHistory(data: { prices: number[]; highs: number[]; lows: number[]; timestamps: string[] }): void {
  try {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
    // Keep last 200 candles (matches in-memory window)
    const slice = data.prices.length > 200 ? data.prices.length - 200 : 0;
    const payload: PersistedPriceHistory = {
      prices: data.prices.slice(slice),
      highs: data.highs.slice(slice),
      lows: data.lows.slice(slice),
      timestamps: data.timestamps.slice(slice),
      savedAt: new Date().toISOString(),
    };
    writeFileSync(PRICE_HISTORY_FILE, JSON.stringify(payload), 'utf-8');
  } catch (error) {
    log.error('Failed to save price history', { error: String(error) });
  }
}

/**
 * Load price history from disk.
 * Returns null if no history exists or data is corrupt.
 */
export function loadPriceHistory(): { prices: number[]; highs: number[]; lows: number[]; timestamps: string[] } | null {
  try {
    if (!existsSync(PRICE_HISTORY_FILE)) return null;
    const raw = readFileSync(PRICE_HISTORY_FILE, 'utf-8');
    const data = JSON.parse(raw) as PersistedPriceHistory;
    if (!Array.isArray(data.prices) || data.prices.length < 10) return null;
    log.info('Price history loaded from disk', {
      candles: data.prices.length,
      savedAt: data.savedAt,
      latestPrice: `$${data.prices[data.prices.length - 1].toFixed(2)}`,
    });
    return { prices: data.prices, highs: data.highs, lows: data.lows, timestamps: data.timestamps };
  } catch (error) {
    log.error('Failed to load price history', { error: String(error) });
    return null;
  }
}
