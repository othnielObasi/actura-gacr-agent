import 'dotenv/config';

export const config = {
  // Wallet
  privateKey: process.env.PRIVATE_KEY || '',
  
  // Network
  rpcUrl: process.env.RPC_URL || 'https://1rpc.io/sepolia',
  chainId: parseInt(process.env.CHAIN_ID || '11155111'),
  
  // Hackathon Shared Contracts (Sepolia)
  agentRegistryAddress: process.env.AGENT_REGISTRY_ADDRESS || '0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3',
  hackathonVaultAddress: process.env.HACKATHON_VAULT_ADDRESS || '0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90',
  riskRouterAddress: process.env.RISK_ROUTER_ADDRESS || '0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC',
  reputationRegistry: process.env.REPUTATION_REGISTRY || '0x423a9904e39537a9997fbaF0f220d79D7d545763',
  validationRegistry: process.env.VALIDATION_REGISTRY || '0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1',

  // ERC-8004 Identity Registry (Base Sepolia — cross-chain reference)
  // Deployed on Base Sepolia (84532) per ERC-8004 reference implementation.
  // Hackathon shared contracts (AgentRegistry, RiskRouter, etc.) are on Sepolia.
  identityRegistry: process.env.IDENTITY_REGISTRY || '0x7177a6867296406881E20d6647232314736Dd09A',
  identityRegistryChainId: parseInt(process.env.IDENTITY_REGISTRY_CHAIN_ID || '84532'),
  identityRegistryRpcUrl: process.env.IDENTITY_REGISTRY_RPC_URL || 'https://sepolia.base.org',
  
  // IPFS
  pinataJwt: process.env.PINATA_JWT || '',
  pinataGateway: process.env.PINATA_GATEWAY || 'https://ipfs.io/ipfs',
  
  // Agent
  agentName: process.env.AGENT_NAME || 'Actura',
  agentDescription: process.env.AGENT_DESCRIPTION || 'Accountable autonomous trading agent',
  agentId: process.env.AGENT_ID ? parseInt(process.env.AGENT_ID) : null,

  // Mandate / Permissions
  allowedAssets: (process.env.ALLOWED_ASSETS || 'WETH/USDC,ETH,USDC').split(',').map(s => s.trim()).filter(Boolean),
  allowedProtocols: (process.env.ALLOWED_PROTOCOLS || 'uniswap,aerodrome').split(',').map(s => s.trim()).filter(Boolean),
  restrictedAssets: (process.env.RESTRICTED_ASSETS || '').split(',').map(s => s.trim()).filter(Boolean),
  restrictedProtocols: (process.env.RESTRICTED_PROTOCOLS || '').split(',').map(s => s.trim()).filter(Boolean),
  requireHumanApprovalAboveUsd: parseFloat(process.env.REQUIRE_HUMAN_APPROVAL_ABOVE_USD || '20000'),

  // Hackathon / ERC-8004 adapters
  capitalVaultAddress: process.env.CAPITAL_VAULT_ADDRESS || '',  // legacy
  dexRouterAddress: process.env.DEX_ROUTER_ADDRESS || '',
  validatorAddress: process.env.VALIDATOR_ADDRESS || '',
  preferredReviewerAddresses: (process.env.PREFERRED_REVIEWER_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean),
  agentImageUrl: process.env.AGENT_IMAGE_URL || '',
  dashboardUrl: process.env.DASHBOARD_URL || 'http://localhost:3000',
  mcpEndpoint: process.env.MCP_ENDPOINT || 'http://localhost:3001/mcp',
  a2aEndpoint: process.env.A2A_ENDPOINT || 'http://localhost:3000/.well-known/agent-card.json',
  registrationOut: process.env.REGISTRATION_OUT || 'agent-registration.json',
  registrationUri: process.env.REGISTRATION_URI || '',
  
  // Trading
  tradingPair: process.env.TRADING_PAIR || 'WETH/USDC',
  maxPositionPct: parseFloat(process.env.MAX_POSITION_PCT || '10') / 100,
  maxDailyLossPct: parseFloat(process.env.MAX_DAILY_LOSS_PCT || '2') / 100,
  maxDrawdownPct: parseFloat(process.env.MAX_DRAWDOWN_PCT || '8') / 100,
  tradingIntervalMs: parseInt(process.env.TRADING_INTERVAL_MS || '120000'),
  
  // Strategy parameters
  strategy: {
    smaFast: 20,
    smaSlow: 50,
    ewmaSpan: 20,
    atrPeriod: 14,
    basePositionPct: 0.04,  // 4% of capital per trade
    stopLossAtrMultiple: 2.5,
    baselineVolatility: 0.01,  // 1% daily vol baseline — ETH sandbox vol is low
  },

  // Kraken CLI
  krakenCliPath: process.env.KRAKEN_CLI_PATH || 'kraken',
  krakenPaperTrading: process.env.KRAKEN_PAPER_TRADING !== 'false',  // default true
  krakenCliTimeoutMs: parseInt(process.env.KRAKEN_CLI_TIMEOUT_MS || '30000'),
} as const;

export type Config = typeof config;
