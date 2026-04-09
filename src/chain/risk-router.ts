/**
 * Risk Router — Hackathon Shared Contract (Sepolia)
 *
 * Submits signed TradeIntents to the shared RiskRouter.
 * ABI from SHARED_CONTRACTS.md (Path B).
 *
 * Risk limits enforced on-chain:
 *   - Max position: $500/trade
 *   - Max trades/hour: 10
 *   - Max drawdown: 5%
 */

import { ethers } from 'ethers';
import { config } from '../agent/config.js';
import { getWallet, waitForTx } from './sdk.js';
import { createLogger } from '../agent/logger.js';
import type { TradeIntentData } from './intent.js';

const log = createLogger('ROUTER');

const RISK_ROUTER_ABI = [
  'function submitTradeIntent(tuple(uint256 agentId, address agentWallet, string pair, string action, uint256 amountUsdScaled, uint256 maxSlippageBps, uint256 nonce, uint256 deadline) intent, bytes signature) external',
  'function simulateIntent(tuple(uint256 agentId, address agentWallet, string pair, string action, uint256 amountUsdScaled, uint256 maxSlippageBps, uint256 nonce, uint256 deadline) intent) external view returns (bool valid, string reason)',
  'function getIntentNonce(uint256 agentId) external view returns (uint256)',
  'event TradeApproved(uint256 indexed agentId, bytes32 indexed intentHash, uint256 amountUsdScaled)',
  'event TradeRejected(uint256 indexed agentId, bytes32 indexed intentHash, string reason)',
];

let contract: ethers.Contract | null = null;

function getContract(): ethers.Contract {
  if (!contract) {
    if (!config.riskRouterAddress) throw new Error('RISK_ROUTER_ADDRESS not set');
    contract = new ethers.Contract(config.riskRouterAddress, RISK_ROUTER_ABI, getWallet());
  }
  return contract;
}

/**
 * Get the next valid nonce for this agent from the RiskRouter contract.
 */
export async function getIntentNonce(agentId: number): Promise<bigint> {
  const router = getContract();
  const nonce = await router.getIntentNonce(agentId);
  return BigInt(nonce);
}

/**
 * Dry-run a trade intent against the RiskRouter's risk checks.
 * Returns { valid, reason } without submitting on-chain.
 */
export async function simulateIntent(intent: TradeIntentData): Promise<{ valid: boolean; reason: string }> {
  const router = getContract();
  const intentTuple = [
    intent.agentId,
    intent.agentWallet,
    intent.pair,
    intent.action,
    intent.amountUsdScaled,
    intent.maxSlippageBps,
    intent.nonce,
    intent.deadline,
  ];

  const [valid, reason] = await router.simulateIntent(intentTuple);
  return { valid, reason };
}

/**
 * Submit a signed trade intent to the RiskRouter.
 * Listen for TradeApproved / TradeRejected events.
 */
export async function submitTradeIntent(
  intent: TradeIntentData,
  signature: string,
): Promise<{ intentHash: string; txHash: string; approved: boolean; rejectReason?: string }> {
  const router = getContract();

  const intentTuple = [
    intent.agentId,
    intent.agentWallet,
    intent.pair,
    intent.action,
    intent.amountUsdScaled,
    intent.maxSlippageBps,
    intent.nonce,
    intent.deadline,
  ];

  log.info('Submitting trade intent', {
    agentId: intent.agentId.toString(),
    pair: intent.pair,
    action: intent.action,
    amountUsd: (Number(intent.amountUsdScaled) / 100).toFixed(2),
    nonce: intent.nonce.toString(),
  });

  const tx = await router.submitTradeIntent(intentTuple, signature);
  const receipt = await waitForTx(tx);

  // Parse events
  let intentHash = '';
  let approved = false;
  let rejectReason: string | undefined;

  for (const eventLog of receipt.logs) {
    try {
      const parsed = router.interface.parseLog({ topics: [...eventLog.topics], data: eventLog.data });
      if (!parsed) continue;

      if (parsed.name === 'TradeApproved') {
        intentHash = parsed.args.intentHash;
        approved = true;
        log.info('Trade APPROVED', {
          intentHash,
          amountUsd: (Number(parsed.args.amountUsdScaled) / 100).toFixed(2),
        });
      } else if (parsed.name === 'TradeRejected') {
        intentHash = parsed.args.intentHash;
        approved = false;
        rejectReason = parsed.args.reason;
        log.warn('Trade REJECTED', { intentHash, reason: rejectReason });
      }
    } catch { /* not our event */ }
  }

  if (!intentHash) {
    intentHash = receipt.hash;
    log.warn('No TradeApproved/TradeRejected event found — using tx hash');
  }

  return { intentHash, txHash: receipt.hash, approved, rejectReason };
}
