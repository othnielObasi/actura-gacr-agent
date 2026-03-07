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

export interface PersistedState {
  capital: number;
  openPositions: Array<{
    asset: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPrice: number;
    stopLoss: number | null;
    openedAt: string;
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
