/**
 * ERC-8004 Reputation Registry — Deployed Contract ABI
 * 
 * The deployed contract at 0xB5048e uses the intermediate v1.0 format:
 * - giveFeedback uses uint8 score (not int128 value + decimals)
 * - Tags are bytes32 (not string)
 * - feedbackAuth (bytes) is REQUIRED — EIP-191 signature from agent owner
 *   authorizing the reviewer to submit feedback
 * - Agent owner CANNOT give self-feedback (contract enforces this)
 * 
 * feedbackAuth signature message (7 × 32 bytes = 224 bytes):
 *   abi.encodePacked(agentId, clientAddress, indexLimit, expiry, chainId, identityRegistry, signerAddress)
 */

import { ethers } from 'ethers';
import { config } from '../agent/config.js';
import { getWallet, getWalletAddress, getProvider, waitForTx } from './sdk.js';
import { createLogger } from '../agent/logger.js';

const log = createLogger('REPUTATION');

// Deployed contract ABI (intermediate v1.0 — uint8 score, bytes32 tags, bytes feedbackAuth)
const REPUTATION_ABI = [
  // Write
  'function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash, bytes feedbackAuth) external',
  'function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external',
  'function appendResponse(uint256 agentId, address clientAddress, uint64 feedbackIndex, string responseURI, bytes32 responseHash) external',

  // Read
  'function getSummary(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2) external view returns (uint64 count, uint8 averageScore)',
  'function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) external view returns (uint8 score, bytes32 tag1, bytes32 tag2, bool isRevoked)',
  'function getClients(uint256 agentId) external view returns (address[])',
  'function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64)',
  'function getIdentityRegistry() external view returns (address)',

  // Events
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, uint8 score, bytes32 indexed indexedTag1, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash)',
];

let contract: ethers.Contract | null = null;

function getContract(signer?: ethers.Signer): ethers.Contract {
  if (signer) {
    if (!config.reputationRegistry) throw new Error('REPUTATION_REGISTRY address not set');
    return new ethers.Contract(config.reputationRegistry, REPUTATION_ABI, signer);
  }
  if (!contract) {
    if (!config.reputationRegistry) throw new Error('REPUTATION_REGISTRY address not set');
    contract = new ethers.Contract(config.reputationRegistry, REPUTATION_ABI, getWallet());
  }
  return contract;
}

/** Encode a string as a bytes32 (right-padded UTF-8) */
function toBytes32(s: string): string {
  if (!s) return ethers.ZeroHash;
  return ethers.encodeBytes32String(s.slice(0, 31)); // max 31 bytes for bytes32
}

/**
 * Build the feedbackAuth bytes for the deployed Reputation Registry.
 * 
 * Format: [abi.encode(struct) = 224 bytes] + [signature = 65 bytes (r+s+v)]
 * 
 * The agent owner signs: keccak256(abi.encode(agentId, clientAddress, indexLimit, expiry, chainId, identityRegistry, signerAddress))
 * Using EIP-191 personal sign (ethers signMessage auto-prepends the prefix).
 * 
 * The contract then hashes the same struct and wraps it with EIP-191 prefix
 * before ECDSA.tryRecover.
 */
async function buildFeedbackAuth(
  agentOwnerWallet: ethers.Wallet,
  agentId: number,
  reviewerAddress: string,
): Promise<string> {
  const indexLimit = 1000n; // Allow up to 1000 feedback entries
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour
  const chainId = BigInt(config.chainId);
  const identityRegistryAddr = config.identityRegistry;
  const signerAddress = agentOwnerWallet.address;

  // Step 1: ABI-encode the struct (7 × 32 bytes = 224 bytes)
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const structEncoded = coder.encode(
    ['uint256', 'address', 'uint64', 'uint256', 'uint256', 'address', 'address'],
    [agentId, reviewerAddress, indexLimit, expiry, chainId, identityRegistryAddr, signerAddress],
  );

  // Step 2: Hash the struct (this is what the contract hashes before EIP-191 wrapping)
  const structHash = ethers.keccak256(structEncoded);

  // Step 3: Sign with EIP-191 personal sign (signMessage auto-adds "\x19Ethereum Signed Message:\n32")
  const signature = await agentOwnerWallet.signMessage(ethers.getBytes(structHash));
  const sigBytes = ethers.getBytes(signature); // 65 bytes: r(32) + s(32) + v(1)

  // Step 4: Concatenate struct + signature
  const structBytes = ethers.getBytes(structEncoded);
  const authBytes = new Uint8Array(structBytes.length + sigBytes.length);
  authBytes.set(structBytes, 0);
  authBytes.set(sigBytes, structBytes.length);

  return ethers.hexlify(authBytes);
}

