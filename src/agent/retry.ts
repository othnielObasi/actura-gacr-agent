/**
 * Retry with exponential backoff
 * Used for IPFS uploads, chain interactions, and any external call
 */

import { createLogger } from './logger.js';

const log = createLogger('RETRY');

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  label?: string;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const label = opts.label || 'operation';

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < opts.maxRetries) {
        const delay = Math.min(
          opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
          opts.maxDelayMs
        );
        log.warn(`${label} failed (attempt ${attempt + 1}/${opts.maxRetries + 1}), retrying in ${Math.round(delay)}ms`, {
          error: lastError.message,
        });
        await sleep(delay);
      }
    }
  }

  log.error(`${label} failed after ${opts.maxRetries + 1} attempts`, {
    error: lastError?.message,
  });
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
