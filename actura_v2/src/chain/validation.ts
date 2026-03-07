/**
 * ERC-8004 Validation Registry — v1.0 Spec Compliant
 * 
 * Key concepts:
 * - Agent requests validation by specifying a validatorAddress
 * - Only that validatorAddress can call validationResponse
 * - Agent CANNOT validate itself (enforced by contract)
 * - Response is 0-100 (binary: 0=fail, 100=pass; or spectrum)
 * - Multiple responses per request are allowed (e.g. soft/hard finality)
 * 
 * For the hackathon, we use a second wallet as our "validator"
 * that independently confirms trade artifact integrity.
 * 
 * Spec: https://eips.ethereum.org/EIPS/eip-8004#validation-registry
 */

import { ethers } from 'ethers';
import { config } from '../agent/config.js';
import { getWallet, getProvider, waitForTx } from './sdk.js';
import { createLogger } from '../agent/logger.js';

const log = createLogger('VALIDATION');

// v1.0 ABI
const VALIDATION_ABI = [
  // Write
  'function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash) external',
  'function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external',

  // Read
  'function getValidationStatus(bytes32 requestHash) external view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
  'function getSummary(uint256 agentId, address[] validatorAddresses, string tag) external view returns (uint64 count, uint8 averageResponse)',
  'function getAgentValidations(uint256 agentId) external view returns (bytes32[])',
  'function getValidatorRequests(address validatorAddress) external view returns (bytes32[])',

  // Events
  'event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)',
  'event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)',
];

let contract: ethers.Contract | null = null;


export interface ValidationRequestPayload {
  validatorAddress: string;
  agentId: number;
  requestURI: string;
  requestHash: string;
  artifactType: string;
  createdAt: string;
}

export function buildValidationRequestPayload(params: {
  validatorAddress: string;
  agentId: number;
  requestURI: string;
  artifactType?: string;
  input: object;
}): ValidationRequestPayload {
  return {
    validatorAddress: params.validatorAddress,
    agentId: params.agentId,
    requestURI: params.requestURI,
    requestHash: computeRequestHash(params.input),
    artifactType: params.artifactType || 'trade-artifact',
    createdAt: new Date().toISOString(),
  };
}

function getContract(): ethers.Contract {
  if (!contract) {
    if (!config.validationRegistry) throw new Error('VALIDATION_REGISTRY address not set');
    contract = new ethers.Contract(config.validationRegistry, VALIDATION_ABI, getWallet());
  }
  return contract;
}

/**
 * Compute requestHash = keccak256 of the request payload
 * Must be globally unique per the RI
 */
export function computeRequestHash(data: object): string {
  const json = JSON.stringify(data, Object.keys(data).sort());
  return ethers.keccak256(ethers.toUtf8Bytes(json));
}

/**
 * Submit a validation request
 * Called by the agent (owner of agentId)
 * 
 * @param validatorAddress - WHO will validate (must be a different address)
 * @param agentId - The agent being validated
 * @param requestURI - IPFS URI containing all info needed for validation
 * @param requestHash - keccak256 commitment to the request data
 */
export async function submitValidationRequest(
  validatorAddress: string,
  agentId: number,
  requestURI: string,
  requestHash: string
): Promise<string> {
  const registry = getContract();

  log.info(`Submitting validation request`, {
    validator: validatorAddress,
    agentId,
    requestHash: requestHash.slice(0, 16) + '...',
  });

  const tx = await registry.validationRequest(
    validatorAddress,
    agentId,
    requestURI,
    requestHash
  );
  const receipt = await waitForTx(tx);

  log.info(`Validation request submitted`, { txHash: receipt.hash });
  return receipt.hash;
}

/**
 * Submit a validation response
 * MUST be called by the validatorAddress specified in the request
 * 
 * @param requestHash - Hash of the original request
 * @param response - 0-100 (0=fail, 100=pass)
 * @param responseURI - OPTIONAL evidence/audit URI
 * @param responseHash - OPTIONAL keccak256 of responseURI content
 * @param tag - OPTIONAL categorization (e.g. "trade-artifact", "risk-check")
 */
