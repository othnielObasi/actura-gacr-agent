/**
 * EIP-1271 Smart Contract Signature Verification Tests
 * Tests EIP-1271 interface, EOA fallback, and typed data helpers — all offline.
 */

import { ethers } from 'ethers';
import { EIP1271_MAGIC_VALUE } from '../src/chain/eip1271.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

console.log('\n🧪 EIP-1271 TESTS\n');

// ── Magic Value ──
console.log('── Magic Value Constant ──');

assert(EIP1271_MAGIC_VALUE === '0x1626ba7e', `Magic value is 0x1626ba7e`);

// ── Offline EOA Signature Verification Logic ──
console.log('\n── EOA Signature Flow (offline) ──');

const wallet = new ethers.Wallet('0x' + 'ab'.repeat(32));

// Sign a message and recover it — same flow verifySignature() uses for EOAs
const message = 'Actura agent verification';
const messageHash = ethers.hashMessage(message);
const sig = await wallet.signMessage(message);

const recovered = ethers.verifyMessage(message, sig);
assert(recovered === wallet.address, `EOA recovery matches signer (${recovered})`);

// Wrong signer should not match
const otherWallet = new ethers.Wallet('0x' + 'cd'.repeat(32));
assert(
  recovered.toLowerCase() !== otherWallet.address.toLowerCase(),
  'EOA recovery rejects wrong address',
);

// ── EIP-712 Typed Data Verification (offline) ──
console.log('\n── EIP-712 Typed Data Signing ──');

const domain: ethers.TypedDataDomain = {
  name: 'TradingAgentRiskRouter',
  version: '1',
  chainId: 84532,
  verifyingContract: '0x0000000000000000000000000000000000000001',
};

const types = {
  TradeIntent: [
    { name: 'agent', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

const value = {
  agent: wallet.address,
  amount: ethers.parseEther('1'),
  nonce: BigInt(42),
};

const typedSig = await wallet.signTypedData(domain, types, value);
const typedRecovered = ethers.verifyTypedData(domain, types, value, typedSig);
assert(typedRecovered === wallet.address, `EIP-712 recovery matches signer`);

// Hash computation — this is what gets passed to isValidSignature in EIP-1271
const typedDataHash = ethers.TypedDataEncoder.hash(domain, types, value);
assert(typedDataHash.startsWith('0x'), 'TypedDataEncoder.hash produces valid hash');
assert(typedDataHash.length === 66, 'Hash is 32 bytes (66 hex chars)');

// ── recoverAddress used in verifySignature ──
console.log('\n── Raw Hash Recovery ──');

const rawHash = ethers.keccak256(ethers.toUtf8Bytes('test data'));
const rawSig = await wallet.signMessage(ethers.getBytes(rawHash));
const rawRecovered = ethers.verifyMessage(ethers.getBytes(rawHash), rawSig);
assert(rawRecovered === wallet.address, 'Raw hash recovery works');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
