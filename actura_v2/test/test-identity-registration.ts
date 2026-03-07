import assert from "node:assert/strict";
import { buildRegistrationJson, createRegistrationDataUri, validateRegistrationJson } from '../src/chain/identity.js';

const registration = buildRegistrationJson({
  agentId: 7,
  dashboardUrl: 'https://actura.example',
  mcpEndpoint: 'https://actura.example/mcp',
  a2aEndpoint: 'https://actura.example/.well-known/agent-card.json',
});

const validation = validateRegistrationJson(registration);
assert.equal(validation.valid, true);
assert.equal((registration as any).type, 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
assert.ok(Array.isArray((registration as any).services));
assert.ok(Array.isArray((registration as any).registrations));
const dataUri = createRegistrationDataUri(registration);
assert.ok(dataUri.startsWith('data:application/json;base64,'));
console.log('✓ Identity registration JSON helpers pass');
