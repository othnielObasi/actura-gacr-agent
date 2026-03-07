/**
 * Dashboard Server
 * Serves the Actura web dashboard + API endpoints
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAgentState, getHealthCheck, getLogs, getErrors } from '../agent/index.js';
import { getCheckpoints, getTradeCheckpoints } from '../trust/checkpoint.js';
import { config } from '../agent/config.js';
import { getReputationTimeline } from '../trust/trust-policy-scorecard.js';
import { getOperatorControlState, getOperatorActionReceipts, pauseTrading, resumeTrading, emergencyStop } from '../agent/operator-control.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PORT = 3000;

export function startDashboard(port: number = DASHBOARD_PORT): void {
  const app = express();
  app.use(express.json());

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));

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

  app.listen(port, () => {
    console.log(`[DASHBOARD] Running on http://localhost:${port}`);
  });
}