export async function submitValidationResponse(
  requestHash: string,
  response: number,        // 0-100
  responseURI: string = '',
  responseHash: string = ethers.ZeroHash,
  tag: string = ''
): Promise<string> {
  const registry = getContract();

  const clampedResponse = Math.max(0, Math.min(100, Math.round(response)));

  log.info(`Submitting validation response`, {
    requestHash: requestHash.slice(0, 16) + '...',
    response: clampedResponse,
    tag: tag || '(none)',
  });

  const tx = await registry.validationResponse(
    requestHash,
    clampedResponse,
    responseURI,
    responseHash,
    tag
  );
  const receipt = await waitForTx(tx);

  log.info(`Validation response submitted`, { txHash: receipt.hash });
  return receipt.hash;
}

/**
 * Submit a validation response from a DIFFERENT wallet (the validator)
 * This is the correct flow — agent requests, validator responds
 */
export async function submitValidationResponseAsValidator(
  validatorPrivateKey: string,
  requestHash: string,
  response: number,
  responseURI: string = '',
  responseHash: string = ethers.ZeroHash,
  tag: string = ''
): Promise<string> {
  if (!config.validationRegistry) throw new Error('VALIDATION_REGISTRY not set');

  const provider = getProvider();
  const validatorWallet = new ethers.Wallet(validatorPrivateKey, provider);
  const registry = new ethers.Contract(config.validationRegistry, VALIDATION_ABI, validatorWallet);

  const clampedResponse = Math.max(0, Math.min(100, Math.round(response)));

  log.info(`Validator ${validatorWallet.address} responding`, {
    requestHash: requestHash.slice(0, 16) + '...',
    response: clampedResponse,
  });

  const tx = await registry.validationResponse(
    requestHash,
    clampedResponse,
    responseURI,
    responseHash,
    tag
  );
  const receipt = await waitForTx(tx);

  log.info(`Validator response submitted`, { txHash: receipt.hash });
  return receipt.hash;
}

/**
 * Full validation flow for a trade artifact:
 * 1. Agent submits validation request
 * 2. Validator (second wallet) submits response
 */
export async function validateTradeArtifact(
  agentId: number,
  validatorPrivateKey: string,
  artifactIpfsUri: string,
  artifact: object,
  riskChecks: Array<{ passed: boolean }>,
): Promise<{
  requestTx: string;
  requestHash: string;
  responseTx: string;
  score: number;
}> {
  // Compute request hash from artifact
  const requestHash = computeRequestHash(artifact);

  // Derive validator address
  const provider = getProvider();
  const validatorWallet = new ethers.Wallet(validatorPrivateKey, provider);

  // Step 1: Agent submits request
  const requestTx = await submitValidationRequest(
    validatorWallet.address,
    agentId,
    artifactIpfsUri,
    requestHash
  );

  // Step 2: Calculate score from risk checks
  const passedCount = riskChecks.filter(c => c.passed).length;
  const score = Math.round((passedCount / riskChecks.length) * 100);

  // Step 3: Validator responds
  const responseTx = await submitValidationResponseAsValidator(
    validatorPrivateKey,
    requestHash,
    score,
    artifactIpfsUri,  // Evidence = the artifact itself
    ethers.ZeroHash,  // IPFS is content-addressed, no hash needed
    'trade-artifact'  // Tag for filtering
  );

  return { requestTx, requestHash, responseTx, score };
}

/**
 * Get validation status for a request
 */
export async function getValidationStatus(requestHash: string) {
  const registry = getContract();
  const [validatorAddress, agentId, response, responseHash, tag, lastUpdate] =
    await registry.getValidationStatus(requestHash);

  return {
    validatorAddress,
    agentId: Number(agentId),
    response: Number(response),
    responseHash,
    tag,
    lastUpdate: Number(lastUpdate),
  };
}

/**
 * Get validation summary for an agent
 */
export async function getValidationSummary(
  agentId: number,
  validatorAddresses: string[] = [],
  tag: string = ''
): Promise<{ count: number; averageResponse: number }> {
  const registry = getContract();
  const [count, averageResponse] = await registry.getSummary(agentId, validatorAddresses, tag);
  return { count: Number(count), averageResponse: Number(averageResponse) };
}
