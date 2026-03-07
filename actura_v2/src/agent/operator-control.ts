/**
 * Operator Control Layer
 * Human oversight controls for manual pause / emergency stop.
 */

export type OperatorMode = 'normal' | 'paused' | 'emergency_stop';
export type OperatorActionType = 'pause' | 'resume' | 'emergency_stop';

export interface OperatorActionReceipt {
  id: string;
  timestamp: string;
  action: OperatorActionType;
  reason: string;
  actor: string;
  affectedAgent: string;
  modeAfter: OperatorMode;
}

export interface OperatorControlState {
  mode: OperatorMode;
  canTrade: boolean;
  lastUpdatedAt: string | null;
  lastReason: string | null;
}

const state: OperatorControlState = {
  mode: 'normal',
  canTrade: true,
  lastUpdatedAt: null,
  lastReason: null,
};

const receipts: OperatorActionReceipt[] = [];
let counter = 0;

function nextReceipt(action: OperatorActionType, reason: string, actor: string): OperatorActionReceipt {
  counter += 1;
  const timestamp = new Date().toISOString();
  const receipt: OperatorActionReceipt = {
    id: `operator-${counter}`,
    timestamp,
    action,
    reason,
    actor,
    affectedAgent: 'Actura',
    modeAfter: state.mode,
  };
  receipts.push(receipt);
  if (receipts.length > 200) receipts.shift();
  return receipt;
}

export function pauseTrading(reason = 'manual pause', actor = 'operator'): OperatorActionReceipt {
  state.mode = 'paused';
  state.canTrade = false;
  state.lastUpdatedAt = new Date().toISOString();
  state.lastReason = reason;
  return nextReceipt('pause', reason, actor);
}

export function emergencyStop(reason = 'emergency stop', actor = 'operator'): OperatorActionReceipt {
  state.mode = 'emergency_stop';
  state.canTrade = false;
  state.lastUpdatedAt = new Date().toISOString();
  state.lastReason = reason;
  return nextReceipt('emergency_stop', reason, actor);
}

export function resumeTrading(reason = 'manual resume', actor = 'operator'): OperatorActionReceipt {
  state.mode = 'normal';
  state.canTrade = true;
  state.lastUpdatedAt = new Date().toISOString();
  state.lastReason = reason;
  return nextReceipt('resume', reason, actor);
}

export function getOperatorControlState(): OperatorControlState {
  return { ...state };
}

export function getOperatorActionReceipts(limit = 20): OperatorActionReceipt[] {
  return receipts.slice(-limit);
}

export function getLatestOperatorAction(): OperatorActionReceipt | null {
  return receipts.length ? receipts[receipts.length - 1] : null;
}

export function resetOperatorControls(): void {
  state.mode = 'normal';
  state.canTrade = true;
  state.lastUpdatedAt = null;
  state.lastReason = null;
  receipts.length = 0;
  counter = 0;
}
