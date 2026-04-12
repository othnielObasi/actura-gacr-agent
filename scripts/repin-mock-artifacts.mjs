#!/usr/bin/env node
/**
 * Re-pin all mock-CID artifacts to Pinata and update trades.jsonl.
 * For trades with no artifact file, generate a minimal one from trade data.
 * Run on server: cd /opt/actura && node scripts/repin-mock-artifacts.mjs
 */
import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ARTIFACT_DIR = join(process.cwd(), 'artifacts');
const TRADES_FILE = join(process.cwd(), '.actura', 'trades.jsonl');

function readEnvJwt() {
  const envFile = readFileSync(join(process.cwd(), '.env'), 'utf-8');
  const match = envFile.match(/^PINATA_JWT=(.+)$/m);
  if (!match) throw new Error('PINATA_JWT not found in .env');
  return match[1].trim();
}

const JWT = process.env.PINATA_JWT || readEnvJwt();

async function pinToIPFS(jsonContent, name) {
  const formData = new FormData();
  const blob = new Blob([jsonContent], { type: 'application/json' });
  formData.append('file', blob, `${name}.json`);
  formData.append('pinataMetadata', JSON.stringify({ name }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${JWT}` },
    body: formData,
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Pinata ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.IpfsHash;
}

/** Build a minimal artifact from trade data for trades with no artifact file */
function buildArtifactFromTrade(trade) {
  return {
    version: '1.0',
    agentName: 'Actura',
    agentId: 18,
    timestamp: trade.openedAt,
    type: 'trade_checkpoint',
    trade: {
      asset: trade.asset || 'WETH/USDC',
      side: trade.side,
      size: trade.size || 0,
      sizeRaw: trade.size || 0,
      entryPrice: trade.entryPrice,
      stopLossPrice: null,
      valueUsd: (trade.size || 0) * trade.entryPrice,
    },
    strategy: {
      name: 'regime-governance',
      signal: trade.side,
      signalConfidence: 0.5,
      signalReason: 'Reconstructed from trade log',
      smaFast: null,
      smaSlow: null,
    },
    risk: {
      currentVolatility: null,
      baselineVolatility: 0.02,
      volatilityRatio: 1,
      volatilityRegime: 'NORMAL',
      positionSizeRaw: trade.size || 0,
      positionSizeAdjusted: trade.size || 0,
      stopLossPrice: null,
      dailyPnl: 0,
    },
    decision: {
      approved: true,
      reason: 'Reconstructed artifact for historical trade',
    },
    result: {
      pnl: trade.pnl,
      exitPrice: trade.exitPrice,
      closedAt: trade.closedAt,
      closeReason: trade.reason,
    },
  };
}

async function main() {
  if (!existsSync(ARTIFACT_DIR)) mkdirSync(ARTIFACT_DIR, { recursive: true });

  // 1. Read all trades
  const tradesRaw = readFileSync(TRADES_FILE, 'utf-8').trim();
  const trades = tradesRaw.split('\n').map(l => JSON.parse(l));
  console.log(`Total trades: ${trades.length}`);

  // 2. Find trades with mock CIDs
  const mockTrades = [];
  for (let i = 0; i < trades.length; i++) {
    if (trades[i].ipfsCid && trades[i].ipfsCid.startsWith('QmMock')) {
      mockTrades.push(i);
    }
  }
  console.log(`Trades with mock CIDs: ${mockTrades.length}`);

  // 3. Index existing artifact files by their mock CID
  const artifactFiles = readdirSync(ARTIFACT_DIR).filter(f => f.includes('QmMock'));
  console.log(`Mock artifact files on disk: ${artifactFiles.length}`);

  let pinned = 0;
  let generated = 0;
  let failed = 0;

  // 4. For each mock trade, find or generate an artifact, pin it, update the trade
  for (const tradeIdx of mockTrades) {
    const trade = trades[tradeIdx];
    const oldCid = trade.ipfsCid;
    let content;
    let sourceFile = null;

    // Try to find a matching artifact file by CID
    const matchFile = artifactFiles.find(f => f.includes(oldCid));
    if (matchFile) {
      content = readFileSync(join(ARTIFACT_DIR, matchFile), 'utf-8');
      sourceFile = matchFile;
    } else {
      // Generate artifact from trade data
      const artifact = buildArtifactFromTrade(trade);
      content = JSON.stringify(artifact, null, 2);
      generated++;
    }

    try {
      const realCid = await pinToIPFS(content, `actura-trade-${trade.openedAt.replace(/[:.]/g, '-')}`);
      trades[tradeIdx].ipfsCid = realCid;
      pinned++;

      // Save/rename local file
      if (sourceFile) {
        const newFilename = sourceFile.replace(oldCid, realCid);
        renameSync(join(ARTIFACT_DIR, sourceFile), join(ARTIFACT_DIR, newFilename));
        // Remove from list so we don't process twice
        const idx = artifactFiles.indexOf(sourceFile);
        if (idx >= 0) artifactFiles.splice(idx, 1);
      } else {
        const ts = trade.openedAt.replace(/[:.]/g, '-');
        writeFileSync(join(ARTIFACT_DIR, `${ts}-${realCid}.json`), content, 'utf-8');
      }

      console.log(`  ✓ trade[${tradeIdx}] ${oldCid.slice(0,20)}… → ${realCid}`);

      // Rate limit
      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      failed++;
      console.error(`  ✗ trade[${tradeIdx}] ${oldCid.slice(0,20)}… FAILED: ${err.message.slice(0, 200)}`);
    }
  }

  // 5. Also pin any leftover artifact files not matched to trades
  const remainingFiles = readdirSync(ARTIFACT_DIR).filter(f => f.includes('QmMock'));
  if (remainingFiles.length > 0) {
    console.log(`\nPinning ${remainingFiles.length} remaining orphan artifact files...`);
    for (const f of remainingFiles) {
      const content = readFileSync(join(ARTIFACT_DIR, f), 'utf-8');
      const mockCid = f.match(/(QmMock[a-f0-9]+)/)?.[1];
      if (!mockCid) continue;
      try {
        const realCid = await pinToIPFS(content, `actura-orphan-${mockCid.slice(0, 12)}`);
        renameSync(join(ARTIFACT_DIR, f), join(ARTIFACT_DIR, f.replace(mockCid, realCid)));
        pinned++;
        console.log(`  ✓ orphan ${mockCid.slice(0,20)}… → ${realCid}`);
        await new Promise(r => setTimeout(r, 800));
      } catch (err) {
        failed++;
        console.error(`  ✗ orphan ${f} FAILED: ${err.message.slice(0, 200)}`);
      }
    }
  }

  // 6. Write updated trades back
  const newContent = trades.map(t => JSON.stringify(t)).join('\n') + '\n';
  writeFileSync(TRADES_FILE, newContent, 'utf-8');

  const remaining = trades.filter(t => t.ipfsCid?.startsWith('QmMock')).length;
  console.log(`\nDone: ${pinned} pinned (${generated} generated), ${failed} failed, ${remaining} still mock`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
