
import { strict as assert } from 'node:assert';
import { buildRegistrationJson, validateRegistrationJson, createRegistrationDataUri, makeAgentRegistryString } from '../src/chain/identity.js';
import { buildTradeIntent, hashTradeIntent, resetNonce } from '../src/chain/intent.js';
import { buildValidationRequestPayload } from '../src/chain/validation.js';
import { buildReputationFeedbackEnvelope } from '../src/chain/reputation.js';
import { initChain } from '../src/chain/sdk.js';

export async function run() {
  process.env.PRIVATE_KEY = process.env.PRIVATE_KEY || '0x59c6995e998f97a5a0044966f0945384cb4d7f7e7f6a8d89f5cb9184160a95c5';
  initChain();

  const reg = buildRegistrationJson({ agentId: 7, dashboardUrl: 'https://actura.app' });
  const validated = validateRegistrationJson(reg);
  assert.equal(validated.valid, true);
  assert.ok(reg.registrations[0].agentRegistry.includes(makeAgentRegistryString()));
  assert.ok(createRegistrationDataUri(reg).startsWith('data:application/json;base64,'));

  resetNonce();
  const intent = buildTradeIntent({ agentId: 7, pair: 'XBTUSD', action: 'BUY', amountUsd: 100, slippageBps: 100, deadlineSeconds: 60, nonce: 0n });
  assert.equal(typeof hashTradeIntent(intent), 'string');
  assert.equal(intent.action, 'BUY');

  const vr = buildValidationRequestPayload({ validatorAddress: '0x0000000000000000000000000000000000000001', agentId: 7, requestURI: 'ipfs://abc', input: { foo: 'bar' } });
  assert.equal(vr.agentId, 7);
  assert.ok(vr.requestHash.startsWith('0x'));

  const feedback = buildReputationFeedbackEnvelope({ agentId: 7, reviewerAddress: '0x0000000000000000000000000000000000000002', tag1: 'tradingYield', value: 42, valueDecimals: 1 });
  assert.equal(feedback.tag1, 'tradingYield');
  assert.equal(feedback.valueDecimals, 1);

  console.log('✓ ERC-8004 adapters tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
