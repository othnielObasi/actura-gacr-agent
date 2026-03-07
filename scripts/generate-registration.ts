
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { config } from '../src/agent/config.js';
import { buildRegistrationJson, createRegistrationDataUri, validateRegistrationJson } from '../src/chain/identity.js';

const registration = buildRegistrationJson({
  agentId: config.agentId ?? undefined,
  dashboardUrl: config.dashboardUrl,
  mcpEndpoint: config.mcpEndpoint,
  a2aEndpoint: config.a2aEndpoint,
  imageUrl: config.agentImageUrl,
  mandateCapitalUsd: Number(process.env.MANDATE_CAPITAL_USD || 100000),
});

const validation = validateRegistrationJson(registration);
if (!validation.valid) {
  console.error('Invalid registration JSON:', validation.errors);
  process.exit(1);
}

writeFileSync(config.registrationOut, JSON.stringify(registration, null, 2));
console.log(`Registration JSON written to ${config.registrationOut}`);
console.log(`Data URI ready: ${createRegistrationDataUri(registration).slice(0, 120)}...`);
