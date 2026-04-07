
/**
 * ERC-8004 Identity Registry integration.
 * Owns agent registration JSON generation, ERC-721 registration, and wallet verification.
 */

import { Buffer } from 'node:buffer';
import { ethers } from 'ethers';
import { config } from '../agent/config.js';
import { buildMandateMetadataJson, getDefaultMandate } from './agent-mandate.js';
import { getWallet, waitForTx } from './sdk.js';

const IDENTITY_ABI = [
  'function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) external returns (uint256)',
  'function register(string agentURI) external returns (uint256)',
  'function register() external returns (uint256)',
  'function setAgentURI(uint256 agentId, string newURI) external',
  'function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature) external',
  'function getAgentWallet(uint256 agentId) external view returns (address)',
  'function unsetAgentWallet(uint256 agentId) external',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external',
  'function getMetadata(uint256 agentId, string metadataKey) external view returns (bytes)',
  'function balanceOf(address owner) external view returns (uint256)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)',
  'event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
] as const;

let contract: ethers.Contract | null = null;

export interface AgentServiceEndpoint {
  name: string;
  endpoint: string;
  version?: string;
  skills?: string[];
  domains?: string[];
}

export interface AgentRegistrationFile {
  type: string;
  name: string;
  description: string;
  image: string;
  services: AgentServiceEndpoint[];
  x402Support: boolean;
  active: boolean;
  registrations: Array<{ agentId: number; agentRegistry: string }>;
  supportedTrust?: string[];
}

function getContract(): ethers.Contract {
  if (!contract) {
    if (!config.identityRegistry) throw new Error('IDENTITY_REGISTRY address not set');
    // Identity registry may be on a different chain (Base Sepolia) than the main agent (Sepolia).
    // Use a dedicated provider if chain differs.
    if (config.identityRegistryChainId !== config.chainId && config.identityRegistryRpcUrl) {
      const idProvider = new ethers.JsonRpcProvider(config.identityRegistryRpcUrl);
      const idWallet = new ethers.Wallet(config.privateKey, idProvider);
      contract = new ethers.Contract(config.identityRegistry, IDENTITY_ABI, idWallet);
    } else {
      contract = new ethers.Contract(config.identityRegistry, IDENTITY_ABI, getWallet());
    }
  }
  return contract;
}

export function makeAgentRegistryString(): string {
  // Use the identity registry's actual chain ID, not the agent's main chain
  return `eip155:${config.identityRegistryChainId}:${config.identityRegistry}`;
}

export function buildAgentServices(): AgentServiceEndpoint[] {
  const services: AgentServiceEndpoint[] = [];
  if (config.dashboardUrl) services.push({ name: 'web', endpoint: config.dashboardUrl });
  if (config.a2aEndpoint) services.push({ name: 'A2A', endpoint: config.a2aEndpoint, version: '0.3.0' });
  if (config.mcpEndpoint) services.push({ name: 'MCP', endpoint: config.mcpEndpoint, version: '2025-06-18' });
  services.push({ name: 'email', endpoint: 'ops@actura.local' });
  return services;
}

export function buildRegistrationJson(options: {
  agentId?: number;
  mcpEndpoint?: string;
  a2aEndpoint?: string;
  dashboardUrl?: string;
  imageUrl?: string;
  mandateCapitalUsd?: number;
  active?: boolean;
  supportedTrust?: string[];
} = {}): AgentRegistrationFile {
  const mandate = getDefaultMandate(options.mandateCapitalUsd ?? 100000);
  const services = buildAgentServices();

  if (options.dashboardUrl && !services.find(s => s.name === 'web')) {
    services.unshift({ name: 'web', endpoint: options.dashboardUrl });
  }

  const registrations = options.agentId !== undefined
    ? [{ agentId: options.agentId, agentRegistry: makeAgentRegistryString() }]
    : [];

  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: config.agentName,
    description: `${config.agentDescription}. Governed autonomous capital agent with neuro-symbolic policy checks, supervisory capital controls, pre-trade execution simulation, oracle integrity validation, and trust receipts for every decision. Mandate: ${JSON.stringify(buildMandateMetadataJson(mandate))}`,
    image: options.imageUrl || config.agentImageUrl || '',
    services: [
      ...(options.dashboardUrl ? [{ name: 'web', endpoint: options.dashboardUrl }] : []),
      ...(options.a2aEndpoint ? [{ name: 'A2A', endpoint: options.a2aEndpoint, version: '0.3.0' }] : []),
      ...(options.mcpEndpoint ? [{ name: 'MCP', endpoint: options.mcpEndpoint, version: '2025-06-18' }] : []),
      ...services.filter(s => !['web', 'A2A', 'MCP'].includes(s.name)),
    ],
    x402Support: false,
    active: options.active ?? true,
    registrations,
    supportedTrust: options.supportedTrust || ['reputation', 'crypto-economic', 'tee-attestation'],
  };
}

