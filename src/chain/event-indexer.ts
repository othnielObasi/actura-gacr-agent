/**
 * On-Chain Event Indexer — ERC-8004 Registry Event Poller
 *
 * Polls Identity, Reputation, and Validation registry contracts for
 * events related to this agent. Builds a local index of on-chain
 * activity for the dashboard and MCP surface.
 *
 * This is a lightweight alternative to a full subgraph — no external
 * infrastructure required.
 */

import { ethers } from 'ethers';
import { config } from '../agent/config.js';
import { getProvider } from './sdk.js';
import { createLogger } from '../agent/logger.js';

const log = createLogger('INDEXER');

// ── Event ABIs ──

const IDENTITY_EVENTS = [
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const REPUTATION_EVENTS = [
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
];

const VALIDATION_EVENTS = [
  'event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)',
  'event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)',
];

// ── Indexed Event Types ──

export interface IndexedEvent {
  type: 'identity_transfer' | 'reputation_feedback' | 'validation_request' | 'validation_response';
  blockNumber: number;
  txHash: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ── State ──

let events: IndexedEvent[] = [];
let lastIndexedBlock = 0;
let isRunning = false;

// ── Indexing Logic ──

/**
 * Poll for new events since last indexed block.
 * Called periodically by the agent loop or on-demand from dashboard.
 */
export async function pollEvents(agentId: number | null): Promise<IndexedEvent[]> {
  if (!agentId) return [];

  const provider = getProvider();
  const currentBlock = await provider.getBlockNumber();

  // On first run, look back ~1000 blocks (~30 min on Base Sepolia)
  if (lastIndexedBlock === 0) {
    lastIndexedBlock = Math.max(0, currentBlock - 1000);
  }

  // Nothing new
  if (currentBlock <= lastIndexedBlock) return [];

  const fromBlock = lastIndexedBlock + 1;
  const toBlock = currentBlock;
  const newEvents: IndexedEvent[] = [];

  // Index Reputation events
  if (config.reputationRegistry) {
    try {
      const repContract = new ethers.Contract(config.reputationRegistry, REPUTATION_EVENTS, provider);
      const agentIdBigInt = BigInt(agentId);
      const feedbackFilter = repContract.filters.NewFeedback(agentIdBigInt);
      const feedbackLogs = await repContract.queryFilter(feedbackFilter, fromBlock, toBlock);

      for (const ev of feedbackLogs) {
        const parsed = ev as ethers.EventLog;
        newEvents.push({
          type: 'reputation_feedback',
          blockNumber: parsed.blockNumber,
          txHash: parsed.transactionHash,
          timestamp: new Date().toISOString(),
          data: {
            agentId: Number(parsed.args[0]),
            clientAddress: parsed.args[1],
            feedbackIndex: Number(parsed.args[2]),
            value: Number(parsed.args[3]),
            valueDecimals: Number(parsed.args[4]),
            tag1: parsed.args[6],
            tag2: parsed.args[7],
            endpoint: parsed.args[8],
            feedbackURI: parsed.args[9],
          },
        });
      }
    } catch (error) {
      log.debug('Reputation event polling failed', { error: String(error) });
    }
  }

  // Index Validation events
  if (config.validationRegistry) {
    try {
      const valContract = new ethers.Contract(config.validationRegistry, VALIDATION_EVENTS, provider);
      const agentIdBigInt = BigInt(agentId);

      // ValidationRequest events
      const reqFilter = valContract.filters.ValidationRequest(null, agentIdBigInt);
      const reqLogs = await valContract.queryFilter(reqFilter, fromBlock, toBlock);

      for (const ev of reqLogs) {
        const parsed = ev as ethers.EventLog;
        newEvents.push({
          type: 'validation_request',
          blockNumber: parsed.blockNumber,
          txHash: parsed.transactionHash,
          timestamp: new Date().toISOString(),
          data: {
            validatorAddress: parsed.args[0],
            agentId: Number(parsed.args[1]),
            requestURI: parsed.args[2],
            requestHash: parsed.args[3],
          },
        });
      }

      // ValidationResponse events
      const resFilter = valContract.filters.ValidationResponse(null, agentIdBigInt);
      const resLogs = await valContract.queryFilter(resFilter, fromBlock, toBlock);

      for (const ev of resLogs) {
        const parsed = ev as ethers.EventLog;
        newEvents.push({
          type: 'validation_response',
          blockNumber: parsed.blockNumber,
          txHash: parsed.transactionHash,
          timestamp: new Date().toISOString(),
          data: {
            validatorAddress: parsed.args[0],
            agentId: Number(parsed.args[1]),
            requestHash: parsed.args[2],
            response: Number(parsed.args[3]),
            responseURI: parsed.args[4],
            responseHash: parsed.args[5],
            tag: parsed.args[6],
          },
        });
      }
    } catch (error) {
      log.debug('Validation event polling failed', { error: String(error) });
    }
  }

  lastIndexedBlock = toBlock;

  if (newEvents.length > 0) {
    events.push(...newEvents);
    // Keep max 500 events in memory
    if (events.length > 500) {
      events = events.slice(-500);
    }
    log.info(`Indexed ${newEvents.length} new events (blocks ${fromBlock}–${toBlock})`, {
      reputation: newEvents.filter(e => e.type === 'reputation_feedback').length,
      validationReq: newEvents.filter(e => e.type === 'validation_request').length,
      validationRes: newEvents.filter(e => e.type === 'validation_response').length,
    });
  }

  return newEvents;
}

/**
 * Get all indexed events, optionally filtered by type.
 */
export function getIndexedEvents(filter?: IndexedEvent['type']): IndexedEvent[] {
  if (filter) return events.filter(e => e.type === filter);
  return [...events];
}

/**
 * Get indexer status.
 */
export function getIndexerStatus() {
  return {
    running: isRunning,
    totalEvents: events.length,
    lastIndexedBlock,
    eventBreakdown: {
      reputation_feedback: events.filter(e => e.type === 'reputation_feedback').length,
      validation_request: events.filter(e => e.type === 'validation_request').length,
      validation_response: events.filter(e => e.type === 'validation_response').length,
    },
  };
}

/**
 * Start periodic polling (call once from agent init).
 * Polls every 30 seconds.
 */
export function startIndexer(agentId: number | null): void {
  if (isRunning || !agentId) return;
  isRunning = true;

  const poll = async () => {
    if (!isRunning) return;
    try {
      await pollEvents(agentId);
    } catch (error) {
      log.debug('Indexer poll error', { error: String(error) });
    }
  };

  // Initial poll
  poll();

  // Poll every 30 seconds
  setInterval(() => { poll(); }, 30_000);

  log.info('On-chain event indexer started', { agentId, pollIntervalMs: 30_000 });
}

/**
 * Stop the indexer.
 */
export function stopIndexer(): void {
  isRunning = false;
  log.info('On-chain event indexer stopped');
}
