/**
 * Quick Pinata connectivity test
 */
import { uploadArtifact } from '../src/trust/ipfs.js';
import { config } from '../src/agent/config.js';

async function main() {
  console.log('=== Pinata Connectivity Test ===\n');
  console.log('JWT configured:', config.pinataJwt ? `YES (${config.pinataJwt.length} chars)` : 'NO (will use mock)');
  console.log('Gateway:', config.pinataGateway);

  // Step 1: Test authentication
  if (config.pinataJwt) {
    console.log('\n--- Auth Test ---');
    try {
      const authRes = await fetch('https://api.pinata.cloud/data/testAuthentication', {
        headers: { 'Authorization': `Bearer ${config.pinataJwt}` },
        signal: AbortSignal.timeout(10000),
      });
      const authData = await authRes.text();
      console.log('  Auth status:', authRes.status, authRes.statusText);
      console.log('  Response:', authData);
      if (!authRes.ok) {
        console.log('  ❌ JWT is INVALID — need a new Pinata API key');
        // Try with API key/secret format instead
        console.log('\n  Trying V2 API...');
        const v2Res = await fetch('https://api.pinata.cloud/v3/files', {
          headers: { 'Authorization': `Bearer ${config.pinataJwt}` },
          signal: AbortSignal.timeout(10000),
        });
        console.log('  V2 status:', v2Res.status, v2Res.statusText);
      }
    } catch (e) {
      console.error('  Auth test error:', e);
    }
  }

  const testArtifact = {
    version: '1.0', agentName: 'Actura', agentId: 338,
    timestamp: new Date().toISOString(), type: 'trade_checkpoint' as const,
    trade: null,
    strategy: { name: 'test', signal: 'TEST', signalConfidence: 0, signalReason: 'Pinata deploy test', smaFast: null, smaSlow: null },
    risk: { currentVolatility: null, baselineVolatility: 0.02, volatilityRatio: 1, volatilityRegime: 'normal', positionSizeRaw: 0, positionSizeAdjusted: 0, stopLossPrice: null, dailyPnl: 0, dailyPnlPct: 0, maxDrawdownCurrent: 0, circuitBreakerActive: false, circuitBreakerReason: null },
    riskChecks: [],
    decision: { approved: false, explanation: 'Pinata connectivity test' },
  };

  try {
    const result = await uploadArtifact(testArtifact as any);
    console.log('\nUpload result:');
    console.log('  CID:', result.cid);
    console.log('  URI:', result.uri);
    console.log('  Gateway URL:', result.gatewayUrl);
    console.log('  Size:', result.size, 'bytes');
    console.log('  Is mock:', result.cid.startsWith('QmMock'));

    if (!result.cid.startsWith('QmMock')) {
      // Real upload — test gateway retrieval
      console.log('\nFetching from gateway...');
      const res = await fetch(result.gatewayUrl, { signal: AbortSignal.timeout(10000) });
      console.log('  Status:', res.status);
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        console.log('  Retrieved agentName:', data.agentName);
        console.log('  ✅ Pinata upload + retrieval WORKING');
      } else {
        console.log('  ❌ Gateway returned', res.status, res.statusText);
      }
    } else {
      console.log('\n⚠️  Mock upload (no PINATA_JWT) — upload API not tested');
    }
  } catch (error) {
    console.error('\n❌ Pinata test FAILED:', error);
    process.exit(1);
  }
}

main();
