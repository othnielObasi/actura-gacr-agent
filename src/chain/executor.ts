/**
 * Trade Executor — Hackathon Shared Contract Flow (Sepolia)
 *
 * Full pipeline:
 * 1. Build TradeIntent from strategy output
 * 2. Simulate via RiskRouter.simulateIntent() (dry-run)
 * 3. Sign with EIP-712
 * 4. Submit to RiskRouter.submitTradeIntent()
 * 5. Upload validation artifact to IPFS
 * 6. Post checkpoint to ValidationRegistry.postEIP712Attestation()
 * 7. Post reputation feedback to ReputationRegistry.submitFeedback()
 */

import { ethers } from 'ethers';
import { createLogger } from '../agent/logger.js';
import { retry } from '../agent/retry.js';
import { config } from '../agent/config.js';
import { getWallet, getWalletAddress, getBalance, initChain } from './sdk.js';
import { buildTradeIntent, signTradeIntent, TRADE_INTENT_TYPES, getTradeIntentDomain, hashTradeIntent, type TradeIntentData } from './intent.js';
import { verifyTypedDataSignature } from './eip1271.js';
import { submitTradeIntent, simulateIntent, getIntentNonce } from './risk-router.js';
// Validation & reputation scores posted by hackathon judge bot (no self-attestation)
import { simulateExecution } from './execution-simulator.js';
import { uploadArtifact } from '../trust/ipfs.js';
import type { ValidationArtifact } from '../trust/artifact-emitter.js';
import type { StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision } from '../risk/engine.js';

const log = createLogger('EXECUTOR');

export interface ExecutionResult {
  success: boolean;
  intentHash: string | null;
  intentTxHash: string | null;
  approved: boolean | null;
  rejectReason: string | null;
  checkpointTxHash: string | null;
  reputationTxHash: string | null;
  artifactIpfsCid: string | null;
  artifactIpfsUri: string | null;
  error: string | null;
  executionTimeMs: number;
}

// Keep backward compat — old code references these fields
export { ExecutionResult as ExecutionResultLegacy };

/**
 * Full trade execution pipeline via hackathon shared contracts.
 */
