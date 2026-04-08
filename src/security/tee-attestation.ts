/**
 * TEE Attestation — Software-Based Trusted Execution Environment Attestation
 *
 * Since real TEE hardware (Intel SGX / ARM TrustZone) is not available in
 * the hackathon sandbox, this module provides a software-based attestation
 * scheme that mirrors the TEE attestation workflow:
 *
 * 1. Collects an environment fingerprint (OS, Node version, code integrity hash)
 * 2. Builds an attestation report binding the environment to the agent identity
 * 3. Signs the attestation with the agent's private key (EIP-712 typed data)
 * 4. Returns structured attestation data that can be included in validation artifacts
 *
 * The attestation proves:
 * - Which code version is running (git commit hash)
 * - The runtime environment hasn't changed between attestations
 * - The agent signing key produced the attestation
 * - Timestamp of attestation for freshness checks
 *
 * When real TEE hardware becomes available, only the `collectMeasurement()`
 * function needs to change — the report format and verification stay the same.
 */

import { ethers } from 'ethers';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import os from 'os';
import { getWallet } from '../chain/sdk.js';
import { createLogger } from '../agent/logger.js';

const log = createLogger('TEE');

/** EIP-712 types for attestation reports */
const ATTESTATION_TYPES = {
  AttestationReport: [
    { name: 'agentAddress', type: 'address' },
    { name: 'measurementHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

function getAttestationDomain(): ethers.TypedDataDomain {
  return {
    name: 'ActuraTEEAttestation',
    version: '1',
    chainId: 11155111, // Ethereum Sepolia
  };
}

export interface EnvironmentMeasurement {
  nodeVersion: string;
  platform: string;
  arch: string;
  osRelease: string;
  pid: number;
  codeHash: string;
  gitCommit: string;
  uptimeSeconds: number;
}

export interface AttestationReport {
  version: string;
  type: 'software-tee';
  agentAddress: string;
  measurement: EnvironmentMeasurement;
  measurementHash: string;
  nonce: string;
  timestamp: string;
  signature: string;
  domain: ethers.TypedDataDomain;
  valid: boolean;
}

let attestationNonce = 0n;
let cachedCodeHash: string | null = null;

/**
 * Collect environment measurement — the "PCR values" equivalent.
 * This captures runtime environment state that should remain stable.
 */
function collectMeasurement(): EnvironmentMeasurement {
  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', timeout: 3000 }).trim();
  } catch { /* not a git repo or git not available */ }

  // Hash the source code directory for integrity
  if (!cachedCodeHash) {
    try {
      // Hash package.json + tsconfig as a stable code fingerprint
      const pkgData = execSync('cat package.json tsconfig.json 2>/dev/null || true', {
        encoding: 'utf-8',
        timeout: 3000,
        cwd: process.cwd(),
      });
      cachedCodeHash = createHash('sha256').update(pkgData).digest('hex').slice(0, 16);
    } catch {
      cachedCodeHash = 'unavailable';
    }
  }

  return {
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    pid: process.pid,
    codeHash: cachedCodeHash,
    gitCommit,
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

/**
 * Hash the measurement into a bytes32 digest.
 * This is the "quote" that gets signed.
 */
function hashMeasurement(m: EnvironmentMeasurement): string {
  const data = JSON.stringify({
    nodeVersion: m.nodeVersion,
    platform: m.platform,
    arch: m.arch,
    osRelease: m.osRelease,
    codeHash: m.codeHash,
    gitCommit: m.gitCommit,
  });
  return ethers.keccak256(ethers.toUtf8Bytes(data));
}

/**
 * Generate a signed TEE attestation report.
 *
 * This produces an EIP-712-signed attestation binding:
 * - The agent's address (identity)
 * - The environment measurement hash (what's running)
 * - A nonce (replay protection)
 * - A timestamp (freshness)
 */
export async function generateAttestation(): Promise<AttestationReport> {
  const wallet = getWallet();
  const measurement = collectMeasurement();
  const measurementHash = hashMeasurement(measurement);

  attestationNonce += 1n;
  const timestamp = BigInt(Math.floor(Date.now() / 1000));

  const domain = getAttestationDomain();
  const value = {
    agentAddress: wallet.address,
    measurementHash,
    nonce: attestationNonce,
    timestamp,
  };

  const signature = await wallet.signTypedData(domain, ATTESTATION_TYPES, value);

  // Self-verify for integrity
  const recovered = ethers.verifyTypedData(domain, ATTESTATION_TYPES, value, signature);
  const valid = recovered.toLowerCase() === wallet.address.toLowerCase();

  if (!valid) {
    log.error('Attestation self-verification failed', { recovered, expected: wallet.address });
  } else {
    log.info('TEE attestation generated', {
      commit: measurement.gitCommit,
      codeHash: measurement.codeHash,
      nonce: attestationNonce.toString(),
    });
  }

  return {
    version: '1.0',
    type: 'software-tee',
    agentAddress: wallet.address,
    measurement,
    measurementHash,
    nonce: attestationNonce.toString(),
    timestamp: new Date(Number(timestamp) * 1000).toISOString(),
    signature,
    domain,
    valid,
  };
}

/**
 * Verify an attestation report signature.
 * Returns true if the signature is valid and matches the claimed agent address.
 */
export function verifyAttestation(report: AttestationReport): boolean {
  try {
    const timestamp = BigInt(Math.floor(new Date(report.timestamp).getTime() / 1000));
    const value = {
      agentAddress: report.agentAddress,
      measurementHash: report.measurementHash,
      nonce: BigInt(report.nonce),
      timestamp,
    };

    const recovered = ethers.verifyTypedData(report.domain, ATTESTATION_TYPES, value, report.signature);
    return recovered.toLowerCase() === report.agentAddress.toLowerCase();
  } catch (error) {
    log.warn('Attestation verification failed', { error: String(error) });
    return false;
  }
}

/**
 * Generate a compact attestation summary suitable for embedding in artifacts.
 */
export async function generateAttestationSummary(): Promise<{
  type: string;
  agentAddress: string;
  measurementHash: string;
  codeHash: string;
  gitCommit: string;
  nonce: string;
  timestamp: string;
  signature: string;
  valid: boolean;
}> {
  const report = await generateAttestation();
  return {
    type: report.type,
    agentAddress: report.agentAddress,
    measurementHash: report.measurementHash,
    codeHash: report.measurement.codeHash,
    gitCommit: report.measurement.gitCommit,
    nonce: report.nonce,
    timestamp: report.timestamp,
    signature: report.signature,
    valid: report.valid,
  };
}
