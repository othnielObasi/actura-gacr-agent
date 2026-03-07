/**
 * Config Validator
 * Validates configuration at startup and provides clear error messages
 */

import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('CONFIG');

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateConfig(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required for on-chain operations
  if (!config.privateKey) {
    warnings.push('PRIVATE_KEY not set — on-chain operations disabled (simulation mode)');
  } else if (config.privateKey.length < 64) {
    errors.push('PRIVATE_KEY must be 64 hex characters (256-bit)');
  }

  // Network
  if (!config.rpcUrl) {
    errors.push('RPC_URL is required');
  }
  if (config.chainId !== 84532) {
    warnings.push(`CHAIN_ID is ${config.chainId}, expected 84532 (Base Sepolia)`);
  }

  // Trading params sanity checks
  if (config.maxPositionPct <= 0 || config.maxPositionPct > 1) {
    errors.push(`MAX_POSITION_PCT must be between 0-100, got ${config.maxPositionPct * 100}`);
  }
  if (config.maxDailyLossPct <= 0 || config.maxDailyLossPct > 0.5) {
    errors.push(`MAX_DAILY_LOSS_PCT must be between 0-50, got ${config.maxDailyLossPct * 100}`);
  }
  if (config.maxDrawdownPct <= 0 || config.maxDrawdownPct > 0.5) {
    errors.push(`MAX_DRAWDOWN_PCT must be between 0-50, got ${config.maxDrawdownPct * 100}`);
  }
  if (config.tradingIntervalMs < 1000) {
    warnings.push(`TRADING_INTERVAL_MS is very low (${config.tradingIntervalMs}ms) — may hit rate limits`);
  }

  // Strategy params
  if (config.strategy.smaFast >= config.strategy.smaSlow) {
    errors.push(`SMA fast period (${config.strategy.smaFast}) must be less than slow (${config.strategy.smaSlow})`);
  }
  if (config.strategy.basePositionPct > config.maxPositionPct) {
    warnings.push('Base position size exceeds max position — will always be capped');
  }
  if (config.strategy.stopLossAtrMultiple <= 0) {
    errors.push('Stop loss ATR multiple must be positive');
  }

  // IPFS
  if (!config.pinataJwt) {
    warnings.push('PINATA_JWT not set — IPFS uploads will use mock (local hash)');
  }

  // Registries
  if (!config.identityRegistry) {
    warnings.push('IDENTITY_REGISTRY not set — registration disabled');
  }

  // Log results
  if (errors.length > 0) {
    errors.forEach(e => log.error(`Validation error: ${e}`));
  }
  if (warnings.length > 0) {
    warnings.forEach(w => log.warn(`Validation warning: ${w}`));
  }
  if (errors.length === 0) {
    log.info('Configuration validated successfully');
  }

  return { valid: errors.length === 0, errors, warnings };
}
