import assert from 'node:assert/strict';
import { pauseTrading, resumeTrading, emergencyStop, getOperatorControlState, getOperatorActionReceipts, resetOperatorControls } from '../src/agent/operator-control.js';

export function runOperatorControlTests() {
  resetOperatorControls();

  let state = getOperatorControlState();
  assert.equal(state.mode, 'normal');
  assert.equal(state.canTrade, true);

  const pause = pauseTrading('manual pause for test', 'test');
  state = getOperatorControlState();
  assert.equal(pause.action, 'pause');
  assert.equal(state.mode, 'paused');
  assert.equal(state.canTrade, false);

  const stop = emergencyStop('panic button test', 'test');
  state = getOperatorControlState();
  assert.equal(stop.action, 'emergency_stop');
  assert.equal(state.mode, 'emergency_stop');
  assert.equal(state.canTrade, false);

  const resume = resumeTrading('resume after test', 'test');
  state = getOperatorControlState();
  assert.equal(resume.action, 'resume');
  assert.equal(state.mode, 'normal');
  assert.equal(state.canTrade, true);

  const actions = getOperatorActionReceipts(10);
  assert.ok(actions.length >= 3);
}
