/**
 * IPFS Upload via Pinata
 * Uploads validation artifacts and returns CID
 */

import { config } from '../agent/config.js';
import type { ValidationArtifact } from './artifact-emitter.js';

export interface IpfsUploadResult {
  cid: string;
  uri: string;         // ipfs://Qm...
  gatewayUrl: string;  // https://gateway.pinata.cloud/ipfs/Qm...
  size: number;
}

/**
 * Upload a validation artifact to IPFS via Pinata
 */
export async function uploadArtifact(artifact: ValidationArtifact): Promise<IpfsUploadResult> {
  if (!config.pinataJwt) {
    // Fallback: return local hash for testing
    return mockUpload(artifact);
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
    return {
      cid: data.IpfsHash,
      uri: `ipfs://${data.IpfsHash}`,
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
      size: data.PinSize,
    };
  } catch (error) {
    console.error('[IPFS] Upload failed, using mock:', error);
    return mockUpload(artifact);
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
