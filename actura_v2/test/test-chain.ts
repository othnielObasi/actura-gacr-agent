/**
 * Chain Integration Tests
 * Tests EIP-712 signing, feedback auth, and artifact hashing
 * All offline — no testnet needed
 */

import { ethers } from 'ethers';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

console.log('\n🧪 CHAIN INTEGRATION TESTS\n');

// ── EIP-712 Signing ──
console.log('── EIP-712 Trade Intent Signing ──');

const testWallet = new ethers.Wallet('0x' + 'a'.repeat(64));

const domain: ethers.TypedDataDomain = {
  name: 'TradingAgentRiskRouter',
  version: '1',
  chainId: 84532,
  verifyingContract: '0x0000000000000000000000000000000000000001',
};

const types = {
  TradeIntent: [
    { name: 'agent', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'side', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'maxSlippage', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

const intent = {
  agent: testWallet.address,
  asset: '0x4200000000000000000000000000000000000006', // WETH on Base
  side: 0,
  amount: ethers.parseEther('0.01'),
  maxSlippage: BigInt(50),  // 0.5%
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  nonce: BigInt(1),
};

const signature = await testWallet.signTypedData(domain, types, intent);
assert(signature.length === 132, `Signature length: ${signature.length}`);
assert(signature.startsWith('0x'), 'Signature starts with 0x');

// Verify signature recovers correct address
const recovered = ethers.verifyTypedData(domain, types, intent, signature);
assert(recovered === testWallet.address, `Recovered signer matches: ${recovered}`);

// ── EIP-191 Signing (used for agentWallet verification, general auth) ──
console.log('\n── EIP-191 Signing ──');

const authMessage = ethers.solidityPacked(
  ['address', 'uint256', 'uint256', 'uint256'],
  [testWallet.address, 12345, 100, Math.floor(Date.now() / 1000) + 86400]
);
const authHash = ethers.keccak256(authMessage);
const authSig = await testWallet.signMessage(ethers.getBytes(authHash));

assert(authSig.length === 132, `Auth signature length: ${authSig.length}`);

const authRecovered = ethers.verifyMessage(ethers.getBytes(authHash), authSig);
assert(authRecovered === testWallet.address, `Auth signer verified: ${authRecovered}`);

// ── Artifact Hashing ──
console.log('\n── Artifact Hashing ──');

const sampleArtifact = {
  version: '1.0',
  agentName: 'Actura',
  timestamp: new Date().toISOString(),
  type: 'trade_checkpoint',
  decision: { approved: true, explanation: 'Test trade' },
};

const artifactJson = JSON.stringify(sampleArtifact);
const artifactHash = ethers.keccak256(ethers.toUtf8Bytes(artifactJson));

assert(artifactHash.length === 66, `Artifact hash length: ${artifactHash.length}`);
assert(artifactHash.startsWith('0x'), 'Artifact hash starts with 0x');

// Same content should produce same hash
const artifactHash2 = ethers.keccak256(ethers.toUtf8Bytes(artifactJson));
assert(artifactHash === artifactHash2, 'Deterministic hashing');

// Different content should produce different hash
const modified = JSON.stringify({ ...sampleArtifact, timestamp: 'different' });
const artifactHash3 = ethers.keccak256(ethers.toUtf8Bytes(modified));
assert(artifactHash !== artifactHash3, 'Different content → different hash');

// ── Bytes32 Tag Encoding ──
console.log('\n── Tag Encoding ──');

const tag = ethers.encodeBytes32String('tradingYield');
assert(tag.length === 66, `Tag encoded to bytes32: ${tag.slice(0, 20)}...`);

const decoded = ethers.decodeBytes32String(tag);
assert(decoded === 'tradingYield', `Tag decoded: ${decoded}`);

// ── Summary ──
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