export async function executeTrade(
  strategyOutput: StrategyOutput,
  riskDecision: RiskDecision,
  artifact: ValidationArtifact,
  agentId: number,
): Promise<ExecutionResult> {
  const start = Date.now();
  const result: ExecutionResult = {
    success: false,
    intentHash: null,
    intentTxHash: null,
    approved: null,
    rejectReason: null,
    checkpointTxHash: null,
    reputationTxHash: null,
    artifactIpfsCid: null,
    artifactIpfsUri: null,
    error: null,
    executionTimeMs: 0,
  };

  try {
    // ── Step 0: Local pre-trade simulation ──
    // On testnet, gas is free — don't let fictional gas costs block profitable trades.
    const isTestnet = config.chainId === 11155111 || config.chainId === 84532;
    const localSim = simulateExecution({
      strategyOutput,
      riskDecision,
      gasUsd: isTestnet ? 0 : 0.35,
      dexFeeBps: isTestnet ? 5 : undefined,
    });
    if (!localSim.allowed) {
      result.error = `Local simulation blocked: ${localSim.reason}`;
      result.executionTimeMs = Date.now() - start;
      log.warn('Local simulation blocked trade', localSim);
      return result;
    }

    // ── Step 1: Get on-chain nonce ──
    const nonce = await retry(
      () => getIntentNonce(agentId),
      { maxRetries: 2, baseDelayMs: 1000, label: 'Get intent nonce' },
    );
    log.info('Got on-chain nonce', { nonce: nonce.toString() });

    // ── Step 2: Build TradeIntent ──
    const direction = strategyOutput.signal.direction as 'LONG' | 'SHORT';
    const action = direction === 'LONG' ? 'BUY' : 'SELL';
    // Position size in USD (capped at $500 per hackathon rules)
    const positionUsd = Math.min(riskDecision.finalPositionSize * strategyOutput.currentPrice, 500);

    const intent = buildTradeIntent({
      agentId,
      pair: config.tradingPair === 'WETH/USDC' ? 'XBTUSD' : config.tradingPair,
      action,
      amountUsd: positionUsd,
      slippageBps: 100,       // 1% max slippage
      deadlineSeconds: 300,   // 5 min deadline
      nonce,
    });

    // ── Step 3: Simulate on-chain (dry-run) ──
    log.info('Simulating intent on RiskRouter...');
    try {
      const sim = await simulateIntent(intent);
      if (!sim.valid) {
        result.error = `RiskRouter simulation rejected: ${sim.reason}`;
        result.rejectReason = sim.reason;
        result.executionTimeMs = Date.now() - start;
        log.warn('RiskRouter simulation rejected', { reason: sim.reason });
        return result;
      }
      log.info('RiskRouter simulation passed');
    } catch (err: any) {
      // simulateIntent might revert on some contract versions — log but don't block
      log.warn('simulateIntent reverted — proceeding to live submit', { error: err.message?.slice(0, 80) });
    }

    // ── Step 4: Sign with EIP-712 ──
    log.info('Signing TradeIntent (EIP-712)...');
    const { signature, domain } = await signTradeIntent(intent);

    // ── Step 4b: Verify signature locally ──
    const wallet = getWallet();
    const verification = await verifyTypedDataSignature(
      wallet.address,
      domain,
      TRADE_INTENT_TYPES,
      intent as unknown as Record<string, unknown>,
      signature,
    );
    if (!verification.valid) {
      result.error = `Signature verification failed: ${verification.reason}`;
      result.executionTimeMs = Date.now() - start;
      log.error('Signature verification failed', verification);
      return result;
    }

    // ── Step 5: Submit to RiskRouter ──
    log.info('Submitting to RiskRouter...');
    const submission = await retry(
      () => submitTradeIntent(intent, signature),
      { maxRetries: 2, baseDelayMs: 2000, label: 'RiskRouter submit' },
    );

    result.intentHash = submission.intentHash;
    result.intentTxHash = submission.txHash;
    result.approved = submission.approved;
    result.rejectReason = submission.rejectReason ?? null;

    // Validation & reputation scores are now posted by the hackathon judge bot
    // every 4 hours based on on-chain activity. No self-attestation needed.

    if (!submission.approved) {
      result.error = `Trade rejected: ${submission.rejectReason || 'unknown'}`;
      result.executionTimeMs = Date.now() - start;
      return result;
    }

    log.info('Trade approved by RiskRouter!', { intentHash: submission.intentHash });

    // ── Step 6: Upload artifact to IPFS ──
    let ipfsCid = '';
    let ipfsUri = '';
    try {
      const ipfsResult = await retry(
        () => uploadArtifact(artifact),
        { maxRetries: 2, baseDelayMs: 1000, label: 'IPFS upload' },
      );
      ipfsCid = ipfsResult.cid;
      ipfsUri = ipfsResult.uri;
      result.artifactIpfsCid = ipfsCid;
      result.artifactIpfsUri = ipfsUri;
      log.info('Artifact uploaded to IPFS', { cid: ipfsCid });
    } catch (err: any) {
      log.warn('IPFS upload failed — continuing without artifact', { error: err.message?.slice(0, 80) });
    }

    // ── Done ──
    result.success = true;
    result.executionTimeMs = Date.now() - start;

    log.info(`Trade executed successfully in ${result.executionTimeMs}ms`, {
      intentHash: submission.intentHash,
      approved: true,
      artifactCid: ipfsCid || 'none',
    });

    return result;

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.executionTimeMs = Date.now() - start;
    log.error('Trade execution failed', { error: result.error });
    return result;
  }
}

// ──── Hackathon Vault ────

