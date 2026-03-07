
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { config } from '../src/agent/config.js';
import { initChain } from '../src/chain/sdk.js';
import { buildRegistrationJson, createRegistrationDataUri, registerAgent, setVerifiedAgentWallet, validateRegistrationJson } from '../src/chain/identity.js';
import { claimSandboxCapital, preflight } from '../src/chain/executor.js';

async function main() {
  initChain();
  const pre = await preflight();
  console.log('Preflight:', pre);

  const registration = buildRegistrationJson({
    dashboardUrl: config.dashboardUrl,
    mcpEndpoint: config.mcpEndpoint,
    a2aEndpoint: config.a2aEndpoint,
    imageUrl: config.agentImageUrl,
    mandateCapitalUsd: Number(process.env.MANDATE_CAPITAL_USD || 100000),
  });

  const valid = validateRegistrationJson(registration);
  if (!valid.valid) {
    throw new Error(`Registration JSON invalid: ${valid.errors.join('; ')}`);
  }

  writeFileSync(config.registrationOut, JSON.stringify(registration, null, 2));
  console.log(`Registration JSON written to ${config.registrationOut}`);

  const agentUri = config.registrationUri || createRegistrationDataUri(registration);
  let agentId: number | null = null;

  if (process.env.SKIP_REGISTER !== 'true') {
    agentId = await registerAgent(agentUri, [
      { metadataKey: 'bootstrapVersion', metadataValue: 'hackathon-ready-v1' },
    ]);
    console.log('Registered agentId:', agentId);
  } else {
    console.log('Skipping on-chain registration (SKIP_REGISTER=true)');
  }

  if (agentId !== null && process.env.NEW_AGENT_WALLET_PRIVATE_KEY) {
    const walletTx = await setVerifiedAgentWallet(agentId, process.env.NEW_AGENT_WALLET_PRIVATE_KEY);
    console.log('Verified agent wallet tx:', walletTx);
  }

  if (process.env.CLAIM_SANDBOX === 'true') {
    const claimTx = await claimSandboxCapital();
    console.log('Sandbox claimed:', claimTx);
  }

  console.log('\nNext plug-in points when hackathon values are released:');
  console.log('- RISK_ROUTER_ADDRESS');
  console.log('- CAPITAL_VAULT_ADDRESS');
  console.log('- VALIDATOR_ADDRESS or VALIDATOR_PRIVATE_KEY');
  console.log('- Any final Risk Router ABI field changes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
