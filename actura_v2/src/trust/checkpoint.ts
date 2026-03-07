/**
 * Strategy Checkpoint
 * Captures the full strategy state at a point in time
 * Used for validation artifacts and replay/audit
 */

import type { MarketData, StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision } from '../risk/engine.js';
import type { ValidationArtifact } from './artifact-emitter.js';
import type { IpfsUploadResult } from './ipfs.js';

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
