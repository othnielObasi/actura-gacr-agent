/**
 * One-off script: Register agent on the hackathon AgentRegistry (Sepolia).
 * Usage: npx tsx scripts/register-hackathon.ts
 */
import 'dotenv/config';
import { initChain } from '../src/chain/sdk.js';
import { registerOnHackathonRegistry } from '../src/chain/identity.js';

async function main() {
  initChain();
  console.log('=== Hackathon Agent Registration ===\n');

  const agentId = await registerOnHackathonRegistry({
    name: 'Actura',
    description: 'Accountable autonomous trading agent — neuro-symbolic policy, SAGE self-adaptation, pre-trade simulation, EIP-712 trust receipts',
    capabilities: [
      'trading',
      'eip712-signing',
      'risk-management',
      'neuro-symbolic-reasoning',
      'sentiment-analysis',
      'self-adapting',
    ],
    agentURI: 'https://api.actura.nov-tia.com/agent.json',
  });

  console.log(`\n✅ Agent registered with agentId = ${agentId}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Set AGENT_ID=${agentId} in .env`);
  console.log(`  2. Claim sandbox capital: claimAllocation(${agentId})`);
}

main().catch((err) => {
  console.error('Registration failed:', err);
  process.exit(1);
});
