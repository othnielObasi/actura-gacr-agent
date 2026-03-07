import assert from 'node:assert/strict';
import { pauseTrading, resumeTrading, emergencyStop, getOperatorControlState, getOperatorActionReceipts, resetOperatorControls } from '../src/agent/operator-control.js';

let passed = 0;
let failed = 0;
function check(fn: () => void, name: string) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.error(e);
    failed++;
  }
}

console.log('\n🧪 OPERATOR CONTROL TESTS\n');
resetOperatorControls();

check(() => {
  const state = getOperatorControlState();
  assert.equal(state.mode, 'normal');
  assert.equal(state.canTrade, true);
}, 'Default state allows trading');

check(() => {
  const pause = pauseTrading('manual pause for test', 'test');
  const state = getOperatorControlState();
  assert.equal(pause.action, 'pause');
  assert.equal(state.mode, 'paused');
  assert.equal(state.canTrade, false);
}, 'Pause toggles trading off');

check(() => {
  const stop = emergencyStop('panic button test', 'test');
  const state = getOperatorControlState();
  assert.equal(stop.action, 'emergency_stop');
  assert.equal(state.mode, 'emergency_stop');
  assert.equal(state.canTrade, false);
}, 'Emergency stop locks trading');

check(() => {
  const resume = resumeTrading('resume after test', 'test');
  const state = getOperatorControlState();
  assert.equal(resume.action, 'resume');
  assert.equal(state.mode, 'normal');
  assert.equal(state.canTrade, true);
}, 'Resume restores normal mode');

check(() => {
  const actions = getOperatorActionReceipts(10);
  assert.ok(actions.length >= 3);
}, 'Action receipts recorded');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
