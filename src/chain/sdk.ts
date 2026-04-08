/**
 * Chain SDK — Wallet, Provider, and Contract Setup
 * Initializes ethers.js connection for all on-chain interactions
 */

import { ethers } from 'ethers';
import { config } from '../agent/config.js';

let provider: ethers.JsonRpcProvider | null = null;
let wallet: ethers.Wallet | null = null;

/**
 * Initialize provider and wallet
 */
export function initChain(): { provider: ethers.JsonRpcProvider; wallet: ethers.Wallet } {
  if (provider && wallet) return { provider, wallet };

  if (!config.privateKey) {
    throw new Error('PRIVATE_KEY not set in .env');
  }

  provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, {
    batchMaxCount: 1,       // disable batching — free-tier RPCs reject batch requests
  });
  wallet = new ethers.Wallet(
    config.privateKey.startsWith('0x') ? config.privateKey : `0x${config.privateKey}`,
    provider
  );

  console.log(`[CHAIN] Connected to ${config.rpcUrl} (chainId: ${config.chainId}, batchMaxCount=1)`);
  console.log(`[CHAIN] Wallet: ${wallet.address}`);

  return { provider, wallet };
}

/**
 * Get wallet address
 */
export function getWalletAddress(): string {
  if (!wallet) throw new Error('Chain not initialized — call initChain() first');
  return wallet.address;
}

/**
 * Get provider
 */
export function getProvider(): ethers.JsonRpcProvider {
  if (!provider) throw new Error('Chain not initialized');
  return provider;
}

/**
 * Get wallet (signer)
 */
export function getWallet(): ethers.Wallet {
  if (!wallet) throw new Error('Chain not initialized');
  return wallet;
}

/**
 * Check wallet balance
 */
export async function getBalance(): Promise<string> {
  const { provider, wallet } = initChain();
  const balance = await provider.getBalance(wallet.address);
  return ethers.formatEther(balance);
}

/**
 * Wait for transaction confirmation
 */
export async function waitForTx(tx: ethers.TransactionResponse, confirmations: number = 1): Promise<ethers.TransactionReceipt> {
  console.log(`[CHAIN] Tx submitted: ${tx.hash}`);
  const receipt = await tx.wait(confirmations);
  if (!receipt) throw new Error('Transaction failed — no receipt');
  console.log(`[CHAIN] Tx confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);
  return receipt;
}
