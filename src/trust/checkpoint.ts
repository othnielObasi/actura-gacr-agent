/**
 * Strategy Checkpoint
 * Captures the full strategy state at a point in time
 * Used for validation artifacts and replay/audit
 *
 * Every checkpoint is persisted to `.actura/checkpoints.jsonl`
 * (append-only JSONL) so the audit trail survives restarts.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { MarketData, StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision } from '../risk/engine.js';
import type { ValidationArtifact } from './artifact-emitter.js';
import type { IpfsUploadResult } from './ipfs.js';

const STATE_DIR = join(process.cwd(), '.actura');
const CHECKPOINT_LOG_FILE = join(STATE_DIR, 'checkpoints.jsonl');

export interface Checkpoint {
  id: number;
  timestamp: string;
  strategyOutput: StrategyOutput;
  riskDecision: RiskDecision;
  artifact: ValidationArtifact;
  ipfs: IpfsUploadResult | null;
  onChainTxHash: string | null;
}

const checkpoints: Checkpoint[] = [];
let checkpointId = 0;

/** Append a checkpoint to disk (JSONL) */
function persistCheckpointToDisk(cp: Checkpoint): void {
  try {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
    const line = JSON.stringify({
      id: cp.id,
      timestamp: cp.timestamp,
      direction: cp.strategyOutput?.signal?.direction ?? null,
      confidence: cp.strategyOutput?.signal?.confidence ?? null,
      approved: cp.riskDecision?.approved ?? null,
      ipfsCid: cp.ipfs?.cid ?? null,
      onChainTxHash: cp.onChainTxHash,
    }) + '\n';
    appendFileSync(CHECKPOINT_LOG_FILE, line, 'utf-8');
  } catch {
    // Non-critical — in-memory checkpoint still available
  }
}

/** Store a checkpoint */
export function saveCheckpoint(
  strategyOutput: StrategyOutput,
  riskDecision: RiskDecision,
  artifact: ValidationArtifact,
  ipfs: IpfsUploadResult | null = null,
  txHash: string | null = null
): Checkpoint {
  const cp: Checkpoint = {
    id: ++checkpointId,
    timestamp: new Date().toISOString(),
    strategyOutput,
    riskDecision,
    artifact,
    ipfs,
    onChainTxHash: txHash,
  };
  checkpoints.push(cp);
  
  // Keep last 500 checkpoints in memory
  if (checkpoints.length > 500) {
    checkpoints.shift();
  }

  // Persist to disk (append-only JSONL)
  persistCheckpointToDisk(cp);
  
  return cp;
}

/** Get recent checkpoints */
export function getCheckpoints(limit: number = 20): Checkpoint[] {
  return checkpoints.slice(-limit);
}

/** Get checkpoint by ID */
export function getCheckpoint(id: number): Checkpoint | undefined {
  return checkpoints.find(c => c.id === id);
}

/** Get the last checkpoint */
export function getLastCheckpoint(): Checkpoint | undefined {
  return checkpoints[checkpoints.length - 1];
}

/** Get trade-only checkpoints (approved trades) */
export function getTradeCheckpoints(limit: number = 20): Checkpoint[] {
  return checkpoints
    .filter(c => c.riskDecision.approved)
    .slice(-limit);
}

/** Reset (for testing) */
export function resetCheckpoints(): void {
  checkpoints.length = 0;
  checkpointId = 0;
}
