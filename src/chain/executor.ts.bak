/**
 * Trade Executor — Hackathon Execution Flow
 * 
 * The hackathon provides:
 * - Capital Vault: funded sub-account (claim sandbox first)
 * - Risk Router: submit signed TradeIntents, it handles execution
 * - Validation Registry: post validation artifacts
 * - Reputation Registry: post performance feedback
 * 
 * Our execution flow:
 * 1. Build TradeIntent from strategy output
 * 2. Sign with EIP-712
 * 3. Submit to Risk Router (it executes the swap)
 * 4. Upload validation artifact to IPFS
 * 5. Submit validation request + response on-chain
 * 6. Post reputation feedback
 * 
 * We do NOT:
 * - Interact with DEX directly (Risk Router does it)
 * - Manage tokens (Capital Vault does it)
 * - Enforce position limits on-chain (Risk Router does it)
 */

import { ethers } from 'ethers';
import { createLogger } from '../agent/logger.js';
import { retry } from '../agent/retry.js';
import { config } from '../agent/config.js';
import { getWallet, getWalletAddress, getBalance, initChain } from './sdk.js';
import { buildTradeIntent, signTradeIntent, TRADE_INTENT_TYPES, getTradeIntentDomain, type TradeIntentData } from './intent.js';
import { verifyTypedDataSignature } from './eip1271.js';
import { submitTradeIntent, getIntentStatus, claimSandbox } from './risk-router.js';
import { validateTradeArtifact, computeRequestHash } from './validation.js';
import { buildFeedbackJson, postTradeOutcomeFeedback } from './reputation.js';
import { simulateExecution } from './execution-simulator.js';
import { uploadArtifact, uploadJson } from '../trust/ipfs.js';
import type { ValidationArtifact } from '../trust/artifact-emitter.js';
import type { StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision } from '../risk/engine.js';

const log = createLogger('EXECUTOR');

// Standard addresses on Base Sepolia — will be updated when hackathon publishes them
const WETH_ADDRESS = process.env.WETH_ADDRESS || '0x4200000000000000000000000000000000000006';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

export interface ExecutionResult {
  success: boolean;
  intentId: string | null;
  intentTxHash: string | null;
  intentStatus: string | null;
  validationRequestHash: string | null;
  validationTxHash: string | null;
  reputationTxHash: string | null;
  artifactIpfsCid: string | null;
  artifactIpfsUri: string | null;
  error: string | null;
  executionTimeMs: number;
}

