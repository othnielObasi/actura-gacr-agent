/**
 * ERC-8004 Reputation Registry — v1.0 Spec Compliant
 * 
 * Key differences from v0.4:
 * - giveFeedback uses int128 value + uint8 valueDecimals (not uint8 score)
 * - Tags are strings, not bytes32
 * - feedbackAuth is REMOVED — anyone can give feedback
 * - Agent owner CANNOT give self-feedback (contract enforces this)
 * - endpoint parameter added
 * 
 * Spec: https://eips.ethereum.org/EIPS/eip-8004#reputation-registry
 */

import { ethers } from 'ethers';
import { config } from '../agent/config.js';
import { getWallet, getWalletAddress, getProvider, waitForTx } from './sdk.js';
import { createLogger } from '../agent/logger.js';

const log = createLogger('REPUTATION');

// v1.0 ABI
const REPUTATION_ABI = [
  // Write
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external',
  'function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external',
  'function appendResponse(uint256 agentId, address clientAddress, uint64 feedbackIndex, string responseURI, bytes32 responseHash) external',

  // Read
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
  'function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) external view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)',
  'function getClients(uint256 agentId) external view returns (address[])',
  'function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64)',

  // Events
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
];

let contract: ethers.Contract | null = null;

function getContract(): ethers.Contract {
  if (!contract) {
    if (!config.reputationRegistry) throw new Error('REPUTATION_REGISTRY address not set');
    contract = new ethers.Contract(config.reputationRegistry, REPUTATION_ABI, getWallet());
  }
  return contract;
}

/**
 * Build off-chain feedback JSON per ERC-8004 spec
 */
export function buildFeedbackJson(params: {
  agentId: number;
  value: number;
  valueDecimals: number;
  tag1: string;
  tag2?: string;
  endpoint?: string;
  tradePnl?: number;
  tradeAsset?: string;
  sharpeRatio?: number | null;
  artifactCid?: string;
}): object {
  return {
    agentRegistry: `eip155:${config.chainId}:${config.identityRegistry}`,
    agentId: params.agentId,
    clientAddress: `eip155:${config.chainId}:${safeWalletAddress()}`,
    createdAt: new Date().toISOString(),
    value: params.value,
    valueDecimals: params.valueDecimals,
    tag1: params.tag1,
    tag2: params.tag2 || '',
    endpoint: params.endpoint || '',
    // Custom context
    context: {
      tradePnl: params.tradePnl,
      tradeAsset: params.tradeAsset,
      sharpeRatio: params.sharpeRatio,
      validationArtifact: params.artifactCid ? `ipfs://${params.artifactCid}` : undefined,
    },
  };
}

/**
 * Submit feedback on-chain (v1.0)
 * 
 * IMPORTANT: The agent owner CANNOT call this for their own agent.
 * Use a separate "reviewer" wallet, or have an external service call this.
 */
export async function giveFeedback(
  agentId: number,
  value: number,           // int128 — e.g. 87 for score, -32 for -3.2% yield
  valueDecimals: number,   // uint8 0-18 — e.g. 0 for integer, 1 for 1 decimal
  tag1: string,            // e.g. "tradingYield", "successRate", "starred"
  tag2: string = '',       // e.g. "day", "week", "month"
  endpoint: string = '',   // OPTIONAL endpoint that was used
  feedbackURI: string = '',// OPTIONAL IPFS URI to full feedback JSON
  feedbackHash: string = ethers.ZeroHash, // OPTIONAL keccak256 of feedbackURI content
): Promise<string> {
  const registry = getContract();

  log.info(`Giving feedback: agent=${agentId}, value=${value}, decimals=${valueDecimals}, tag1=${tag1}`);

  const tx = await registry.giveFeedback(
    agentId,
    value,
    valueDecimals,
    tag1,
    tag2,
    endpoint,
    feedbackURI,
    feedbackHash
  );
  const receipt = await waitForTx(tx);

  log.info(`Feedback submitted! Tx: ${receipt.hash}`);
  return receipt.hash;
}

/**
 * Get reputation summary for an agent
 * clientAddresses MUST be provided (non-empty) per spec to avoid Sybil attacks
 */
export async function getReputationSummary(
  agentId: number,
  clientAddresses: string[],
  tag1: string = '',
  tag2: string = ''
): Promise<{ count: number; value: number; valueDecimals: number }> {
  const registry = getContract();

  const [count, summaryValue, summaryValueDecimals] = await registry.getSummary(
    agentId,
    clientAddresses,
    tag1,
    tag2
  );

  return {
    count: Number(count),
    value: Number(summaryValue),
    valueDecimals: Number(summaryValueDecimals),
  };
}