/**
 * Build off-chain feedback JSON per ERC-8004 spec
 */
export function buildFeedbackJson(params: {
  agentId: number;
  score: number;
  tag1: string;
  tag2?: string;
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
    score: params.score,
    tag1: params.tag1,
    tag2: params.tag2 || '',
    context: {
      tradePnl: params.tradePnl,
      tradeAsset: params.tradeAsset,
      sharpeRatio: params.sharpeRatio,
      validationArtifact: params.artifactCid ? `ipfs://${params.artifactCid}` : undefined,
    },
  };
}

/**
 * Submit feedback on-chain (deployed contract ABI)
 * 
 * IMPORTANT: The agent owner CANNOT call this for their own agent.
 * Use a separate "reviewer" wallet, with feedbackAuth signed by the agent owner.
 */
export async function giveFeedback(
  agentId: number,
  score: number,            // uint8 0-100
  tag1: string,             // e.g. "tradingYield", "starred"
  tag2: string = '',
  feedbackURI: string = '',
  feedbackHash: string = ethers.ZeroHash,
  feedbackAuth: string = '0x',
): Promise<string> {
  const registry = getContract();

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const tag1Bytes = toBytes32(tag1);
  const tag2Bytes = toBytes32(tag2);

  log.info(`Giving feedback: agent=${agentId}, score=${clampedScore}, tag1=${tag1}`);

  const tx = await registry.giveFeedback(
    agentId,
    clampedScore,
    tag1Bytes,
    tag2Bytes,
    feedbackURI,
    feedbackHash,
    feedbackAuth,
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
): Promise<{ count: number; averageScore: number }> {
  const registry = getContract();

  const [count, averageScore] = await registry.getSummary(
    agentId,
    clientAddresses,
    toBytes32(tag1),
    toBytes32(tag2),
  );

  return {
    count: Number(count),
    averageScore: Number(averageScore),
  };
}

/**
 * Post trading yield feedback (mapped to 0-100 score for uint8 contract)
 * 
 * Yield is mapped: -10% → 0, 0% → 50, +10% → 100
 */
export async function postTradingYield(
  agentId: number,
  yieldPercent: number,     // e.g. 2.5 for +2.5%, -1.3 for -1.3%
  period: 'day' | 'week' | 'month' | 'year',
  feedbackURI: string = '',
  feedbackHash: string = ethers.ZeroHash,
  feedbackAuth: string = '0x',
): Promise<string> {
  // Map yield to 0-100 score: -10% → 0, 0% → 50, +10% → 100
  const score = Math.max(0, Math.min(100, Math.round(50 + yieldPercent * 5)));

  return giveFeedback(
    agentId,
    score,
    'tradingYield',
    period,
    feedbackURI,
    feedbackHash,
    feedbackAuth,
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
  feedbackAuth: string = '0x',
): Promise<string> {
  return giveFeedback(
    agentId,
    Math.max(0, Math.min(100, Math.round(score))),
    'starred',
    '',
    feedbackURI,
    feedbackHash,
    feedbackAuth,
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
 * The agent owner wallet signs the feedbackAuth to authorize the reviewer.
 */
export async function giveFeedbackAsReviewer(
  reviewerPrivateKey: string,
  agentId: number,
  score: number,
  tag1: string,
  tag2: string = '',
  feedbackURI: string = '',
  feedbackHash: string = ethers.ZeroHash,
): Promise<string> {
  if (!config.reputationRegistry) throw new Error('REPUTATION_REGISTRY address not set');
  if (!config.privateKey) throw new Error('PRIVATE_KEY (agent owner) needed to sign feedbackAuth');

  const provider = getProvider();
  const reviewerWallet = new ethers.Wallet(
    reviewerPrivateKey.startsWith('0x') ? reviewerPrivateKey : `0x${reviewerPrivateKey}`,
    provider,
  );

  // Agent owner signs the feedbackAuth authorizing this reviewer
  const agentOwnerWallet = new ethers.Wallet(
    config.privateKey.startsWith('0x') ? config.privateKey : `0x${config.privateKey}`,
    provider,
  );
  const feedbackAuth = await buildFeedbackAuth(agentOwnerWallet, agentId, reviewerWallet.address);

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const tag1Bytes = toBytes32(tag1);
  const tag2Bytes = toBytes32(tag2);

  const registry = new ethers.Contract(config.reputationRegistry, REPUTATION_ABI, reviewerWallet);
  log.info(`Reviewer giving feedback: agent=${agentId}, score=${clampedScore}, tag1=${tag1}`);

  const tx = await registry.giveFeedback(
    agentId, clampedScore, tag1Bytes, tag2Bytes, feedbackURI, feedbackHash, feedbackAuth,
  );
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
  },
): Promise<string> {
  // Map yield to 0-100 score: -10% → 0, 0% → 50, +10% → 100
  const score = Math.max(0, Math.min(100, Math.round(50 + params.yieldPercent * 5)));
  return giveFeedbackAsReviewer(
    reviewerPrivateKey,
    agentId,
    score,
    'tradingYield',
    params.period,
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

// ──── Hackathon ReputationRegistry (Sepolia) ────

const HACKATHON_REPUTATION_ABI = [
  'function submitFeedback(uint256 agentId, uint8 score, bytes32 outcomeRef, string comment, uint8 feedbackType) external',
  'function getAverageScore(uint256 agentId) external view returns (uint256)',
];

/**
 * Submit feedback to the hackathon's ReputationRegistry.
 * feedbackType: 0 = general, 1 = trade outcome, 2 = quality
 */
export async function submitHackathonFeedback(
  agentId: number,
  score: number,
  outcomeRef: string,
  comment: string,
  feedbackType: number = 0,
): Promise<string> {
  if (!config.reputationRegistry) throw new Error('REPUTATION_REGISTRY not set');

  const wallet = getWallet();
  const registry = new ethers.Contract(config.reputationRegistry, HACKATHON_REPUTATION_ABI, wallet);

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  log.info('Submitting hackathon feedback', { agentId, score: clampedScore, feedbackType });

  const tx = await registry.submitFeedback(
    agentId,
    clampedScore,
    outcomeRef,
    comment,
    feedbackType,
  );
  const receipt = await waitForTx(tx);
  log.info('Hackathon feedback submitted', { txHash: receipt.hash });
  return receipt.hash;
}

/**
 * Submit hackathon feedback using the reviewer wallet (avoids self-rate restriction).
 */
export async function submitHackathonFeedbackAsReviewer(
  agentId: number,
  score: number,
  outcomeRef: string,
  comment: string,
  feedbackType: number = 0,
): Promise<string> {
  if (!config.reputationRegistry) throw new Error('REPUTATION_REGISTRY not set');
  const reviewerKey = process.env.REVIEWER_PRIVATE_KEY;
  if (!reviewerKey) throw new Error('REVIEWER_PRIVATE_KEY not set');

  const provider = getProvider();
  const reviewer = new ethers.Wallet(
    reviewerKey.startsWith('0x') ? reviewerKey : `0x${reviewerKey}`,
    provider,
  );
  const registry = new ethers.Contract(config.reputationRegistry, HACKATHON_REPUTATION_ABI, reviewer);

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  log.info('Submitting hackathon feedback as reviewer', { agentId, score: clampedScore, reviewer: reviewer.address });

  const tx = await registry.submitFeedback(agentId, clampedScore, outcomeRef, comment, feedbackType);
  const receipt = await waitForTx(tx);
  log.info('Hackathon feedback (reviewer) submitted', { txHash: receipt.hash });
  return receipt.hash;
}

/**
 * Get average reputation score from hackathon registry.
 */
export async function getHackathonReputation(agentId: number): Promise<number> {
  if (!config.reputationRegistry) return 0;
  const wallet = getWallet();
  const registry = new ethers.Contract(config.reputationRegistry, HACKATHON_REPUTATION_ABI, wallet);
  const score = await registry.getAverageScore(agentId);
  return Number(score);
}

/**
 * Submit reputation feedback from a freshly created reviewer wallet.
 * Creates ephemeral wallet, funds from main wallet, submits score, returns tx hash.
 * Each call creates a unique reviewer to avoid "already rated" restriction.
 */
export async function submitReputationWithFreshReviewer(
  agentId: number,
  score: number,
  comment: string,
): Promise<string> {
  if (!config.reputationRegistry) throw new Error('REPUTATION_REGISTRY not set');

  const provider = getProvider();
  const mainWallet = getWallet();
  const reviewer = ethers.Wallet.createRandom().connect(provider);

  // Fund reviewer with enough for one submitFeedback tx
  const fundTx = await mainWallet.sendTransaction({
    to: reviewer.address,
    value: ethers.parseEther('0.01'),
  });
  await fundTx.wait();

  const registry = new ethers.Contract(config.reputationRegistry, HACKATHON_REPUTATION_ABI, reviewer);
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const outcomeRef = ethers.keccak256(ethers.toUtf8Bytes(`auto-${agentId}-${Date.now()}`));

  const tx = await registry.submitFeedback(agentId, clampedScore, outcomeRef, comment, 1);
  const receipt = await waitForTx(tx);

  log.info('Fresh reviewer reputation posted', {
    txHash: receipt.hash,
    score: clampedScore,
    reviewer: reviewer.address,
  });
  return receipt.hash;
}