/**
 * Full trade execution pipeline
 * Called when a trade is approved by the local risk engine
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
    intentId: null,
    intentTxHash: null,
    intentStatus: null,
    validationRequestHash: null,
    validationTxHash: null,
    reputationTxHash: null,
    artifactIpfsCid: null,
    artifactIpfsUri: null,
    error: null,
    executionTimeMs: 0,
  };

  try {
    // ── Step 0: Pre-trade execution simulation ──
    const simulation = simulateExecution({ strategyOutput, riskDecision });
    if (!simulation.allowed) {
      result.error = `Execution simulation blocked trade: ${simulation.reason}`;
      result.executionTimeMs = Date.now() - start;
      log.warn('Execution simulation blocked trade', simulation);
      return result;
    }

  // ── Step 1: Build TradeIntent ──
    log.info('Building TradeIntent...');

    const assetAddress = config.tradingPair.startsWith('WETH') ? WETH_ADDRESS : USDC_ADDRESS;
    const side = strategyOutput.signal.direction as 'LONG' | 'SHORT';

    // Convert position size to wei (18 decimals for WETH)
    const amountWei = ethers.parseEther(riskDecision.finalPositionSize.toFixed(18));

    const intent = buildTradeIntent({
      assetAddress,
      side,
      amountWei,
      slippageBps: 50,         // 0.5% max slippage
      deadlineSeconds: 300,     // 5 minute deadline
      reasoning: (artifact as any).aiReasoning?.summary ?? '',
    });

    // ── Step 2: Sign with EIP-712 ──
    log.info('Signing TradeIntent (EIP-712)...');
    const { signature, domain } = await signTradeIntent(intent);
    log.info('Intent signed', { nonce: intent.nonce.toString() });

    // ── Step 2b: EIP-1271 signature verification ──
    log.info('Verifying signature (EIP-1271 aware)...');
    const wallet = getWallet();
    const verification = await verifyTypedDataSignature(
      wallet.address,
      domain,
      TRADE_INTENT_TYPES,
      intent as unknown as Record<string, unknown>,
      signature,
    );
    if (!verification.valid) {
      result.error = `EIP-1271 signature verification failed: ${verification.reason}`;
      result.executionTimeMs = Date.now() - start;
      log.error('Signature verification failed', verification);
      return result;
    }
    log.info('Signature verified', { method: verification.method, signer: verification.signer });

    // ── Step 3: Submit to Risk Router ──
    log.info('Submitting to Risk Router...');
    const { intentId, txHash } = await retry(
      () => submitTradeIntent(intent, signature),
      { maxRetries: 2, baseDelayMs: 2000, label: 'Risk Router submit' }
    );

    result.intentId = intentId;
    result.intentTxHash = txHash;
    log.info('Intent submitted', { intentId, txHash });

    // ── Step 4: Check execution status ──
    // Give the Risk Router a moment to process
    await sleep(2000);

    const status = await retry(
      () => getIntentStatus(intentId),
      { maxRetries: 3, baseDelayMs: 1000, label: 'Intent status check' }
    );
    result.intentStatus = status;

    if (status === 'REJECTED' || status === 'EXPIRED') {
      log.warn(`Intent ${status} by Risk Router`, { intentId });
      result.error = `Risk Router ${status.toLowerCase()} the intent`;
      result.executionTimeMs = Date.now() - start;
      return result;
    }

    log.info(`Intent status: ${status}`, { intentId });

    // ── Step 5: Upload validation artifact to IPFS ──
    log.info('Uploading validation artifact to IPFS...');
    const ipfsResult = await retry(
      () => uploadArtifact(artifact),
      { maxRetries: 2, baseDelayMs: 1000, label: 'IPFS artifact upload' }
    );
    result.artifactIpfsCid = ipfsResult.cid;
    result.artifactIpfsUri = ipfsResult.uri;
    log.info('Artifact uploaded', { cid: ipfsResult.cid });

    // ── Step 6: Submit validation on-chain ──
    log.info('Submitting validation on-chain...');
    const validatorKey = process.env.VALIDATOR_PRIVATE_KEY;
    if (validatorKey) {
      const validation = await retry(
        () => validateTradeArtifact(
          agentId,
          validatorKey,
          ipfsResult.uri,
          artifact as object,
          riskDecision.checks,
        ),
        { maxRetries: 2, baseDelayMs: 2000, label: 'Validation submission' }
      );
      result.validationRequestHash = validation.requestHash;
      result.validationTxHash = validation.responseTx;
      log.info('Validation submitted', {
        requestHash: validation.requestHash,
        score: validation.score,
      });
    } else {
      log.warn('VALIDATOR_PRIVATE_KEY not set — skipping on-chain validation');
    }

    // ── Step 7: Post reputation feedback ──
    const reviewerKey = process.env.REVIEWER_PRIVATE_KEY || process.env.VALIDATOR_PRIVATE_KEY;
    if (reviewerKey) {
      // Estimate realized yield from signal confidence and position sizing
      // When Risk Router returns fill prices, replace with actual PnL
      const conf = strategyOutput.signal.confidence;
      const dir = strategyOutput.signal.direction === 'LONG' ? 1 : -1;
      const realizedYieldPct = dir * (conf - 0.5) * riskDecision.finalPositionSize * 0.01;
      result.reputationTxHash = await retry(
        () => postTradeOutcomeFeedback(reviewerKey, agentId, {
          yieldPercent: realizedYieldPct,
          period: 'day',
          artifactUri: ipfsResult.uri,
        }),
        { maxRetries: 2, baseDelayMs: 1500, label: 'Reputation submission' }
      );
      log.info('Reputation feedback submitted', { txHash: result.reputationTxHash });
    } else {
      log.warn('REVIEWER_PRIVATE_KEY not set — skipping on-chain reputation feedback');
    }

    // ── Done ──
    result.success = true;
    result.executionTimeMs = Date.now() - start;

    log.info(`Trade executed successfully in ${result.executionTimeMs}ms`, {
      intentId,
      status,
      artifactCid: ipfsResult.cid,
    });

    return result;

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.executionTimeMs = Date.now() - start;
    log.error('Trade execution failed', { error: result.error });
    return result;
  }
}

/**
 * Claim sandbox capital from the hackathon vault
 * Call once after registration
 */
export async function claimSandboxCapital(): Promise<string> {
  log.info('Claiming sandbox capital from vault...');

  const txHash = await retry(
    () => claimSandbox(),
    { maxRetries: 3, baseDelayMs: 3000, label: 'Sandbox claim' }
  );

  log.info('Sandbox capital claimed!', { txHash });
  return txHash;
}

/**
 * Pre-flight check — verify everything is ready for trading
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

  // Check Risk Router
  if (!config.riskRouterAddress) {
    issues.push('RISK_ROUTER_ADDRESS not set — wait for hackathon to publish');
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
    log.info('Preflight passed — ready to trade');
  }

  return { ready: issues.length === 0, issues };
}

/**
 * Capital Vault ABI — claim sandbox sub-account
 */
const VAULT_ABI = [
  'function claimSandbox(address agent) external',
  'function getBalance(address agent) external view returns (uint256)',
  'event SandboxClaimed(address indexed agent, uint256 amount)',
];

/**
 * Check sandbox balance in the vault
 */
export async function getSandboxBalance(): Promise<string> {
  if (!config.capitalVaultAddress) {
    log.warn('CAPITAL_VAULT_ADDRESS not set');
    return '0';
  }

  try {
    const wallet = getWallet();
    const vault = new ethers.Contract(config.capitalVaultAddress, VAULT_ABI, wallet);
    const balance = await vault.getBalance(wallet.address);
    return ethers.formatUnits(balance, 6);  // USDC has 6 decimals
  } catch (error) {
    log.error('Failed to check sandbox balance', { error: String(error) });
    return '0';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
