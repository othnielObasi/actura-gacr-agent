/**
 * Risk Router — Hackathon Trade Execution
 * Submits signed TradeIntents to the hackathon's Risk Router contract
 * 
 * Note: The exact ABI will be provided by the hackathon.
 * This is a template with placeholder functions.
 */

import { ethers } from 'ethers';
import { config } from '../agent/config.js';
import { getWallet, waitForTx } from './sdk.js';
import type { TradeIntentData } from './intent.js';

// Placeholder ABI — update when hackathon provides Risk Router spec
const RISK_ROUTER_ABI = [
  'function submitIntent(tuple(address agent, address asset, uint8 side, uint256 amount, uint256 maxSlippage, uint256 deadline, uint256 nonce) intent, bytes signature) external returns (bytes32 intentId)',
  'function getIntentStatus(bytes32 intentId) external view returns (uint8 status)',
  'function claimSandbox(address agent) external',
  'event IntentSubmitted(bytes32 indexed intentId, address indexed agent, address asset, uint8 side)',
  'event IntentExecuted(bytes32 indexed intentId, uint256 executionPrice, uint256 executionAmount)',
];

let contract: ethers.Contract | null = null;

function getContract(): ethers.Contract {
  if (!contract) {
    if (!config.riskRouterAddress) throw new Error('RISK_ROUTER_ADDRESS not set — wait for hackathon to provide');
    contract = new ethers.Contract(config.riskRouterAddress, RISK_ROUTER_ABI, getWallet());
  }
  return contract;
}

/**
 * Submit a signed trade intent to the Risk Router
 */
export async function submitTradeIntent(
  intent: TradeIntentData,
  signature: string
): Promise<{ intentId: string; txHash: string }> {
  const router = getContract();

  console.log(`[ROUTER] Submitting intent: side=${intent.side}, amount=${intent.amount}`);

  const tx = await router.submitIntent(
    [intent.agent, intent.asset, intent.side, intent.amount, intent.maxSlippage, intent.deadline, intent.nonce],
    signature
  );
  const receipt = await waitForTx(tx);

  // Parse IntentSubmitted event
  const event = receipt.logs
    .map(log => {
      try { return router.interface.parseLog({ topics: [...log.topics], data: log.data }); }
      catch { return null; }
    })
    .find(e => e?.name === 'IntentSubmitted');

  const intentId = event?.args?.intentId || receipt.hash;

  console.log(`[ROUTER] Intent submitted! ID: ${intentId}`);
  return { intentId: String(intentId), txHash: receipt.hash };
}

/**
 * Check the status of a submitted intent
 */
export async function getIntentStatus(intentId: string): Promise<string> {
  const router = getContract();
  const status = await router.getIntentStatus(intentId);

  const statusMap: Record<number, string> = {
    0: 'PENDING',
    1: 'EXECUTED',
    2: 'REJECTED',
    3: 'EXPIRED',
  };

  return statusMap[Number(status)] || 'UNKNOWN';
}

/**
 * Claim sandbox allocation (if required by hackathon)
 */
export async function claimSandbox(): Promise<string> {
  const router = getContract();
  const wallet = getWallet();

  console.log(`[ROUTER] Claiming sandbox for ${wallet.address}`);
  const tx = await router.claimSandbox(wallet.address);
  const receipt = await waitForTx(tx);

  console.log(`[ROUTER] Sandbox claimed!`);
  return receipt.hash;
}
