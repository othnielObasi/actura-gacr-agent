/**
 * EIP-1271 — Smart Contract Signature Verification
 *
 * Standard interface for verifying signatures from smart-contract wallets
 * (e.g. multisigs, account-abstraction wallets, agent contracts).
 *
 * When the agent receives a signed message from an address, this module
 * determines whether that address is an EOA or a contract, then uses
 * the appropriate verification method:
 *   - EOA: standard ECDSA recovery (ethers.verifyMessage / verifyTypedData)
 *   - Contract: EIP-1271 isValidSignature(bytes32, bytes) call
 *
 * EIP-1271 magic value: 0x1626ba7e (valid), anything else = invalid.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-1271
 */

import { ethers } from 'ethers';
import { getProvider } from './sdk.js';
import { createLogger } from '../agent/logger.js';

const log = createLogger('EIP-1271');

/** EIP-1271 magic value returned on success */
export const EIP1271_MAGIC_VALUE = '0x1626ba7e';

/** Minimal EIP-1271 ABI */
const EIP1271_ABI = [
  'function isValidSignature(bytes32 hash, bytes signature) external view returns (bytes4)',
];

export interface SignatureVerification {
  valid: boolean;
  signer: string;
  method: 'eoa' | 'eip1271';
  reason: string;
}

/**
 * Check if an address is a smart contract (has deployed code).
 */
export async function isContract(address: string): Promise<boolean> {
  const provider = getProvider();
  const code = await provider.getCode(address);
  return code !== '0x' && code.length > 2;
}

/**
 * Verify a signature using EIP-1271 (smart-contract wallet).
 * Calls isValidSignature(hash, signature) on the contract.
 */
export async function verifyEIP1271Signature(
  contractAddress: string,
  hash: string,
  signature: string,
): Promise<boolean> {
  const provider = getProvider();
  const contract = new ethers.Contract(contractAddress, EIP1271_ABI, provider);

  try {
    const result: string = await contract.isValidSignature(hash, signature);
    const isValid = result.toLowerCase() === EIP1271_MAGIC_VALUE;
    log.info('EIP-1271 verification', {
      contract: contractAddress,
      valid: isValid,
      returnedValue: result,
    });
    return isValid;
  } catch (error) {
    log.warn('EIP-1271 call failed', {
      contract: contractAddress,
      error: String(error),
    });
    return false;
  }
}

/**
 * Verify a raw message signature from either an EOA or smart-contract wallet.
 * Automatically detects whether the signer is a contract and uses the
 * appropriate verification method.
 */
export async function verifySignature(
  expectedSigner: string,
  messageHash: string,
  signature: string,
): Promise<SignatureVerification> {
  // First check if the expected signer is a contract
  const signerIsContract = await isContract(expectedSigner);

  if (signerIsContract) {
    // EIP-1271: ask the contract if the signature is valid
    const valid = await verifyEIP1271Signature(expectedSigner, messageHash, signature);
    return {
      valid,
      signer: expectedSigner,
      method: 'eip1271',
      reason: valid
        ? 'Contract wallet confirmed signature via isValidSignature()'
        : 'Contract wallet rejected signature (invalid magic value or revert)',
    };
  }

  // EOA: recover signer from signature
  try {
    const recovered = ethers.recoverAddress(messageHash, signature);
    const valid = recovered.toLowerCase() === expectedSigner.toLowerCase();
    return {
      valid,
      signer: recovered,
      method: 'eoa',
      reason: valid
        ? 'EOA signature verified via ECDSA recovery'
        : `Recovered ${recovered} but expected ${expectedSigner}`,
    };
  } catch (error) {
    return {
      valid: false,
      signer: expectedSigner,
      method: 'eoa',
      reason: `ECDSA recovery failed: ${String(error)}`,
    };
  }
}

/**
 * Verify an EIP-712 typed data signature from either an EOA or contract wallet.
 */
export async function verifyTypedDataSignature(
  expectedSigner: string,
  domain: ethers.TypedDataDomain,
  types: Record<string, ethers.TypedDataField[]>,
  value: Record<string, unknown>,
  signature: string,
): Promise<SignatureVerification> {
  const signerIsContract = await isContract(expectedSigner);

  if (signerIsContract) {
    // EIP-1271: hash the typed data and verify via contract
    const hash = ethers.TypedDataEncoder.hash(domain, types, value);
    const valid = await verifyEIP1271Signature(expectedSigner, hash, signature);
    return {
      valid,
      signer: expectedSigner,
      method: 'eip1271',
      reason: valid
        ? 'Contract wallet confirmed EIP-712 signature via isValidSignature()'
        : 'Contract wallet rejected EIP-712 signature',
    };
  }

  // EOA: standard typed data verification
  try {
    const recovered = ethers.verifyTypedData(domain, types, value, signature);
    const valid = recovered.toLowerCase() === expectedSigner.toLowerCase();
    return {
      valid,
      signer: recovered,
      method: 'eoa',
      reason: valid
        ? 'EOA EIP-712 signature verified via ECDSA recovery'
        : `Recovered ${recovered} but expected ${expectedSigner}`,
    };
  } catch (error) {
    return {
      valid: false,
      signer: expectedSigner,
      method: 'eoa',
      reason: `EIP-712 verification failed: ${String(error)}`,
    };
  }
}
