
/**
 * Router-compatible EIP-712 TradeIntent builder/signing.
 * Fields are kept minimal and adapter-friendly until the hackathon releases the final ABI.
 */
import { ethers, type TypedDataField } from 'ethers';
import { config } from '../agent/config.js';
import { getWallet } from './sdk.js';

export const TRADE_INTENT_TYPES: Record<string, TypedDataField[]> = {
  TradeIntent: [
    { name: 'agent', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'side', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'maxSlippage', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'reasoningHash', type: 'bytes32' },
  ],
} as const;

export interface TradeIntentData {
  agent: string;
  asset: string;
  side: number;
  amount: bigint;
  maxSlippage: bigint;
  deadline: bigint;
  nonce: bigint;
  reasoningHash: string;
}

let nonceCounter = 0n;

export function getTradeIntentDomain(): ethers.TypedDataDomain {
  return {
    name: 'TradingAgentRiskRouter',
    version: '1',
    chainId: config.chainId,
    verifyingContract: config.riskRouterAddress || ethers.ZeroAddress,
  };
}

export function buildTradeIntent(params: {
  assetAddress: string;
  side: 'LONG' | 'SHORT';
  amountWei: bigint;
  slippageBps: number;
  deadlineSeconds: number;
  reasoning?: string;
}): TradeIntentData {
  const wallet = getWallet();
  nonceCounter += 1n;
  const reasoningHash = params.reasoning
    ? ethers.keccak256(ethers.toUtf8Bytes(params.reasoning))
    : ethers.ZeroHash;
  return {
    agent: wallet.address,
    asset: params.assetAddress,
    side: params.side === 'LONG' ? 0 : 1,
    amount: params.amountWei,
    maxSlippage: BigInt(params.slippageBps),
    deadline: BigInt(Math.floor(Date.now() / 1000) + params.deadlineSeconds),
    nonce: nonceCounter,
    reasoningHash,
  };
}

export async function signTradeIntent(intent: TradeIntentData): Promise<{ intent: TradeIntentData; signature: string; domain: ethers.TypedDataDomain; hash: string; }> {
  const wallet = getWallet();
  const domain = getTradeIntentDomain();
  const signature = await wallet.signTypedData(domain, TRADE_INTENT_TYPES, intent);
  const hash = hashTradeIntent(intent, domain);
  return { intent, signature, domain, hash };
}

export function verifyTradeIntent(intent: TradeIntentData, signature: string, domain = getTradeIntentDomain()): string {
  return ethers.verifyTypedData(domain, TRADE_INTENT_TYPES, intent, signature);
}

export function hashTradeIntent(intent: TradeIntentData, domain = getTradeIntentDomain()): string {
  return ethers.TypedDataEncoder.hash(domain, TRADE_INTENT_TYPES, intent);
}

export function toRiskRouterPayload(intent: TradeIntentData, signature: string) {
  return {
    intent,
    signature,
    requestHash: hashTradeIntent(intent),
    submittedAt: new Date().toISOString(),
  };
}

export function resetNonce(): void {
  nonceCounter = 0n;
}

/**
 * Verify that a reasoning string matches the hash committed in the intent.
 * Returns true if keccak256(reasoning) === reasoningHash.
 */
export function verifyReasoningIntegrity(reasoning: string, reasoningHash: string): boolean {
  if (!reasoning || !reasoningHash || reasoningHash === ethers.ZeroHash) return false;
  return ethers.keccak256(ethers.toUtf8Bytes(reasoning)) === reasoningHash;
}
