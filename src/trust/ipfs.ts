/**
 * IPFS Upload via Pinata
 * Uploads validation artifacts and returns CID
 * Local backup ensures artifacts survive pinning service lapses.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from '../agent/config.js';
import { createLogger } from '../agent/logger.js';
import type { ValidationArtifact } from './artifact-emitter.js';

const log = createLogger('IPFS');
const ARTIFACT_DIR = join(process.cwd(), 'artifacts');

/** Resolve the IPFS gateway base URL (no trailing slash). */
function gatewayBase(): string {
  return config.pinataGateway.replace(/\/+$/, '');
}

export interface IpfsUploadResult {
  cid: string;
  uri: string;         // ipfs://Qm...
  gatewayUrl: string;  // https://<gateway>/ipfs/Qm...
  size: number;
}

/**
 * Save artifact JSON to local disk so it can be re-pinned if the
 * pinning service lapses (link-rot protection).
 */
function saveLocalBackup(artifact: ValidationArtifact, cid: string): void {
  try {
    if (!existsSync(ARTIFACT_DIR)) {
      mkdirSync(ARTIFACT_DIR, { recursive: true });
    }
    const filename = `${artifact.timestamp.replace(/[:.]/g, '-')}-${cid}.json`;
    writeFileSync(
      join(ARTIFACT_DIR, filename),
      JSON.stringify(artifact, null, 2),
      'utf-8',
    );
  } catch {
    // Best-effort — don't let backup failures block the pipeline.
  }
}

/**
 * Upload a validation artifact to IPFS via Pinata
 */
export async function uploadArtifact(artifact: ValidationArtifact): Promise<IpfsUploadResult> {
  if (!config.pinataJwt) {
    log.warn('PINATA_JWT not set — using mock CID (artifact will NOT be on IPFS)');
    const result = mockUpload(artifact);
    saveLocalBackup(artifact, result.cid);
    return result;
  }

  const body = JSON.stringify(artifact, null, 2);

  const formData = new FormData();
  const blob = new Blob([body], { type: 'application/json' });
  formData.append('file', blob, `actura-artifact-${Date.now()}.json`);

  const metadata = JSON.stringify({
    name: `actura-${artifact.type}-${artifact.timestamp}`,
    keyvalues: {
      agentName: artifact.agentName,
      type: artifact.type,
      approved: String(artifact.decision.approved),
    }
  });
  formData.append('pinataMetadata', metadata);

  // Retry up to 2 times for transient failures (network blips, 5xx, timeouts)
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.pinataJwt}`,
        },
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`Pinata ${response.status} ${response.statusText}: ${errBody.slice(0, 200)}`);
      }

      const data = await response.json() as { IpfsHash: string; PinSize: number };
      const result: IpfsUploadResult = {
        cid: data.IpfsHash,
        uri: `ipfs://${data.IpfsHash}`,
        gatewayUrl: `${gatewayBase()}/${data.IpfsHash}`,
        size: data.PinSize,
      };
      saveLocalBackup(artifact, result.cid);
      if (attempt > 1) log.info(`Pinata upload succeeded on attempt ${attempt}`);
      return result;
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      log.warn(`Pinata upload attempt ${attempt}/3 failed: ${msg.slice(0, 200)}`);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 2000)); // 2s, 4s backoff
      }
    }
  }

  log.error('Pinata upload failed after 3 attempts — using mock CID', {
    error: lastError instanceof Error ? lastError.message.slice(0, 200) : String(lastError),
    jwtPresent: !!config.pinataJwt,
    jwtLength: config.pinataJwt.length,
  });
  const fallback = mockUpload(artifact);
  saveLocalBackup(artifact, fallback.cid);
  return fallback;
}

/**
 * Mock upload for testing without Pinata
 * Returns a deterministic hash based on content
 */
function mockUpload(artifact: ValidationArtifact): IpfsUploadResult {
  const content = JSON.stringify(artifact);
  // Simple hash for testing
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const mockCid = `QmMock${Math.abs(hash).toString(16).padStart(32, '0')}`;
  
  return {
    cid: mockCid,
    uri: `ipfs://${mockCid}`,
    gatewayUrl: `${gatewayBase()}/${mockCid}`,
    size: content.length,
  };
}

/**
 * Upload raw JSON to IPFS (for registration file, etc.)
 */
export async function uploadJson(data: object, name: string): Promise<IpfsUploadResult> {
  if (!config.pinataJwt) {
    log.warn('PINATA_JWT not set — using mock CID for JSON upload');
    return mockUpload(data as ValidationArtifact);
  }

  const body = JSON.stringify(data, null, 2);
  const formData = new FormData();
  const blob = new Blob([body], { type: 'application/json' });
  formData.append('file', blob, `${name}.json`);

  const metadata = JSON.stringify({ name });
  formData.append('pinataMetadata', metadata);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.pinataJwt}`,
      },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Pinata upload failed: ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const result = await response.json() as { IpfsHash: string; PinSize: number };
    return {
      cid: result.IpfsHash,
      uri: `ipfs://${result.IpfsHash}`,
      gatewayUrl: `${gatewayBase()}/${result.IpfsHash}`,
      size: result.PinSize,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`JSON upload to Pinata failed: ${msg.slice(0, 200)} — using mock CID`);
    return mockUpload(data as ValidationArtifact);
  }
}
