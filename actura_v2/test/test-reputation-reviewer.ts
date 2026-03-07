import assert from "node:assert/strict";
import { buildFeedbackJson } from '../src/chain/reputation.js';

const feedback = buildFeedbackJson({
  agentId: 12,
  value: 87,
  valueDecimals: 0,
  tag1: 'starred',
  tag2: 'quality',
  endpoint: 'https://router.example',
  tradePnl: 42.2,
  tradeAsset: 'WETH/USDC',
});
assert.equal((feedback as any).agentId, 12);
assert.equal((feedback as any).value, 87);
assert.equal((feedback as any).tag1, 'starred');
assert.equal((feedback as any).tag2, 'quality');
console.log('✓ Reputation feedback JSON helper passes');