const VAULT_ABI = [
  'function claimAllocation(uint256 agentId) external',
  'function getBalance(uint256 agentId) external view returns (uint256)',
  'function hasClaimed(uint256 agentId) external view returns (bool)',
  'function allocationPerTeam() external view returns (uint256)',
];

/**
 * Claim sandbox capital from the HackathonVault.
 * Every team gets 0.05 ETH — one claim per agentId.
 */
export async function claimSandboxCapital(): Promise<string> {
  if (!config.hackathonVaultAddress) {
    log.warn('HACKATHON_VAULT_ADDRESS not set — skipping claim');
    return '';
  }
  if (!config.agentId) {
    log.warn('AGENT_ID not set — cannot claim vault');
    return '';
  }

  const wallet = getWallet();
  const vault = new ethers.Contract(config.hackathonVaultAddress, VAULT_ABI, wallet);

  // Check if already claimed
  try {
    const claimed = await vault.hasClaimed(config.agentId);
    if (claimed) {
      log.info('Sandbox capital already claimed');
      const balance = await vault.getBalance(config.agentId);
      log.info('Vault balance', { eth: ethers.formatEther(balance) });
      return 'already_claimed';
    }
  } catch { /* hasClaimed might not exist — proceed to claim */ }

  log.info('Claiming sandbox capital...', { agentId: config.agentId });
  const tx = await vault.claimAllocation(config.agentId);
  const receipt = await retry(
    async () => {
      const r = await tx.wait();
      if (!r) throw new Error('No receipt');
      return r;
    },
    { maxRetries: 3, baseDelayMs: 3000, label: 'Vault claim wait' },
  );

  log.info('Sandbox capital claimed!', { txHash: receipt.hash });
  return receipt.hash;
}

/**
 * Check sandbox balance in the vault
 */
export async function getSandboxBalance(): Promise<string> {
  if (!config.hackathonVaultAddress || !config.agentId) return '0';

  try {
    const wallet = getWallet();
    const vault = new ethers.Contract(config.hackathonVaultAddress, VAULT_ABI, wallet);
    const balance = await vault.getBalance(config.agentId);
    return ethers.formatEther(balance);
  } catch (error) {
    log.error('Failed to check sandbox balance', { error: String(error) });
    return '0';
  }
}

/**
 * Pre-flight check — verify everything is ready for trading.
 */
export async function preflight(): Promise<{ ready: boolean; issues: string[] }> {
  const issues: string[] = [];

  // Check wallet
  try {
    initChain();
    const address = getWalletAddress();
    log.info(`Wallet: ${address}`);
  } catch {
    issues.push('Wallet not configured — set PRIVATE_KEY in .env');
  }

  // Check balance
  try {
    const bal = await getBalance();
    if (parseFloat(bal) < 0.001) {
      issues.push(`Insufficient ETH for gas: ${bal} ETH (need > 0.001)`);
    } else {
      log.info(`Balance: ${bal} ETH`);
    }
  } catch {
    issues.push('Cannot check balance — RPC connection failed');
  }

  // Check hackathon contracts
  if (!config.riskRouterAddress) {
    issues.push('RISK_ROUTER_ADDRESS not set');
  }
  if (!config.agentId) {
    issues.push('AGENT_ID not set — register on AgentRegistry first');
  }
  if (!config.hackathonVaultAddress) {
    issues.push('HACKATHON_VAULT_ADDRESS not set');
  }

  // Check Validation Registry
  if (!config.validationRegistry) {
    issues.push('VALIDATION_REGISTRY not set');
  }

  // Check IPFS
  if (!config.pinataJwt) {
    issues.push('PINATA_JWT not set — artifacts will use mock IPFS');
  }

  if (issues.length > 0) {
    issues.forEach(i => log.warn(`Preflight: ${i}`));
  } else {
    log.info('Preflight passed — ready to trade on hackathon sandbox');
  }

  return { ready: issues.length === 0, issues };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
