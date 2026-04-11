/**
 * Dashboard Server
 * Serves the Actura web dashboard + API endpoints
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Server } from 'http';
import { getAgentState, getHealthCheck, getLogs, getErrors } from '../agent/index.js';
import { getRecentTrades, getTradeStats, loadClosedTrades } from '../agent/trade-log.js';
import { computeRiskAdjustedMetrics, type EquityPoint } from '../analytics/performance-metrics.js';
import { getCheckpoints, getTradeCheckpoints } from '../trust/checkpoint.js';
import { config } from '../agent/config.js';
import { getReputationTimeline, getLastTrustScore } from '../trust/trust-policy-scorecard.js';
import { getOperatorControlState, getOperatorActionReceipts, pauseTrading, resumeTrading, emergencyStop } from '../agent/operator-control.js';
import { buildRegistrationJson } from '../chain/identity.js';
import { generateTradePost, generateDailySummaryPost, buildTwitterIntentUrl } from '../social/share.js';
import { getSAGEStatus, getActivePlaybookRules } from '../strategy/sage-engine.js';
import { getKrakenFeedStatus, fetchKrakenTicker, fetchKrakenBalance, fetchKrakenOpenOrders, fetchKrakenTradeHistory } from '../data/kraken-feed.js';
import { fetchPrismData } from '../data/prism-feed.js';
import { getCliStatus, checkCliHealth } from '../data/kraken-cli.js';
import { getKrakenAccountSnapshot, krakenPreflight } from '../data/kraken-bridge.js';
import { getIndexedEvents, getIndexerStatus } from '../chain/event-indexer.js';
import { generateAttestationSummary } from '../security/tee-attestation.js';
import { getAverageValidationScore } from '../chain/validation.js';
import { getHackathonReputation } from '../chain/reputation.js';
import { ethers } from 'ethers';
import { getWallet } from '../chain/sdk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PORT = parseInt(process.env.PORT || '3000', 10);

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 600;

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_MAX_REQUESTS) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
}

// Periodic cleanup of stale rate-limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, RATE_WINDOW_MS);

let httpServer: Server | null = null;

export function stopDashboard(): Promise<void> {
  return new Promise((resolve) => {
    if (httpServer) {
      httpServer.close(() => resolve());
    } else {
      resolve();
    }
  });
}

export function startDashboard(port: number = DASHBOARD_PORT): void {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit);

  // Security headers
  app.use((_req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Default route → final production dashboard
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Trade history page — separate tab
  app.get('/trades', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'trades.html'));
  });

  // Judge walkthrough — single-page hackathon summary
  app.get('/judge', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'judge.html'));
  });

  // Serve the final dashboard JSX
  app.get('/dashboard-app.jsx', (_req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'ActuraDashboard.final.jsx'));
  });

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/versions', express.static(path.join(__dirname, 'versions')));

  // CORS — allow localhost and production domains
  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    const allowed = origin && (
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
      /^https:\/\/(app|api)\.actura\.nov-tia\.com$/.test(origin)
    );
    if (allowed) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // ── A2A Agent Discovery ──
  app.get('/.well-known/agent-card.json', (_req, res) => {
    const registration = buildRegistrationJson({
      agentId: config.agentId ?? undefined,
      dashboardUrl: config.dashboardUrl,
      mcpEndpoint: config.mcpEndpoint,
      a2aEndpoint: config.a2aEndpoint,
      imageUrl: config.agentImageUrl,
    });
    res.json(registration);
  });

  // ── API Routes ──

  /** Agent overview */
  app.get('/api/status', (_req, res) => {
    const state = getAgentState();
    const schedulerState = state.scheduler;
    const recentTrades = getRecentTrades(1);
    const lastClosedAt = recentTrades.length > 0 ? recentTrades[0].closedAt : null;
    // Also consider open positions — the most recently opened one counts as trade activity
    const openPositions = state.risk.openPositions;
    const lastOpenedAt = openPositions.length > 0
      ? openPositions.reduce((latest: string | null, p: any) => {
          if (!p.openedAt) return latest;
          return !latest || p.openedAt > latest ? p.openedAt : latest;
        }, null as string | null)
      : null;
    // Use whichever is more recent: last closed trade or last opened position
    const lastTradeAt = [lastClosedAt, lastOpenedAt]
      .filter(Boolean)
      .sort()
      .pop() ?? null;
    res.json({
      agent: {
        name: config.agentName,
        pair: config.tradingPair,
        running: state.running,
        cycleCount: state.cycleCount,
      },
      heartbeat: {
        running: state.running,
        lastCycleAt: schedulerState?.lastCycleAt ?? null,
        lastTradeAt,
        uptime: schedulerState?.uptime ?? 0,
        consecutiveErrors: schedulerState?.consecutiveErrors ?? 0,
        lastError: schedulerState?.lastError ?? null,
        lastErrorAt: schedulerState?.lastErrorAt ?? null,
      },
      capital: state.risk.capital,
      market: state.market,
      risk: {
        volatility: state.risk.volatility,
        circuitBreaker: state.risk.circuitBreaker,
        openPositions: state.risk.openPositions.length,
        totalTrades: state.risk.totalTrades,
      },
      sentiment: state.sentiment ?? null,
    });
  });

  /** Hackathon sandbox status */
  app.get('/api/sandbox', async (_req, res) => {
    try {
      const aId = config.agentId;
      const chain = config.chainId || 11155111;
      const riskRouter = config.riskRouterAddress || '';
      const vaultAddr = config.hackathonVaultAddress || '';
      const registryAddr = config.agentRegistryAddress || '';
      const reputationAddr = config.reputationRegistry || '';
      const validationAddr = config.validationRegistry || '';

      let vaultBalance: string | null = null;
      let walletBalance: string | null = null;
      let validationScore: number | null = null;
      let reputationScore: number | null = null;

      try {
        const wallet = getWallet();
        walletBalance = ethers.formatEther(await wallet.provider!.getBalance(wallet.address));
      } catch { /* chain not init */ }

      if (aId && vaultAddr) {
        try {
          const wallet = getWallet();
          const vault = new ethers.Contract(vaultAddr, ['function getBalance(uint256 agentId) external view returns (uint256)'], wallet);
          vaultBalance = ethers.formatEther(await vault.getBalance(aId));
        } catch { /* vault read failed */ }
      }

      if (aId) {
        try { validationScore = await getAverageValidationScore(aId); } catch { /* no score yet */ }
        try { reputationScore = await getHackathonReputation(aId); } catch { /* no score yet */ }
      }

      res.json({
        connected: !!riskRouter,
        chainId: chain,
        network: chain === 11155111 ? 'Sepolia' : chain === 84532 ? 'Base Sepolia' : `Chain ${chain}`,
        agentId: aId || null,
        walletBalance,
        vaultBalance,
        validationScore,
        reputationScore,
        contracts: {
          agentRegistry: registryAddr || null,
          hackathonVault: vaultAddr || null,
          riskRouter: riskRouter || null,
          reputationRegistry: reputationAddr || null,
          validationRegistry: validationAddr || null,
        },
      });
    } catch (e) {
      res.json({ connected: false, error: String(e) });
    }
  });

  /** Recent checkpoints */
  app.get('/api/checkpoints', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const approvedOnly = req.query.approved === 'true';
    const checkpoints = approvedOnly ? getTradeCheckpoints(limit) : getCheckpoints(limit);

    res.json({
      count: checkpoints.length,
      checkpoints: checkpoints.map(cp => ({
        id: cp.id,
        timestamp: cp.timestamp,
        signal: cp.strategyOutput.signal.direction,
        confidence: cp.strategyOutput.signal.confidence,
        price: cp.strategyOutput.currentPrice,
        approved: cp.riskDecision.approved,
        explanation: cp.riskDecision.explanation,
        positionSize: cp.riskDecision.finalPositionSize,
        artifactIpfs: cp.ipfs?.uri || null,
        ipfsCid: cp.ipfs?.cid || null,
        txHash: cp.onChainTxHash || null,
        onChainTxHash: cp.onChainTxHash || null,
      })),
    });
  });

  /** Last artifact (full JSON) */
  app.get('/api/artifact/latest', (_req, res) => {
    const checkpoints = getCheckpoints(1);
    if (checkpoints.length === 0) {
      res.json({ error: 'No artifacts yet' });
      return;
    }
    res.json(checkpoints[0].artifact);
  });

  /** Full artifact by checkpoint index (1-based from most recent) */
  app.get('/api/artifact/:idx', (req, res) => {
    const idx = parseInt(req.params.idx);
    if (isNaN(idx) || idx < 1) { res.json({ error: 'Invalid index' }); return; }
    const checkpoints = getCheckpoints(idx);
    const cp = checkpoints[idx - 1];
    if (!cp) { res.json({ error: 'Checkpoint not found' }); return; }
    res.json(cp.artifact || { error: 'No artifact for this checkpoint' });
  });

  /** List on-disk artifacts with IPFS CIDs */
  app.get('/api/artifacts', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    try {
      const dir = path.join(process.cwd(), 'artifacts');
      if (!fs.existsSync(dir)) { res.json({ count: 0, artifacts: [] }); return; }
      const allFiles = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'));
      const files = allFiles.sort().reverse().slice(0, limit);
      const artifacts = files.map((f: string) => {
        const match = f.match(/^(.+Z)-(.+)\.json$/);
        return {
          file: f,
          timestamp: match ? match[1].replace(/-/g, ':').replace(/T(\d+):(\d+):(\d+):(\d+)/, 'T$1:$2:$3.$4') : f,
          cid: match ? match[2] : null,
          ipfsUrl: match ? `${config.pinataGateway.replace(/\/+$/, '')}/${match[2]}` : null,
        };
      }).filter(a => a.cid && !a.cid.startsWith('QmMock'));
      res.json({ count: artifacts.length, total: allFiles.length, artifacts });
    } catch (e) {
      res.json({ count: 0, artifacts: [], error: String(e) });
    }
  });

  /** Positions */
  app.get('/api/positions', (_req, res) => {
    const state = getAgentState();
    res.json({ positions: state.risk.openPositions });
  });

  /** Governance policy */
  app.get('/api/governance', (_req, res) => {
    res.json({
      strategy: config.strategy,
      riskLimits: {
        maxPositionPct: config.maxPositionPct,
        maxDailyLossPct: config.maxDailyLossPct,
        maxDrawdownPct: config.maxDrawdownPct,
      },
    });
  });

  /** Reputation evolution */
  app.get('/api/reputation/history', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({ history: getReputationTimeline(getAgentState().agentId, limit) });
  });

  /** Operator control state */
  app.get('/api/operator/state', (_req, res) => {
    res.json(getOperatorControlState());
  });

  app.get('/api/operator/actions', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    res.json({ actions: getOperatorActionReceipts(limit) });
  });

  app.post('/api/operator/pause', (req, res) => {
    const receipt = pauseTrading(req.body?.reason || 'manual pause from dashboard', req.body?.actor || 'dashboard');
    res.json({ ok: true, receipt, state: getOperatorControlState() });
  });

  app.post('/api/operator/resume', (req, res) => {
    const receipt = resumeTrading(req.body?.reason || 'manual resume from dashboard', req.body?.actor || 'dashboard');
    res.json({ ok: true, receipt, state: getOperatorControlState() });
  });

  app.post('/api/operator/emergency-stop', (req, res) => {
    const receipt = emergencyStop(req.body?.reason || 'emergency stop from dashboard', req.body?.actor || 'dashboard');
    res.json({ ok: true, receipt, state: getOperatorControlState() });
  });

  /** Closed trade history (persistent — survives restarts) */
  app.get('/api/trades', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    res.json({ trades: getRecentTrades(limit) });
  });

  /** Trade history as CSV download */
  app.get('/api/trades/csv', (_req, res) => {
    const trades = loadClosedTrades();
    const header = 'ID,Asset,Side,Size,Entry Price,Exit Price,PnL ($),PnL (%),Reason,Opened At,Closed At,Duration (min),IPFS CID,Tx Hash';
    const rows = trades.map(t => [
      t.id,
      t.asset,
      t.side,
      t.size.toFixed(6),
      t.entryPrice.toFixed(2),
      t.exitPrice.toFixed(2),
      t.pnl.toFixed(2),
      t.pnlPct.toFixed(2),
      t.reason,
      t.openedAt,
      t.closedAt,
      Math.round(t.durationMs / 60000),
      t.ipfsCid || '',
      t.txHash || '',
    ].join(','));
    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="actura-trades.csv"');
    res.send(csv);
  });

  /** Trade statistics */
  app.get('/api/trades/stats', (_req, res) => {
    const stats = getTradeStats();
    // Use actual capital for PnL instead of summing trades (trade log may be incomplete)
    const state = getAgentState();
    const capital = state.risk?.capital ?? 10_000;
    stats.totalPnl = Math.round((capital - 10_000) * 100) / 100;
    res.json(stats);
  });

  /** Risk-adjusted performance metrics (Sharpe, Sortino, Calmar, Max DD) */
  app.get('/api/performance', (_req, res) => {
    const trades = loadClosedTrades();
    const stats = getTradeStats();

    // Use actual capital for authoritative PnL
    const state = getAgentState();
    const currentCapital = state.risk?.capital ?? 10_000;
    stats.totalPnl = Math.round((currentCapital - 10_000) * 100) / 100;

    // Build equity curve from closed trades, then scale final point to match real capital
    const initialCapital = 10_000;
    let equity = initialCapital;
    const equityPoints: EquityPoint[] = [{ timestamp: trades[0]?.closedAt || new Date().toISOString(), equity: initialCapital }];
    for (const t of trades) {
      equity += t.pnl;
      equityPoints.push({ timestamp: t.closedAt, equity });
    }
    // Correct final equity to match actual capital
    if (equityPoints.length > 0) {
      equityPoints[equityPoints.length - 1].equity = currentCapital;
    }

    const metrics = computeRiskAdjustedMetrics(
      equityPoints,
      trades.map(t => ({ pnl: t.pnl })),
    );

    res.json({
      ...stats,
      sharpeRatio: Math.round(metrics.sharpeRatio * 1000) / 1000,
      sortinoRatio: Math.round(metrics.sortinoRatio * 1000) / 1000,
      maxDrawdownPct: Math.round(metrics.maxDrawdown * 10000) / 100,
      calmarRatio: Math.round(metrics.calmarRatio * 1000) / 1000,
      profitFactor: Math.round(metrics.profitFactor * 100) / 100,
      totalReturnPct: Math.round((currentCapital - 10_000) / 10_000 * 10000) / 100,
      volatility: Math.round(metrics.volatility * 10000) / 100,
      currentEquity: Math.round(currentCapital * 100) / 100,
      equityPoints: equityPoints.length,
    });
  });

  /** Health check — for monitoring / uptime checks */
  app.get('/api/health', (_req, res) => {
    const health = getHealthCheck();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  /** PRISM external market intelligence */
  app.get('/api/prism', async (_req, res) => {
    try {
      const data = await fetchPrismData('ETH');
      res.json(data);
    } catch (err: any) {
      res.json({ signal: null, risk: null, sources: [], error: err.message });
    }
  });

  /** Recent logs */
  app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({ logs: getLogs(limit) });
  });

  /** Error logs */
  app.get('/api/errors', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    res.json({ errors: getErrors(limit) });
  });

  /** On-chain indexed events */
  app.get('/api/events', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const typeFilter = req.query.type as string | undefined;
    const validTypes = ['reputation_feedback', 'validation_request', 'validation_response'];
    const events = validTypes.includes(typeFilter as string)
      ? getIndexedEvents(typeFilter as any).slice(-limit)
      : getIndexedEvents().slice(-limit);
    res.json({ count: events.length, indexer: getIndexerStatus(), events });
  });

  /** Kraken feed status + live ticker */
  app.get('/api/feeds/kraken', async (_req, res) => {
    const status = getKrakenFeedStatus();
    const ticker = await fetchKrakenTicker();
    res.json({ status, ticker });
  });

  /** Kraken account balance (authenticated) */
  app.get('/api/kraken/balance', async (_req, res) => {
    const balance = await fetchKrakenBalance();
    if (!balance) { res.json({ error: 'Kraken API keys not configured or request failed' }); return; }
    res.json({ balance });
  });

  /** Kraken open orders (authenticated) */
  app.get('/api/kraken/orders', async (_req, res) => {
    const orders = await fetchKrakenOpenOrders();
    if (!orders) { res.json({ error: 'Kraken API keys not configured or request failed' }); return; }
    res.json({ count: orders.length, orders });
  });

  /** Kraken trade history (authenticated) */
  app.get('/api/kraken/trades', async (_req, res) => {
    const trades = await fetchKrakenTradeHistory();
    if (!trades) { res.json({ error: 'Kraken API keys not configured or request failed' }); return; }
    res.json({ count: trades.length, trades });
  });

  /** Data feeds overview */
  app.get('/api/feeds/status', (_req, res) => {
    res.json({
      kraken: getKrakenFeedStatus(),
      krakenCli: getCliStatus(),
      indexer: getIndexerStatus(),
    });
  });

  /** Kraken CLI status + health */
  app.get('/api/kraken/cli', async (_req, res) => {
    const status = await checkCliHealth();
    res.json(status);
  });

  /** Kraken account snapshot (balance + orders + trades + CLI status) */
  app.get('/api/kraken/snapshot', async (_req, res) => {
    const snapshot = await getKrakenAccountSnapshot();
    res.json(snapshot);
  });

  /** Kraken preflight check */
  app.get('/api/kraken/preflight', async (_req, res) => {
    const result = await krakenPreflight();
    res.json(result);
  });

  /** Generate shareable trade post */
  app.get('/api/share/trade', (req, res) => {
    const checkpoints = getCheckpoints(1);
    if (checkpoints.length === 0) {
      res.json({ error: 'No checkpoints yet' });
      return;
    }
    const cp = checkpoints[0];
    const state = getAgentState();
    const post = generateTradePost({
      signal: cp.strategyOutput.signal.direction,
      confidence: cp.strategyOutput.signal.confidence,
      price: cp.strategyOutput.currentPrice,
      approved: cp.riskDecision.approved,
      explanation: cp.riskDecision.explanation,
      trustScore: getLastTrustScore(state.agentId) ?? (state.risk as any)?.trustScore ?? 95,
      artifactCid: cp.ipfs?.cid,
    });
    res.json({ post, twitterUrl: buildTwitterIntentUrl(post) });
  });

  /** Generate shareable daily summary */
  app.get('/api/share/daily', (_req, res) => {
    const state = getAgentState();
    const stats = getTradeStats();
    const currentCapital = state.risk?.capital ?? 10_000;
    const realPnl = Math.round((currentCapital - 10_000) * 100) / 100;
    const post = generateDailySummaryPost({
      trades: stats.totalTrades ?? 0,
      pnl: realPnl,
      capital: currentCapital,
      trustScore: getLastTrustScore(state.agentId) ?? (state.risk as any)?.trustScore ?? 95,
      winRate: stats.winRate ?? 0,
      artifactCount: stats.totalTrades ?? 0,
    });
    res.json({ post, twitterUrl: buildTwitterIntentUrl(post) });
  });

  /** Security status: TEE attestation + EIP-1271 capability */
  app.get('/api/security', async (_req, res) => {
    try {
      const tee = await generateAttestationSummary();
      res.json({
        teeAttestation: tee,
        eip1271: {
          enabled: true,
          verificationMethod: 'auto-detect',
          supportedTypes: ['eoa', 'eip1271-contract'],
          note: 'Every TradeIntent is EIP-1271 verified before Risk Router submission',
        },
      });
    } catch (e) {
      res.json({
        teeAttestation: null,
        eip1271: {
          enabled: true,
          verificationMethod: 'auto-detect',
          supportedTypes: ['eoa', 'eip1271-contract'],
          note: 'Every TradeIntent is EIP-1271 verified before Risk Router submission',
        },
        error: String(e),
      });
    }
  });

  /** SAGE (Self-Adapting Generative Engine) status */
  app.get('/api/sage/status', (_req, res) => {
    try {
      res.json(getSAGEStatus());
    } catch (e) {
      res.status(500).json({ error: 'Failed to get SAGE status' });
    }
  });

  /** SAGE playbook rules */
  app.get('/api/sage/playbook', (_req, res) => {
    try {
      const rules = getActivePlaybookRules();
      const status = getSAGEStatus();
      res.json({
        rules,
        totalRules: rules.length,
        maxRules: status.maxRules,
        reflectionCount: status.reflectionCount,
        lastReflection: status.lastReflection,
        weights: status.weights,
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to get SAGE playbook' });
    }
  });

  httpServer = app.listen(port, () => {
    console.log(`[DASHBOARD] Running on http://localhost:${port}`);
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[DASHBOARD] Port ${port} in use, retrying in 3s...`);
      setTimeout(() => {
        httpServer?.close();
        httpServer = app.listen(port, () => {
          console.log(`[DASHBOARD] Running on http://localhost:${port}`);
        });
      }, 3000);
    }
  });
}
