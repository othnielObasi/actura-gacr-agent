/**
 * Operator Control Layer
 * Human oversight controls for manual pause / emergency stop.
 * Supports EIP-1271 signature verification for operator commands.
 */

import { verifySignature, type SignatureVerification } from '../chain/eip1271.js';

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
  signatureVerification?: SignatureVerification;
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

/**
 * Execute an operator action with optional EIP-1271 signature verification.
 * If a signature is provided, verifies the operator's identity (EOA or contract wallet)
 * before executing the action.
 */
export async function verifiedOperatorAction(
  action: OperatorActionType,
  operatorAddress: string,
  reason: string,
  messageHash?: string,
  signature?: string,
): Promise<OperatorActionReceipt & { signatureVerification?: SignatureVerification }> {
  let verification: SignatureVerification | undefined;

  if (messageHash && signature) {
    verification = await verifySignature(operatorAddress, messageHash, signature);
    if (!verification.valid) {
      return {
        id: `operator-rejected-${Date.now()}`,
        timestamp: new Date().toISOString(),
        action,
        reason: `Signature verification failed: ${verification.reason}`,
        actor: operatorAddress,
        affectedAgent: 'Actura',
        modeAfter: state.mode,
        signatureVerification: verification,
      };
    }
  }

  let receipt: OperatorActionReceipt;
  switch (action) {
    case 'pause': receipt = pauseTrading(reason, operatorAddress); break;
    case 'emergency_stop': receipt = emergencyStop(reason, operatorAddress); break;
    case 'resume': receipt = resumeTrading(reason, operatorAddress); break;
  }

  if (verification) {
    receipt.signatureVerification = verification;
  }
  return receipt;
}