export function validateRegistrationJson(registration: Partial<AgentRegistrationFile>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const required = ['type', 'name', 'description', 'image', 'services', 'x402Support', 'active', 'registrations'];
  for (const field of required) if (!(field in registration)) errors.push(`Missing required field: ${field}`);
  if (registration.type !== 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1') errors.push('Invalid registration type');
  if (!Array.isArray(registration.services) || registration.services.length === 0) errors.push('services must be a non-empty array');
  if (!Array.isArray(registration.registrations)) errors.push('registrations must be an array');
  if (Array.isArray(registration.services)) {
    for (const [idx, service] of registration.services.entries()) {
      if (!service?.name || !service?.endpoint) errors.push(`services[${idx}] must include name and endpoint`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function createRegistrationDataUri(registration: AgentRegistrationFile): string {
  const json = JSON.stringify(registration);
  return `data:application/json;base64,${Buffer.from(json, 'utf8').toString('base64')}`;
}

export async function registerAgent(agentURI: string, metadata: Array<{ metadataKey: string; metadataValue: string | Uint8Array }> = []): Promise<number> {
  const registry = getContract();
  const encodedMetadata = metadata.map(m => ({ metadataKey: m.metadataKey, metadataValue: typeof m.metadataValue === 'string' ? ethers.toUtf8Bytes(m.metadataValue) : m.metadataValue }));
  const tx = encodedMetadata.length > 0
    ? await registry['register(string,tuple(string,bytes)[])'](agentURI, encodedMetadata)
    : await registry['register(string)'](agentURI);
  const receipt = await waitForTx(tx);
  const parsed = receipt.logs.map((log: any) => { try { return registry.interface.parseLog({ topics: [...log.topics], data: log.data }); } catch { return null; } });
  const registered = parsed.find((e: any) => e?.name === 'Registered');
  const transfer = parsed.find((e: any) => e?.name === 'Transfer');
  const agentId = Number(registered?.args?.agentId ?? transfer?.args?.[2]);
  if (!Number.isFinite(agentId)) throw new Error('Could not parse agentId from registration receipt');
  return agentId;
}

export async function setAgentMetadata(agentId: number, key: string, value: string): Promise<string> {
  const registry = getContract();
  const tx = await registry.setMetadata(agentId, key, ethers.toUtf8Bytes(value));
  const receipt = await waitForTx(tx);
  return receipt.hash;
}

export async function setAgentUri(agentId: number, newUri: string): Promise<string> {
  const registry = getContract();
  const tx = await registry.setAgentURI(agentId, newUri);
  const receipt = await waitForTx(tx);
  return receipt.hash;
}

export async function setVerifiedAgentWallet(agentId: number, newWalletPrivateKey: string, deadlineSeconds = 3600): Promise<string> {
  const registry = getContract();
  const ownerWallet = getWallet();
  const newWallet = new ethers.Wallet(newWalletPrivateKey.startsWith('0x') ? newWalletPrivateKey : `0x${newWalletPrivateKey}`, ownerWallet.provider);
  const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;
  const domain = {
    name: 'ERC8004IdentityRegistry',
    version: '1',
    chainId: config.identityRegistryChainId,
    verifyingContract: config.identityRegistry,
  };
  const types = {
    SetAgentWallet: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newWallet', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
  const signature = await newWallet.signTypedData(domain, types, { agentId, newWallet: newWallet.address, deadline });
  const tx = await registry.setAgentWallet(agentId, newWallet.address, deadline, signature);
  const receipt = await waitForTx(tx);
  return receipt.hash;
}

export async function getAgentUri(agentId: number): Promise<string> {
  return getContract().tokenURI(agentId);
}

export async function getAgentWallet(agentId: number): Promise<string> {
  return getContract().getAgentWallet(agentId);
}

export async function getAgentCount(): Promise<number> {
  const registry = getContract();
  const wallet = getWallet();
  return Number(await registry.balanceOf(wallet.address));
}

// ──── Hackathon AgentRegistry (Sepolia) ────

const HACKATHON_REGISTRY_ABI = [
  'function register(address agentWallet, string name, string description, string[] capabilities, string agentURI) external returns (uint256 agentId)',
  'function isRegistered(uint256 agentId) external view returns (bool)',
  'function getAgent(uint256 agentId) external view returns (tuple(address operatorWallet, address agentWallet, string name, string description, string[] capabilities, uint256 registeredAt, bool active))',
  'function getSigningNonce(uint256 agentId) external view returns (uint256)',
  'event AgentRegistered(uint256 indexed agentId, address indexed operatorWallet, address indexed agentWallet)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

/**
 * Register agent on the hackathon's shared AgentRegistry.
 * Uses operatorWallet (PRIVATE_KEY) to call register, passing agentWallet address.
 * We use the same wallet for both operator and agent signing.
 */
export async function registerOnHackathonRegistry(params: {
  agentURI?: string;
  name?: string;
  description?: string;
  capabilities?: string[];
}): Promise<number> {
  if (!config.agentRegistryAddress) throw new Error('AGENT_REGISTRY_ADDRESS not set');

  const wallet = getWallet();
  const registry = new ethers.Contract(config.agentRegistryAddress, HACKATHON_REGISTRY_ABI, wallet);

  const name = params.name || config.agentName || 'Actura';
  const description = params.description || config.agentDescription || 'Accountable autonomous trading agent';
  const capabilities = params.capabilities || [
    'trading',
    'eip712-signing',
    'risk-management',
    'neuro-symbolic-reasoning',
    'sentiment-analysis',
    'self-adapting',
  ];
  const agentURI = params.agentURI || config.registrationUri || '';

  console.log(`[IDENTITY] Registering on hackathon AgentRegistry...`);
  console.log(`[IDENTITY] Name: ${name}`);
  console.log(`[IDENTITY] Agent wallet: ${wallet.address}`);
  console.log(`[IDENTITY] Capabilities: ${capabilities.join(', ')}`);

  const tx = await registry.register(
    wallet.address,    // agentWallet (same as operator for simplicity)
    name,
    description,
    capabilities,
    agentURI,
  );
  const receipt = await waitForTx(tx);

  // Parse agentId from events
  let agentId: number | null = null;
  for (const eventLog of receipt.logs) {
    try {
      const parsed = registry.interface.parseLog({ topics: [...eventLog.topics], data: eventLog.data });
      if (parsed?.name === 'AgentRegistered') {
        agentId = Number(parsed.args.agentId);
        break;
      }
      if (parsed?.name === 'Transfer' && parsed.args[0] === ethers.ZeroAddress) {
        agentId = Number(parsed.args[2]); // tokenId from mint
        break;
      }
    } catch { /* not our event */ }
  }

  if (agentId === null) throw new Error('Could not parse agentId from registration receipt');

  console.log(`[IDENTITY] Registered! agentId = ${agentId}`);
  console.log(`[IDENTITY] Tx: ${receipt.hash}`);
  return agentId;
}

/**
 * Check if an agentId is registered on the hackathon registry.
 */
export async function isRegisteredOnHackathon(agentId: number): Promise<boolean> {
  if (!config.agentRegistryAddress) return false;
  const wallet = getWallet();
  const registry = new ethers.Contract(config.agentRegistryAddress, HACKATHON_REGISTRY_ABI, wallet);
  return registry.isRegistered(agentId);
}
