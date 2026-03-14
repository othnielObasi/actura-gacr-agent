import 'dotenv/config';

export const config = {
  // Wallet
  privateKey: process.env.PRIVATE_KEY || '',
  
  // Network
  rpcUrl: process.env.RPC_URL || 'https://sepolia.base.org',
  chainId: parseInt(process.env.CHAIN_ID || '84532'),
  
  // ERC-8004 Contracts (Reference Implementation — live on Base Sepolia)
  identityRegistry: process.env.IDENTITY_REGISTRY || '0x7177a6867296406881E20d6647232314736Dd09A',
  reputationRegistry: process.env.REPUTATION_REGISTRY || '0xB5048e3ef1DA4E04deB6f7d0423D06F63869e322',
  validationRegistry: process.env.VALIDATION_REGISTRY || '0x662b40A526cb4017d947e71eAF6753BF3eeE66d8',
  
  // IPFS
  pinataJwt: process.env.PINATA_JWT || '',
  
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
  riskRouterAddress: process.env.RISK_ROUTER_ADDRESS || '',
  capitalVaultAddress: process.env.CAPITAL_VAULT_ADDRESS || '',
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
  tradingIntervalMs: parseInt(process.env.TRADING_INTERVAL_MS || '300000'),
  
  // Strategy parameters
  strategy: {
    smaFast: 20,
    smaSlow: 50,
    ewmaSpan: 20,
    atrPeriod: 14,
    basePositionPct: 0.02,  // 2% of capital per trade
    stopLossAtrMultiple: 1.5,
    baselineVolatility: 0.02,  // 2% daily vol baseline
  }
} as const;

export type Config = typeof config;
