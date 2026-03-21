/**
 * Event Indexer Tests — verifies indexer state management & status reporting
 * Tests are offline (no chain calls) — validates data structures and logic.
 */

import { getIndexedEvents, getIndexerStatus, type IndexedEvent } from '../src/chain/event-indexer.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

console.log('\n🧪 EVENT INDEXER TESTS\n');

// ── Status Baseline (before starting) ──
console.log('── Status Before Starting ──');

const status = getIndexerStatus();
assert(status.running === false, 'Indexer not running before start');
assert(status.totalEvents === 0, 'No events before start');
assert(status.lastIndexedBlock === 0, 'Last indexed block is 0');
assert(typeof status.eventBreakdown === 'object', 'Has event breakdown');
assert(status.eventBreakdown.reputation_feedback === 0, 'Zero reputation events');
assert(status.eventBreakdown.validation_request === 0, 'Zero validation request events');
assert(status.eventBreakdown.validation_response === 0, 'Zero validation response events');

// ── Event Retrieval ──
console.log('\n── Event Retrieval ──');

const allEvents = getIndexedEvents();
assert(Array.isArray(allEvents), 'getIndexedEvents returns array');
assert(allEvents.length === 0, 'Empty before any polling');

const filtered = getIndexedEvents('reputation_feedback');
assert(Array.isArray(filtered), 'Filtered events returns array');
assert(filtered.length === 0, 'Filtered results also empty');

// ── Type Shape Validation ──
console.log('\n── IndexedEvent Type Shape ──');

const mockEvent: IndexedEvent = {
  type: 'reputation_feedback',
  blockNumber: 12345,
  txHash: '0x' + 'a'.repeat(64),
  timestamp: new Date().toISOString(),
  data: {
    agentId: 338,
    clientAddress: '0x' + 'b'.repeat(40),
    value: 100,
    tag1: 'accuracy',
  },
};

assert(mockEvent.type === 'reputation_feedback', 'Event type is valid');
assert(mockEvent.blockNumber > 0, 'Block number is positive');
assert(mockEvent.txHash.startsWith('0x'), 'TxHash starts with 0x');
assert(mockEvent.txHash.length === 66, 'TxHash is 32 bytes');
assert(typeof mockEvent.data === 'object', 'Data is an object');
assert(mockEvent.data.agentId === 338, 'Event data carries agentId');

// ── Validation Event Type ──
const mockValReq: IndexedEvent = {
  type: 'validation_request',
  blockNumber: 12346,
  txHash: '0x' + 'c'.repeat(64),
  timestamp: new Date().toISOString(),
  data: {
    validatorAddress: '0x' + 'd'.repeat(40),
    agentId: 338,
    requestURI: 'ipfs://QmTest',
    requestHash: '0x' + 'e'.repeat(64),
  },
};

assert(mockValReq.type === 'validation_request', 'Validation request type valid');

const mockValRes: IndexedEvent = {
  type: 'validation_response',
  blockNumber: 12347,
  txHash: '0x' + 'f'.repeat(64),
  timestamp: new Date().toISOString(),
  data: {
    validatorAddress: '0x' + 'd'.repeat(40),
    agentId: 338,
    response: 1,
    tag: 'compliance',
  },
};

assert(mockValRes.type === 'validation_response', 'Validation response type valid');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
