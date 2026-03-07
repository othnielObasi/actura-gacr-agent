/**
 * IPFS Upload via Pinata
 * Uploads validation artifacts and returns CID
 * Local backup ensures artifacts survive pinning service lapses.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from '../agent/config.js';
import type { ValidationArtifact } from './artifact-emitter.js';

const ARTIFACT_DIR = join(process.cwd(), 'artifacts');

export interface IpfsUploadResult {
  cid: string;
  uri: string;         // ipfs://Qm...
  gatewayUrl: string;  // https://gateway.pinata.cloud/ipfs/Qm...
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

  try {
    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.pinataJwt}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Pinata upload failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { IpfsHash: string; PinSize: number };
    const result: IpfsUploadResult = {
      cid: data.IpfsHash,
      uri: `ipfs://${data.IpfsHash}`,
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
      size: data.PinSize,
    };
    saveLocalBackup(artifact, result.cid);
    return result;
  } catch (error) {
    console.error('[IPFS] Upload failed, using mock:', error);
    const fallback = mockUpload(artifact);
    saveLocalBackup(artifact, fallback.cid);
    return fallback;
  }
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
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/${mockCid}`,
    size: content.length,
  };
}

/**
 * Upload raw JSON to IPFS (for registration file, etc.)
 */
export async function uploadJson(data: object, name: string): Promise<IpfsUploadResult> {
  if (!config.pinataJwt) {
    return mockUpload(data as ValidationArtifact);
  }

  const body = JSON.stringify(data, null, 2);
  const formData = new FormData();
  const blob = new Blob([body], { type: 'application/json' });
  formData.append('file', blob, `${name}.json`);

  const metadata = JSON.stringify({ name });
  formData.append('pinataMetadata', metadata);

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.pinataJwt}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Pinata upload failed: ${response.status}`);
  }

  const result = await response.json() as { IpfsHash: string; PinSize: number };
  return {
    cid: result.IpfsHash,
    uri: `ipfs://${result.IpfsHash}`,
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`,
    size: result.PinSize,
  };
}
