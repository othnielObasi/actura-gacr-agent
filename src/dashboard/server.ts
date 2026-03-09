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
import { getCheckpoints, getTradeCheckpoints } from '../trust/checkpoint.js';
import { config } from '../agent/config.js';
import { getReputationTimeline } from '../trust/trust-policy-scorecard.js';
import { getOperatorControlState, getOperatorActionReceipts, pauseTrading, resumeTrading, emergencyStop } from '../agent/operator-control.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PORT = parseInt(process.env.PORT || '3000', 10);

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120;

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

  // Serve the final dashboard JSX
  app.get('/dashboard-app.jsx', (_req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'ActuraDashboard.final.jsx'));
  });

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/versions', express.static(path.join(__dirname, 'versions')));

  // CORS
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
  });

  // ── API Routes ──

  /** Agent overview */
  app.get('/api/status', (_req, res) => {
    const state = getAgentState();
    res.json({
      agent: {
        name: config.agentName,
        pair: config.tradingPair,
        running: state.running,
        cycleCount: state.cycleCount,
      },
      capital: state.risk.capital,
      market: state.market,
      risk: {
        volatility: state.risk.volatility,
        circuitBreaker: state.risk.circuitBreaker,
        openPositions: state.risk.openPositions.length,
        totalTrades: state.risk.totalTrades,
      },
    });
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
        txHash: cp.onChainTxHash || null,
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
          ipfsUrl: match ? `https://gateway.pinata.cloud/ipfs/${match[2]}` : null,
        };
      });
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

  /** Health check — for monitoring / uptime checks */
  app.get('/api/health', (_req, res) => {
    const health = getHealthCheck();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
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
