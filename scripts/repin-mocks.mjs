#!/usr/bin/env node
/**
 * Re-pin mock-CID artifacts to real IPFS via Pinata (primary account).
 * For each QmMock file:
 *   1. Read the local JSON backup
 *   2. Upload to Pinata → get real CID
 *   3. Rename the file from QmMock... to the real CID
 *   4. Log old → new mapping
 */

import { readFileSync, readdirSync, renameSync } from 'fs';
import { join } from 'path';
import 'dotenv/config';

const ARTIFACT_DIR = join(process.cwd(), 'artifacts');
const JWT = process.env.PINATA_JWT_PRIMARY || process.env.PINATA_JWT;

if (!JWT) {
  console.error('No Pinata JWT found in env');
  process.exit(1);
}

const files = readdirSync(ARTIFACT_DIR)
  .filter(f => f.includes('QmMock') && f.endsWith('.json'))
  .sort();

console.log(`Found ${files.length} mock-CID artifacts to re-pin\n`);

let success = 0;
let failed = 0;

for (const filename of files) {
  const filepath = join(ARTIFACT_DIR, filename);
  const body = readFileSync(filepath, 'utf-8');

  let artifact;
  try {
    artifact = JSON.parse(body);
  } catch {
    console.error(`  SKIP ${filename} — invalid JSON`);
    failed++;
    continue;
  }

  // Build metadata matching what the live agent sends
  const name = artifact.type && artifact.timestamp
    ? `actura-${artifact.type}-${artifact.timestamp}`
    : `actura-repin-${filename}`;

  const metadata = JSON.stringify({
    name,
    keyvalues: {
      agentName: artifact.agentName || 'Actura',
      type: artifact.type || 'unknown',
      approved: String(artifact.decision?.approved ?? true),
      repinned: 'true',
    },
  });

  const formData = new FormData();
  const blob = new Blob([body], { type: 'application/json' });
  formData.append('file', blob, `${name}.json`);
  formData.append('pinataMetadata', metadata);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${JWT}` },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const realCid = data.IpfsHash;

    // Rename the file: replace QmMock... with the real CID
    const oldMockCid = filename.match(/QmMock[0-9a-f]+/)?.[0] || '';
    const newFilename = filename.replace(oldMockCid, realCid);
    renameSync(filepath, join(ARTIFACT_DIR, newFilename));

    console.log(`  ✓ ${oldMockCid} → ${realCid}`);
    success++;

    // Small delay to avoid rate-limiting
    await new Promise(r => setTimeout(r, 500));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ✗ ${filename}: ${msg.slice(0, 200)}`);
    failed++;
  }
}

console.log(`\nDone: ${success} re-pinned, ${failed} failed (of ${files.length} total)`);
