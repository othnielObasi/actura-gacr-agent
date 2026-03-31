/**
 * Persistent Trade Log
 * Records every closed trade to disk so history survives restarts.
 * Append-only JSONL format — one JSON object per line.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const log = createLogger('TRADE-LOG');
const STATE_DIR = join(process.cwd(), '.actura');
const TRADE_LOG_FILE = join(STATE_DIR, 'trades.jsonl');

export interface ClosedTrade {
  id: number;
  asset: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  stopHit: boolean;
  reason: 'stop_loss' | 'take_profit' | 'max_hold' | 'direction_flip' | 'reconciliation' | 'manual';
  openedAt: string;
  closedAt: string;
  durationMs: number;
  ipfsCid?: string | null;
  txHash?: string | null;
}

/**
 * Append a closed trade to the persistent log
 */
export function recordClosedTrade(trade: ClosedTrade): void {
  try {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
    const line = JSON.stringify(trade) + '\n';
    appendFileSync(TRADE_LOG_FILE, line, 'utf-8');
    log.info('Trade recorded', {
      id: trade.id, side: trade.side, pnl: Math.round(trade.pnl * 100) / 100,
      reason: trade.reason,
    });
  } catch (error) {
    log.error('Failed to record trade', { error: String(error) });
  }
}

/**
 * Load all closed trades from disk
 */
export function loadClosedTrades(): ClosedTrade[] {
  try {
    if (!existsSync(TRADE_LOG_FILE)) return [];
    const data = readFileSync(TRADE_LOG_FILE, 'utf-8').trim();
    if (!data) return [];
    return data.split('\n').map(line => JSON.parse(line) as ClosedTrade);
  } catch (error) {
    log.error('Failed to load trade log', { error: String(error) });
    return [];
  }
}

/**
 * Get recent closed trades (most recent first)
 */
export function getRecentTrades(limit: number = 50): ClosedTrade[] {
  const all = loadClosedTrades();
  return all.slice(-limit).reverse();
}

/**
 * Get trade statistics
 */
export function getTradeStats(): {
  totalTrades: number;
  totalPnl: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  avgDurationMs: number;
} {
  const trades = loadClosedTrades();
  if (trades.length === 0) {
    return {
      totalTrades: 0, totalPnl: 0, wins: 0, losses: 0, winRate: 0,
      avgWin: 0, avgLoss: 0, bestTrade: 0, worstTrade: 0, avgDurationMs: 0,
    };
  }
  const wins = trades.filter(t => t.pnl >= 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgDuration = trades.reduce((s, t) => s + t.durationMs, 0) / trades.length;

  return {
    totalTrades: trades.length,
    totalPnl: Math.round(totalPnl * 100) / 100,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? Math.round((wins.length / trades.length) * 10000) / 100 : 0,
    avgWin: wins.length > 0 ? Math.round(wins.reduce((s, t) => s + t.pnl, 0) / wins.length * 100) / 100 : 0,
    avgLoss: losses.length > 0 ? Math.round(losses.reduce((s, t) => s + t.pnl, 0) / losses.length * 100) / 100 : 0,
    bestTrade: Math.round(Math.max(...trades.map(t => t.pnl)) * 100) / 100,
    worstTrade: Math.round(Math.min(...trades.map(t => t.pnl)) * 100) / 100,
    avgDurationMs: Math.round(avgDuration),
  };
}
