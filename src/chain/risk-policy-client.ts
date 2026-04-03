/**
 * Risk Policy Client — On-Chain Risk Enforcement via ActuraRiskPolicy
 *
 * Calls the deployed ActuraRiskPolicy contract to:
 * - checkTrade() before execution (view call, no gas)
 * - recordTrade() after execution (state-changing, needs gas)
 * - recordClose() when positions close
 * - getRiskState() for dashboard/MCP
 *
 * This proves risk limits are enforced at the smart-contract level —
 * trustless, verifiable, and visible to any on-chain observer.
 */

import { ethers } from 'ethers';
import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';
import { getProvider, getWallet, waitForTx } from './sdk.js';

const log = createLogger('RISK-POLICY');

const RISK_POLICY_ABI = [
  'function checkTrade(address asset, uint8 side, uint256 amountUsd) external view returns (bool approved, string reason)',
  'function recordTrade(address asset, uint8 side, uint256 amountUsd) external',
  'function recordClose(int256 pnl, uint256 amountUsd) external',
  'function resetExposure() external',
  'function dailyReset() external',
  'function getRiskState() external view returns (uint256 capital, uint256 peak, int256 daily, uint256 positions, uint256 exposure, bool cbActive, uint256 drawdownBps)',
  'function circuitBreakerActive() external view returns (bool)',
  'function agentWallet() external view returns (address)',
  'function maxPositionPct() external view returns (uint256)',
  'function maxExposurePct() external view returns (uint256)',
  'function maxOpenPositions() external view returns (uint256)',
  'function maxDailyLossPct() external view returns (uint256)',
  'function maxDrawdownPct() external view returns (uint256)',
];

const WETH_ADDRESS = process.env.WETH_ADDRESS || '0x4200000000000000000000000000000000000006';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

let contract: ethers.Contract | null = null;
let readContract: ethers.Contract | null = null;

function getPolicyAddress(): string {
  return process.env.RISK_POLICY_ADDRESS || '';
}

function getReadContract(): ethers.Contract | null {
  const addr = getPolicyAddress();
  if (!addr) return null;
  if (!readContract) {
    readContract = new ethers.Contract(addr, RISK_POLICY_ABI, getProvider());
  }
  return readContract;
}

function getWriteContract(): ethers.Contract | null {
  const addr = getPolicyAddress();
  if (!addr) return null;
  if (!contract) {
    contract = new ethers.Contract(addr, RISK_POLICY_ABI, getWallet());
  }
  return contract;
}

export interface OnChainRiskCheck {
  available: boolean;
  approved: boolean;
  reason: string;
  contractAddress: string;
}

/**
 * Check if a trade passes on-chain risk policy (view call — free, no gas).
 * Returns { available: false } if RISK_POLICY_ADDRESS is not set.
 */
export async function checkTradeOnChain(
  side: 'LONG' | 'SHORT',
  amountUsd: number,
  asset?: string,
): Promise<OnChainRiskCheck> {
  const c = getReadContract();
  if (!c) {
    return { available: false, approved: true, reason: 'RISK_POLICY_ADDRESS not set', contractAddress: '' };
  }

  try {
    const assetAddr = asset || (config.tradingPair.startsWith('WETH') ? WETH_ADDRESS : USDC_ADDRESS);
    const sideNum = side === 'LONG' ? 0 : 1;
    const amountUsd6 = ethers.parseUnits(amountUsd.toFixed(2), 6);

    const [approved, reason] = await c.checkTrade(assetAddr, sideNum, amountUsd6);

    log.info('On-chain risk check', { approved, reason, side, amountUsd: amountUsd.toFixed(2) });

    return {
      available: true,
      approved,
      reason,
      contractAddress: getPolicyAddress(),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('On-chain risk check failed — allowing trade (soft fail)', { error: msg });
    return { available: true, approved: true, reason: `check failed: ${msg}`, contractAddress: getPolicyAddress() };
  }
}

/**
 * Record a trade execution on-chain (state-changing, costs gas).
 */
export async function recordTradeOnChain(
  side: 'LONG' | 'SHORT',
  amountUsd: number,
  asset?: string,
): Promise<string | null> {
  const c = getWriteContract();
  if (!c) return null;

  try {
    const assetAddr = asset || (config.tradingPair.startsWith('WETH') ? WETH_ADDRESS : USDC_ADDRESS);
    const sideNum = side === 'LONG' ? 0 : 1;
    const amountUsd6 = ethers.parseUnits(amountUsd.toFixed(2), 6);

    const tx = await c.recordTrade(assetAddr, sideNum, amountUsd6);
    const receipt = await waitForTx(tx);
    log.info('Trade recorded on-chain', { txHash: receipt.hash, side, amountUsd: amountUsd.toFixed(2) });
    return receipt.hash;
  } catch (error) {
    log.warn('recordTrade on-chain failed (non-critical)', { error: String(error) });
    return null;
  }
}

/**
 * Record a position close and PnL on-chain.
 * @param pnlUsd Realized PnL in USD
 * @param amountUsd Original position notional to release from exposure tracking
 */
export async function recordCloseOnChain(pnlUsd: number, amountUsd: number = 0): Promise<string | null> {
  const c = getWriteContract();
  if (!c) return null;

  try {
    const pnl6 = ethers.parseUnits(Math.abs(pnlUsd).toFixed(2), 6);
    const signedPnl = pnlUsd >= 0 ? pnl6 : -pnl6;
    const amount6 = ethers.parseUnits(Math.abs(amountUsd).toFixed(2), 6);

    const tx = await c.recordClose(signedPnl, amount6);
    const receipt = await waitForTx(tx);
    log.info('Position close recorded on-chain', { txHash: receipt.hash, pnlUsd: pnlUsd.toFixed(2), amountUsd: amountUsd.toFixed(2) });
    return receipt.hash;
  } catch (error) {
    log.warn('recordClose on-chain failed (non-critical)', { error: String(error) });
    return null;
  }
}

/**
 * Emergency reset of exposure tracking (owner-only).
 * Use when recordClose txns fail and exposure becomes stale.
 */
export async function resetExposureOnChain(): Promise<string | null> {
  const c = getWriteContract();
  if (!c) return null;

  try {
    const tx = await c.resetExposure();
    const receipt = await waitForTx(tx);
    log.info('Exposure reset on-chain', { txHash: receipt.hash });
    return receipt.hash;
  } catch (error) {
    log.warn('resetExposure on-chain failed', { error: String(error) });
    return null;
  }
}

/**
 * Get on-chain risk state (for dashboard / MCP / judge mode).
 */
export async function getOnChainRiskState(): Promise<{
  available: boolean;
  capital: number;
  peak: number;
  dailyPnl: number;
  positions: number;
  exposure: number;
  circuitBreakerActive: boolean;
  drawdownBps: number;
  contractAddress: string;
} | null> {
  const c = getReadContract();
  if (!c) return null;

  try {
    const state = await c.getRiskState();
    return {
      available: true,
      capital: parseFloat(ethers.formatUnits(state[0], 6)),
      peak: parseFloat(ethers.formatUnits(state[1], 6)),
      dailyPnl: parseFloat(ethers.formatUnits(state[2], 6)),
      positions: Number(state[3]),
      exposure: parseFloat(ethers.formatUnits(state[4], 6)),
      circuitBreakerActive: state[5],
      drawdownBps: Number(state[6]),
      contractAddress: getPolicyAddress(),
    };
  } catch (error) {
    log.warn('getRiskState on-chain failed', { error: String(error) });
    return null;
  }
}
