/**
 * Register Actura on ERC-8004 Identity Registry
 * 
 * Usage: npm run register
 * 
 * This script:
 * 1. Builds the registration JSON
 * 2. Uploads it to IPFS via Pinata
 * 3. Calls register() on the Identity Registry
 * 4. Sets metadata (wallet address)
 * 5. Outputs the agent ID for .env
 */

import { initChain, getBalance, getWalletAddress } from '../src/chain/sdk.js';
import { buildRegistrationJson, registerAgent, setAgentMetadata, getAgentCount } from '../src/chain/identity.js';
import { uploadJson } from '../src/trust/ipfs.js';
import { config } from '../src/agent/config.js';

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  ACTURA — Agent Registration');
  console.log('═══════════════════════════════════════════');
  console.log('');

  // Step 1: Initialize chain connection
  console.log('Step 1: Connecting to chain...');
  const { wallet } = initChain();
  const balance = await getBalance();
  console.log(`  Wallet: ${wallet.address}`);
  console.log(`  Balance: ${balance} ETH`);

  if (parseFloat(balance) < 0.001) {
    console.error('  ❌ Insufficient balance. Need at least 0.001 ETH for gas.');
    console.error('  Get testnet ETH from a faucet first.');
    process.exit(1);
  }
  console.log('  ✅ Balance sufficient\n');

  // Step 2: Check if already registered
  console.log('Step 2: Checking existing registrations...');
  const existingCount = await getAgentCount();
  if (existingCount > 0) {
    console.log(`  ⚠️  This wallet already owns ${existingCount} agent(s).`);
    console.log('  Proceeding with new registration...\n');
  } else {
    console.log('  No existing agents. First registration.\n');
  }

  // Step 3: Build initial registration JSON (without agentId — set after registration)
  console.log('Step 3: Building registration JSON...');
  const registrationJson = buildRegistrationJson({
    dashboardUrl: 'https://actura.sovereignailab.com',
    mcpEndpoint: 'https://actura.sovereignailab.com/mcp',
    a2aEndpoint: 'https://actura.sovereignailab.com/.well-known/agent-card.json',
    mandateCapitalUsd: 100000,
  });
  console.log('  ✅ Registration JSON built (ERC-8004 v1.0 compliant)\n');

  // Step 4: Upload to IPFS
  console.log('Step 4: Uploading to IPFS...');
  const ipfsResult = await uploadJson(registrationJson, `actura-registration-${Date.now()}`);
  console.log(`  CID: ${ipfsResult.cid}`);
  console.log(`  URI: ${ipfsResult.uri}`);
  console.log(`  Gateway: ${ipfsResult.gatewayUrl}`);
  console.log('  ✅ Uploaded\n');

  // Step 5: Register on-chain
  console.log('Step 5: Registering on Identity Registry...');
  console.log(`  Contract: ${config.identityRegistry}`);
  const agentId = await registerAgent(ipfsResult.uri);
  console.log(`  ✅ Registered! Agent ID: ${agentId}\n`);

  // Step 6: agentWallet is auto-set to owner address on registration per ERC-8004 v1.0
  // No need to call setMetadata for it
  console.log('Step 6: Agent wallet auto-set to owner address ✅\n');

  // Summary
  console.log('═══════════════════════════════════════════');
  console.log('  REGISTRATION COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Agent ID:       ${agentId}`);
  console.log(`  Token URI:      ${ipfsResult.uri}`);
  console.log(`  Wallet:         ${wallet.address}`);
  console.log(`  Chain:          ${config.chainId}`);
  console.log(`  Registry:       ${config.identityRegistry}`);
  console.log('');
  console.log('  Add to your .env:');
  console.log(`  AGENT_ID=${agentId}`);
  console.log('');
  console.log('  Verify on scanner:');
  console.log(`  https://8004scan.io/agent/${agentId}`);
  console.log(`  https://agentscan.info/agent/${agentId}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Registration failed:', err);
  process.exit(1);
});
