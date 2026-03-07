/**
 * Signing Utilities
 * 
 * NOTE: feedbackAuth was REMOVED in ERC-8004 v1.0.
 * The Reputation Registry no longer requires pre-authorization.
 * Anyone can call giveFeedback() (except the agent owner for their own agent).
 * 
 * These signing utilities are kept for:
 * - setAgentWallet() EIP-712 proof
 * - General message signing needs
 * - Backward compatibility
 */

import { ethers } from 'ethers';
import { getWallet } from './sdk.js';

export interface FeedbackAuthParams {
  clientAddress: string;  // Who is authorized to give feedback
  agentId: number;
  maxFeedbackCount: number;
  expiresAt: number;      // Unix timestamp
}

/**
 * Generate a feedback authorization signature (EIP-191)
 * The agent signs a message authorizing a specific client to submit feedback
 */
export async function signFeedbackAuth(params: FeedbackAuthParams): Promise<string> {
  const wallet = getWallet();

  // Build the authorization message
  const message = ethers.solidityPacked(
    ['address', 'uint256', 'uint256', 'uint256'],
    [params.clientAddress, params.agentId, params.maxFeedbackCount, params.expiresAt]
  );

  const messageHash = ethers.keccak256(message);
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  console.log(`[FEEDBACK-AUTH] Authorization signed for client ${params.clientAddress}`);
  return signature;
}

/**
 * Generate self-authorization for self-assessment feedback
 * The agent authorizes itself to submit feedback
 */
export async function signSelfAuthorization(agentId: number): Promise<string> {
  const wallet = getWallet();

  return signFeedbackAuth({
    clientAddress: wallet.address,
    agentId,
    maxFeedbackCount: 1000,  // Allow many self-assessments
    expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,  // 30 days
  });
}

/**
 * Verify a feedback authorization signature
 */
export function verifyFeedbackAuth(
  params: FeedbackAuthParams,
  signature: string,
  expectedSigner: string
): boolean {
  const message = ethers.solidityPacked(
    ['address', 'uint256', 'uint256', 'uint256'],
    [params.clientAddress, params.agentId, params.maxFeedbackCount, params.expiresAt]
  );

  const messageHash = ethers.keccak256(message);
  const recoveredAddress = ethers.verifyMessage(ethers.getBytes(messageHash), signature);

  return recoveredAddress.toLowerCase() === expectedSigner.toLowerCase();
}
