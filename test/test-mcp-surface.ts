
import assert from 'assert';
import { ALL_TOOLS } from '../src/mcp/tools.js';
import { ALL_RESOURCES } from '../src/mcp/resources.js';
import { ALL_PROMPTS } from '../src/mcp/prompts.js';
import { resetCheckpoints } from '../src/trust/checkpoint.js';
import { resetOperatorControls } from '../src/agent/operator-control.js';
import { resetTrustScorecards } from '../src/trust/trust-policy-scorecard.js';

async function run() {
  console.log('Testing MCP surface...');
  resetCheckpoints();
  resetOperatorControls();
  resetTrustScorecards();

  assert.ok(ALL_TOOLS.length >= 10, 'should expose a rich tool surface');
  assert.ok(ALL_RESOURCES.length >= 6, 'should expose multiple resources');
  assert.ok(ALL_PROMPTS.length >= 3, 'should expose prompt workflows');

  const market = await ALL_TOOLS.find(t => t.name === 'get_market_state')!.handler({});
  assert.ok(typeof market === 'object');

  const rights = await ALL_TOOLS.find(t => t.name === 'get_capital_rights')!.handler({});
  assert.ok(typeof rights === 'object');
  assert.ok('capitalMultiplier' in (rights as Record<string, unknown>));

  const explain = await ALL_TOOLS.find(t => t.name === 'explain_trade')!.handler({});
  assert.ok(typeof explain === 'object');

  const pause = await ALL_TOOLS.find(t => t.name === 'pause_agent')!.handler({ reason: 'test pause', actor: 'test' });
  assert.equal((pause as any).action, 'pause');

  const prompt = await ALL_PROMPTS.find(p => p.name === 'summarize_risk_state')!.handler({});
  assert.ok(prompt.text.length > 0);

  const resource = await ALL_RESOURCES.find(r => r.uri === 'actura://state/erc8004')!.handler({});
  assert.ok(typeof resource === 'object');

  console.log('MCP surface tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