/**
 * Post trading yield feedback
 * 
 * Per spec tag examples:
 *   tag1: "tradingYield"
 *   tag2: "day" | "week" | "month" | "year"
 *   value: yield as int128 with valueDecimals
 *   e.g. -3.2% → value=-32, valueDecimals=1
 *   e.g. 12.5% → value=125, valueDecimals=1
 */
export async function postTradingYield(
  agentId: number,
  yieldPercent: number,     // e.g. 2.5 for +2.5%, -1.3 for -1.3%
  period: 'day' | 'week' | 'month' | 'year',
  feedbackURI: string = '',
  feedbackHash: string = ethers.ZeroHash,
): Promise<string> {
  // Convert to int128 with 1 decimal
  const value = Math.round(yieldPercent * 10);  // -3.2% → -32

  return giveFeedback(
    agentId,
    value,
    1,  // 1 decimal place
    'tradingYield',
    period,
    '',
    feedbackURI,
    feedbackHash
  );
}

/**
 * Post a quality score (0-100)
 */
export async function postQualityScore(
  agentId: number,
  score: number,            // 0-100
  feedbackURI: string = '',
  feedbackHash: string = ethers.ZeroHash,
): Promise<string> {
  return giveFeedback(
    agentId,
    Math.max(0, Math.min(100, Math.round(score))),
    0,  // No decimals
    'starred',
    '',
    '',
    feedbackURI,
    feedbackHash
  );
}

/**
 * Get all feedback clients for our agent
 */
export async function getFeedbackClients(agentId: number): Promise<string[]> {
  const registry = getContract();
  return registry.getClients(agentId);
}


/**
 * Submit feedback from an external reviewer wallet (required for ERC-8004 self-feedback restriction).
 */
export async function giveFeedbackAsReviewer(
  reviewerPrivateKey: string,
  agentId: number,
  value: number,
  valueDecimals: number,
  tag1: string,
  tag2: string = '',
  endpoint: string = '',
  feedbackURI: string = '',
  feedbackHash: string = ethers.ZeroHash,
): Promise<string> {
  if (!config.reputationRegistry) throw new Error('REPUTATION_REGISTRY address not set');
  const provider = getProvider();
  const reviewerWallet = new ethers.Wallet(reviewerPrivateKey.startsWith('0x') ? reviewerPrivateKey : `0x${reviewerPrivateKey}`, provider);
  const registry = new ethers.Contract(config.reputationRegistry, REPUTATION_ABI, reviewerWallet);
  const tx = await registry.giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash);
  const receipt = await waitForTx(tx);
  log.info(`Reviewer feedback submitted`, { reviewer: reviewerWallet.address, txHash: receipt.hash });
  return receipt.hash;
}

/**
 * Post a normalized trade outcome feedback using an external reviewer wallet.
 */
export async function postTradeOutcomeFeedback(
  reviewerPrivateKey: string,
  agentId: number,
  params: {
    yieldPercent: number;
    period: 'day' | 'week' | 'month' | 'year';
    artifactUri?: string;
    artifactHash?: string;
    endpoint?: string;
  },
): Promise<string> {
  const value = Math.round(params.yieldPercent * 10);
  return giveFeedbackAsReviewer(
    reviewerPrivateKey,
    agentId,
    value,
    1,
    'tradingYield',
    params.period,
    params.endpoint || '',
    params.artifactUri || '',
    params.artifactHash || ethers.ZeroHash,
  );
}

function safeWalletAddress(): string {
  try { return getWalletAddress(); } catch { return '0x0000000000000000000000000000000000000000'; }
}


export interface ReputationFeedbackEnvelope {
  agentId: number;
  reviewerAddress: string;
  tag1: string;
  tag2: string;
  value: number;
  valueDecimals: number;
  endpoint: string;
  feedbackURI: string;
  feedbackHash: string;
  createdAt: string;
}

export function buildReputationFeedbackEnvelope(params: {
  agentId: number;
  reviewerAddress: string;
  tag1: string;
  tag2?: string;
  value: number;
  valueDecimals: number;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: string;
}): ReputationFeedbackEnvelope {
  return {
    agentId: params.agentId,
    reviewerAddress: params.reviewerAddress,
    tag1: params.tag1,
    tag2: params.tag2 || '',
    value: params.value,
    valueDecimals: params.valueDecimals,
    endpoint: params.endpoint || '',
    feedbackURI: params.feedbackURI || '',
    feedbackHash: params.feedbackHash || ethers.ZeroHash,
    createdAt: new Date().toISOString(),
  };
}
