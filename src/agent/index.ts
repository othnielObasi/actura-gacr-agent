/**
 * ACTURA — Accountable Autonomous Trading Agent
 * Production-Grade Main Agent Loop
 *
 * "Not the smartest trader. The most accountable."
 *
 * Features:
 * - Structured logging with levels
 * - Config validation at startup
 * - Retry logic for external calls (IPFS, chain)
 * - Graceful shutdown (SIGINT/SIGTERM)
 * - State persistence (survives restarts)
 * - Position limit enforcement
 * - Scheduler with error recovery
 * - Health check endpoint
 */

import { config } from './config.js';
import { createLogger, getRecentLogs, getErrorLogs } from './logger.js';
import { validateConfig } from './validator.js';
import { Scheduler } from './scheduler.js';
import { retry } from './retry.js';
import { saveState, loadState, savePriceHistory, loadPriceHistory, type PersistedState } from './state.js';
import { runStrategy, resetStrategy, type MarketData } from '../strategy/momentum.js';
import { RiskEngine } from '../risk/engine.js';
import { atr as computeATR } from '../strategy/indicators.js';
import { buildTradeArtifact, enrichArtifact, attachGovernanceEvidence } from '../trust/artifact-emitter.js';
import { getLastTrustScore, seedOutcomeHistory } from '../trust/trust-policy-scorecard.js';
import { evaluateSupervisoryDecision, applySupervisorySizing, summarizeSupervisoryDecision } from './supervisory-meta-agent.js';
import { generateReasoning } from '../strategy/ai-reasoning.js';
import { applySymbolicReasoning, recordOutcome } from '../strategy/neuro-symbolic.js';
import { runAdaptation, recordTradeOutcome, getAdaptiveParams, getAdaptationSummary, type AdaptationArtifact } from '../strategy/adaptive-learning.js';
import { RegimeGovernanceController, mapVolToRegime } from '../strategy/regime-governance.js';
import { loadSAGEState, recordSAGEOutcome, runSAGEReflection, getSAGEStatus, getActivePlaybookRules, isSAGEEnabled } from '../strategy/sage-engine.js';
import { uploadArtifact } from '../trust/ipfs.js';
import { saveCheckpoint, getCheckpoints, getTradeCheckpoints } from '../trust/checkpoint.js';
import { computeMarketState } from '../data/market-state.js';
import { evaluateOracleIntegrity } from '../security/oracle-integrity.js';
import { evaluateMandate, getDefaultMandate, buildMandateRiskChecks } from '../chain/agent-mandate.js';
import { simulateExecution } from '../chain/execution-simulator.js';
import { routeTrade, getDexFeeBps, type RoutingDecision, type DexId } from '../chain/dex-router.js';
import { generateSimulatedData, appendCandle } from '../data/price-feed.js';
import { fetchLivePrice, fetchOHLCHistory, buildLiveCandle, getLiveFeedStatus } from '../data/live-price-feed.js';
import { fetchSentiment, type SentimentResult } from '../data/sentiment-feed.js';
import { fetchPrismData, fetchPrismResolve, prismConfidenceModifier, type PrismData } from '../data/prism-feed.js';
import { getKrakenFeedStatus } from '../data/kraken-feed.js';
import { postCheckpoint } from '../chain/validation.js';
import { checkTradeOnChain, recordTradeOnChain, recordCloseOnChain, getOnChainRiskState } from '../chain/risk-policy-client.js';
// Validation & reputation scores posted by hackathon judge bot (no self-attestation)
import { executeKrakenTrade, closeKrakenPosition, getKrakenAccountSnapshot, krakenPreflight } from '../data/kraken-bridge.js';
import { getCliStatus } from '../data/kraken-cli.js';
import { startIndexer, getIndexerStatus, getIndexedEvents } from '../chain/event-indexer.js';
import { getOperatorControlState, getLatestOperatorAction } from './operator-control.js';
import { recordClosedTrade, getRecentTrades, getTradeStats, loadClosedTrades, type ClosedTrade } from './trade-log.js';

const log = createLogger('AGENT');

const MODE = process.env.MODE || 'simulation';
const DATA_SOURCE = process.env.DATA_SOURCE || 'live'; // 'live' | 'simulated'

// ──── Agent State ────
const INITIAL_CAPITAL = 10000;
const MAX_OPEN_POSITIONS = 2;

// Minimum time (ms) between opening new positions.
// 2 minutes — scalping mode needs fast re-entry.
const MIN_TRADE_INTERVAL_MS = 2 * 60 * 1000;
let lastTradeOpenedAt = 0;
// Minimum time (ms) after ANY position close before re-entering.
// Prevents immediate re-entry after a stop-loss hit in the same price zone.
const POST_CLOSE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes — avoid whipsaw re-entry
let lastTradeClosedAt = 0;

// Global loss streak cooldown: after N consecutive losses (any direction),
// pause trading for a longer period to avoid chop-market bleeding.
const LOSS_STREAK_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const LOSS_STREAK_THRESHOLD = 3;
let recentCloseTimestamps: { time: number; win: boolean }[] = [];
let lossStreakCooldownUntil = 0;
let lastValidationPostAt = 0;


let marketData: MarketData;
let riskEngine: RiskEngine;
let scheduler: Scheduler;
let agentId: number | null = config.agentId ?? null;
let cycleCount = 0;
let regimeGovernance = new RegimeGovernanceController();
let lastSentiment: SentimentResult | null = null;

// ──── Initialization ────

async function initAgent(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  ACTURA — Accountable Autonomous Trading Agent');
  console.log('  Sovereign AI Lab × ERC-8004');
  console.log('═══════════════════════════════════════════');
  console.log('');

  // Validate config
  const validation = validateConfig();
  if (!validation.valid) {
    log.fatal('Configuration invalid — cannot start');
    process.exit(1);
  }

  // Try to restore state
  const savedState = loadState();

  if (savedState && savedState.capital > 0) {
    log.info('Restoring from saved state', {
      capital: savedState.capital,
      positions: savedState.openPositions.length,
      lastCycle: savedState.lastCycle,
    });
    // Note: we previously reconciled capital with trade log sum to prevent drift,
    // but the trade log may be incomplete (e.g. after git pull overwrites or history
    // restoration). The saved state capital is the authoritative source of truth.
    // Do NOT override it with trade log sums.

    riskEngine = new RiskEngine(savedState.capital);
    cycleCount = savedState.lastCycle;

    // Restore positions (without re-applying slippage)
    for (const pos of savedState.openPositions) {
      riskEngine.restorePosition(pos);
    }

    // Generate initial market data BEFORE stop-loss reconciliation
    // so we can compare restored positions against current price
    marketData = await loadInitialMarketData();
    const startupPrice = marketData.prices[marketData.prices.length - 1];

    // ── Retroactive TP assignment ──
    // Legacy positions (opened before dynamic TP was implemented) lack a
    // takeProfitPrice.  Compute one now using current ATR so these positions
    // can actually reach take-profit instead of sitting until max-hold.
    const startupATR = computeATR(marketData.highs, marketData.lows, marketData.prices, 14);
    if (startupATR !== null && startupATR > 0) {
      const tpMult = regimeGovernance.getCurrentProfile().takeProfitAtrMultiple ?? 2.0;
      for (const pos of riskEngine.getOpenPositions()) {
        if (pos.takeProfitPrice == null) {
          const tpPrice = pos.side === 'LONG'
            ? pos.entryPrice + (tpMult * startupATR)
            : pos.entryPrice - (tpMult * startupATR);
          pos.takeProfitPrice = Math.round(tpPrice * 100) / 100;
          pos.atr = startupATR;
          log.info('Retroactive TP assigned to legacy position', {
            positionId: pos.id, side: pos.side, entry: pos.entryPrice,
            takeProfitPrice: pos.takeProfitPrice, atr: Math.round(startupATR * 100) / 100,
            tpMultiple: tpMult,
          });
        }
      }
    }

    // ── Reconnect diagnostics ──
    // Log structured before/after snapshot so we can debug offline drift.
    const preReconPositions = riskEngine.getOpenPositions();
    const preReconCapital = riskEngine.getCapital();
    const preReconCBState = riskEngine.getStatus().circuitBreaker;
    const savedPrice = savedState.openPositions.length > 0
      ? savedState.openPositions[0].entryPrice
      : startupPrice;
    log.info('Reconnect diagnostics — pre-reconciliation snapshot', {
      savedCapital: savedState.capital,
      currentCapital: preReconCapital,
      savedPositions: savedState.openPositions.length,
      livePositions: preReconPositions.length,
      lastSavedPrice: savedPrice,
      currentPrice: startupPrice,
      priceDeltaPct: savedPrice > 0
        ? ((startupPrice - savedPrice) / savedPrice * 100).toFixed(3) + '%'
        : 'N/A',
      circuitBreakerState: preReconCBState.state,
      drawdownPct: (preReconCBState.drawdownPct * 100).toFixed(2) + '%',
      lastSavedAt: savedState.lastSavedAt,
      offlineDurationMs: Date.now() - new Date(savedState.lastSavedAt).getTime(),
    });

    // Reconcile stale stop-losses: if price gapped through stop while
    // agent was offline, close at the stop-loss price (not the worse
    // current price). This prevents restart-induced excess losses.
    let reconPnlTotal = 0;
    let reconClosedCount = 0;
    const restoredPositions = riskEngine.getOpenPositions();
    for (const pos of restoredPositions) {
      if (pos.stopLoss === null) continue;
      const breached = (pos.side === 'LONG' && startupPrice <= pos.stopLoss) ||
                       (pos.side === 'SHORT' && startupPrice >= pos.stopLoss);
      if (breached) {
        // Close at stop-loss price, not the (potentially worse) current price
        const closePrice = pos.stopLoss;
        const pnl = riskEngine.closePositionById(pos.id, closePrice, /* skipSlippage */ true);
        reconPnlTotal += pnl;
        reconClosedCount++;
        const pnlPct = pos.entryPrice > 0 ? (pnl / (pos.entryPrice * pos.size)) * 100 : 0;
        recordClosedTrade({
          id: pos.id, asset: pos.asset, side: pos.side, size: pos.size,
          entryPrice: pos.entryPrice, exitPrice: closePrice, pnl, pnlPct,
          stopHit: true, reason: 'reconciliation',
          openedAt: pos.openedAt, closedAt: new Date().toISOString(),
          durationMs: Date.now() - new Date(pos.openedAt).getTime(),
          ipfsCid: pos.ipfsCid, txHash: pos.txHash,
        });
        log.warn('Restart reconciliation: stop-loss was breached while offline', {
          positionId: pos.id, side: pos.side, entry: pos.entryPrice,
          stopLoss: pos.stopLoss, currentPrice: startupPrice,
          closedAt: closePrice, pnl: Math.round(pnl * 100) / 100,
        });
        // Decrement on-chain position counter and release exposure
        recordCloseOnChain(pnl, pos.size * pos.entryPrice).catch(e =>
          log.warn('recordCloseOnChain failed during reconciliation', { error: String(e) }),
        );
      }
    }

    // Post-reconciliation diagnostics
    const postReconCapital = riskEngine.getCapital();
    log.info('Reconnect diagnostics — post-reconciliation snapshot', {
      positionsClosed: reconClosedCount,
      totalReconPnl: Math.round(reconPnlTotal * 100) / 100,
      capitalBefore: preReconCapital,
      capitalAfter: postReconCapital,
      capitalDelta: Math.round((postReconCapital - preReconCapital) * 100) / 100,
      remainingPositions: riskEngine.getOpenPositions().length,
    });

    // Reset circuit breaker daily state AFTER reconciliation so offline
    // stop-loss losses don't immediately trip the daily loss limit and
    // lock out trading on the new session.
    riskEngine.resetDaily();
    log.info('Post-reconciliation: circuit breaker daily state reset to allow recovery');

    // Persist state immediately after reconciliation so totalTrades and
    // capital reflect closed positions right away (not 10 cycles later).
    if (reconClosedCount > 0) {
      persistState();
    }
  } else {
    riskEngine = new RiskEngine(INITIAL_CAPITAL);
    cycleCount = 0;

    // Generate initial market data for fresh start
    marketData = await loadInitialMarketData();
  }

  resetStrategy();
  regimeGovernance.reset();

  // Load SAGE (Self-Adapting Generative Engine) state — weights, playbook, reflections
  loadSAGEState();

  // Seed trust score rolling outcome tracker from historical trades
  const historicalTrades = loadClosedTrades();
  if (historicalTrades.length > 0) {
    seedOutcomeHistory(agentId, historicalTrades.map(t => ({ pnlPct: t.pnlPct })));
    log.info(`Seeded trust outcome history from ${historicalTrades.length} historical trades`);
  }

  log.info('Agent initialized', {
    capital: riskEngine.getCapital(),
    pair: config.tradingPair,
    strategy: `SMA${config.strategy.smaFast}/${config.strategy.smaSlow}`,
    maxDailyLoss: `${config.maxDailyLossPct * 100}%`,
    maxDrawdown: `${config.maxDrawdownPct * 100}%`,
    maxPositions: MAX_OPEN_POSITIONS,
    agentId: agentId ?? 'not registered',
    mode: MODE,
    dataSource: DATA_SOURCE,
    latestPrice: `$${marketData.prices[marketData.prices.length - 1].toFixed(2)}`,
  });

  // Start on-chain event indexer (non-blocking, polls every 30s)
  if (config.privateKey && agentId) {
    try {
      const { initChain } = await import('../chain/sdk.js');
      initChain();
      startIndexer(agentId);

      // Reconcile on-chain position count with local state.
      // If the on-chain contract thinks more positions are open than local
      // state tracks (e.g., after a bug or crash), call recordClose(0) to
      // decrement the on-chain counter for each phantom position.
      try {
        const onChainState = await getOnChainRiskState();
        if (onChainState) {
          const localOpen = riskEngine.getOpenPositions().length;
          const chainOpen = onChainState.positions;
          if (chainOpen > localOpen) {
            const phantomCount = chainOpen - localOpen;
            log.warn(`On-chain position count (${chainOpen}) > local (${localOpen}) — reconciling ${phantomCount} phantom position(s)`);
            for (let i = 0; i < phantomCount; i++) {
              await recordCloseOnChain(0, 0); // zero PnL — just decrement counter
            }
            log.info('On-chain position count reconciled');
          }
        }
      } catch (syncErr) {
        log.warn('On-chain position sync failed (non-critical)', { error: String(syncErr) });
      }
    } catch (e) {
      log.warn('Event indexer failed to start — chain not configured', { error: String(e) });
    }
  }
}

// ──── Trading Cycle ────

/**
 * Load initial market data — tries live OHLC history first, falls back to simulation.
 */
async function loadInitialMarketData(): Promise<MarketData> {
  // Try to restore persisted price history first — avoids SMA50 cold-start.
  const cached = loadPriceHistory();

  if (DATA_SOURCE === 'live') {
    log.info('Fetching live OHLC history (Kraken primary)...');
    const liveData = await fetchOHLCHistory();
    if (liveData) {
      // Merge: prepend any cached candles that predate the OHLC response
      // so we have more data points for SMA50.
      if (cached && cached.prices.length > 0) {
        const oldestLiveTs = liveData.timestamps[0];
        const olderPrices: number[] = [];
        const olderHighs: number[] = [];
        const olderLows: number[] = [];
        const olderTimestamps: string[] = [];
        for (let i = 0; i < cached.timestamps.length; i++) {
          if (cached.timestamps[i] < oldestLiveTs) {
            olderPrices.push(cached.prices[i]);
            olderHighs.push(cached.highs[i]);
            olderLows.push(cached.lows[i]);
            olderTimestamps.push(cached.timestamps[i]);
          }
        }
        if (olderPrices.length > 0) {
          liveData.prices = [...olderPrices, ...liveData.prices];
          liveData.highs = [...olderHighs, ...liveData.highs];
          liveData.lows = [...olderLows, ...liveData.lows];
          liveData.timestamps = [...olderTimestamps, ...liveData.timestamps];
          log.info(`Merged ${olderPrices.length} cached candles with ${liveData.prices.length - olderPrices.length} live candles → ${liveData.prices.length} total`);
        }
      }
      log.info(`Loaded ${liveData.prices.length} live candles — latest $${liveData.prices[liveData.prices.length - 1].toFixed(2)}`);
      return liveData;
    }

    // All live sources failed — try cached price history.
    if (cached && cached.prices.length >= 20) {
      log.warn(`Live OHLC fetch failed — using ${cached.prices.length} cached candles from disk`);
      return cached;
    }

    log.warn('Live OHLC fetch failed — falling back to simulated seed data around current price');
    // Try to at least get the current price for a better seed
    const livePrice = await fetchLivePrice();
    const seedPrice = livePrice?.price ?? 3000;
    log.info(`Seeding simulation at $${seedPrice.toFixed(2)} (${livePrice ? livePrice.source : 'default'})`);
    return generateSimulatedData(60, seedPrice, 0.02, 0.0003);
  }
  return generateSimulatedData(60, 3000, 0.02, 0.0003);
}

async function runCycle(): Promise<void> {
  cycleCount++;
  const cycleStart = Date.now();
  const operatorControl = getOperatorControlState();
  let takeProfitPrice: number | null = null;  // Dynamic TP — calculated at trade time

  // Step 0: Check if live feed is too stale to trade safely
  const feedStatus = getLiveFeedStatus();
  const feedStale = DATA_SOURCE === 'live' && feedStatus.shouldHaltTrading;
  if (feedStale) {
    // Feed is stale — skip trading but STILL check stop-losses.
    // Returning early here was a bug: open positions with stop-losses
    // were never checked during outages, so when the feed recovered
    // prices had gapped through stops and positions closed at much
    // worse prices.
    const stalePrice = marketData.prices[marketData.prices.length - 1];
    const staleClosed = riskEngine.updateStops(stalePrice);
    if (staleClosed.length > 0) {
      log.warn(`Feed stale but ${staleClosed.length} stop-losses triggered at last known price $${stalePrice.toFixed(2)}`);
      persistState();
    }
    log.warn(`Live feed stale (${feedStatus.consecutiveFailures} failures) — skipping trading but stop-losses checked`);
    return;
  }

  // Step 1: Update market data (live or simulated)
  const lastPrice = marketData.prices[marketData.prices.length - 1];
  let livePriceAvailable = true;  // Track whether this cycle has a real price

  if (DATA_SOURCE === 'live') {
    const liveFetch = await fetchLivePrice();
    if (liveFetch) {
      const candle = buildLiveCandle(liveFetch.price, lastPrice);
      marketData = appendCandle(marketData, candle);
      if (cycleCount % 10 === 1) {
        log.info(`Live price: $${liveFetch.price.toFixed(2)} [${liveFetch.source}]`);
      }
    } else {
      // Live fetch failed — use last known price with tiny noise to avoid stale data.
      // Mark this cycle as noise-injected so we skip stop-loss checks: false
      // noise should never trigger a real stop.
      livePriceAvailable = false;
      const noise = lastPrice * 0.0005 * (Math.random() * 2 - 1);
      const fallbackPrice = lastPrice + noise;
      marketData = appendCandle(marketData, buildLiveCandle(fallbackPrice, lastPrice));
      log.warn('Live feed unavailable — using last known price with noise (stops skipped)');
    }
  } else {
    // Original simulation path
    const vol = 0.02;
    const shock = vol * (Math.random() * 2 - 1);
    const newPrice = lastPrice * (1 + 0.0002 + shock);
    const range = newPrice * vol * 0.3;
    marketData = appendCandle(marketData, {
      timestamp: new Date().toISOString(),
      open: lastPrice,
      high: newPrice + Math.abs(Math.random() * range),
      low: newPrice - Math.abs(Math.random() * range),
      close: Math.round(newPrice * 100) / 100,
      volume: Math.round(Math.random() * 1000),
    });
  }

  // Trim data window
  if (marketData.prices.length > 200) {
    marketData.prices = marketData.prices.slice(-200);
    marketData.highs = marketData.highs.slice(-200);
    marketData.lows = marketData.lows.slice(-200);
    marketData.timestamps = marketData.timestamps.slice(-200);
  }

  // Step 2: Run strategy (with sentiment + PRISM)
  const capital = riskEngine.getCapital();
  let sentiment: SentimentResult | null = null;
  let prism: PrismData = { signal: null, risk: null, sources: [] };
  try {
    const [sentimentResult, prismResult] = await Promise.all([
      fetchSentiment().catch((err: any) => {
        log.warn('Sentiment fetch failed — proceeding without', { error: err.message?.slice(0, 80) });
        return null;
      }),
      fetchPrismData('ETH').catch((err: any) => {
        log.warn('PRISM fetch failed — proceeding without', { error: err.message?.slice(0, 80) });
        return { signal: null, risk: null, sources: [] } as PrismData;
      }),
    ]);
    sentiment = sentimentResult;
    if (sentiment) lastSentiment = sentiment;
    prism = prismResult;

    // Resolve asset metadata via PRISM /resolve/{asset} (non-blocking, cached 30min)
    fetchPrismResolve('ETH').catch(() => { /* non-critical */ });
  } catch (err: any) {
    log.warn('Data feed fetch failed', { error: err.message?.slice(0, 80) });
  }
  const strategyOutput = runStrategy(marketData, capital, sentiment?.composite ?? null);

  // Step 2+: PRISM confidence modifier — boost/dampen based on external AI signals
  const prismModifier = prismConfidenceModifier(prism.signal, strategyOutput.signal.direction);
  if (prismModifier !== 0) {
    const prePrismConf = strategyOutput.signal.confidence;
    strategyOutput.signal.confidence = Math.max(0, Math.min(1, strategyOutput.signal.confidence + prismModifier));
    log.info('PRISM confidence adjustment', {
      direction: strategyOutput.signal.direction,
      prismDirection: prism.signal?.direction,
      prismStrength: prism.signal?.strength,
      modifier: prismModifier.toFixed(3),
      confBefore: prePrismConf.toFixed(3),
      confAfter: strategyOutput.signal.confidence.toFixed(3),
    });
  }

  // Step 2a: Oracle integrity guard — block suspicious or stale market states
  const oracleIntegrity = evaluateOracleIntegrity({
    prices: marketData.prices,
    highs: marketData.highs,
    lows: marketData.lows,
    timestamps: marketData.timestamps,
  });

  if (!oracleIntegrity.passed) {
    strategyOutput.signal.direction = 'NEUTRAL';
    strategyOutput.signal.confidence = 0;
    strategyOutput.signal.reason = `[ORACLE BLOCK] ${oracleIntegrity.blockers.join('; ')} | ${strategyOutput.signal.reason}`;
    strategyOutput.positionSizeRaw = 0;
    strategyOutput.positionSize = 0;
    strategyOutput.stopLossPrice = null;
    (strategyOutput.signal as any).oracleIntegrityStatus = 'blocked';
  } else {
    (strategyOutput.signal as any).oracleIntegrityStatus = oracleIntegrity.status;
  }

  // Step 2b: Neuro-symbolic reasoning — apply symbolic rules to the raw signal
  const positions = riskEngine.getOpenPositions();
  const cbState = riskEngine.getStatus().circuitBreaker;
  const cognitive = applySymbolicReasoning(
    strategyOutput,
    positions.map(p => ({ side: p.side, entryPrice: p.entryPrice })),
    capital,
    cbState.drawdownPct,
    cbState.dailyPnlPct,
  );

  // Apply symbolic adjustments to strategy output
  if (cognitive.override || cognitive.rulesFired > 0) {
    strategyOutput.signal.direction = cognitive.adjustedSignal as 'LONG' | 'SHORT' | 'NEUTRAL';
    strategyOutput.signal.confidence = cognitive.adjustedConfidence;
    if (cognitive.override) {
      strategyOutput.signal.reason = `[SYMBOLIC OVERRIDE] ${cognitive.overrideReason}`;
    }
  }

  // Step 2c: Regime-governance — deterministic profile selection + bounded confidence bias
  const volatility = strategyOutput.indicators.volatility ?? 0.02;
  const volRegime = mapVolToRegime(volatility);
  const regimeGov = strategyOutput.signal.direction !== 'NEUTRAL'
    ? regimeGovernance.step({
        cycleNumber: cycleCount,
        volatility,
        drawdownPct: cbState.drawdownPct,
        direction: strategyOutput.signal.direction as 'LONG' | 'SHORT',
        confidence: strategyOutput.signal.confidence,
        regime: volRegime,
      })
    : null;

  if (regimeGov) {
    strategyOutput.signal.confidence = regimeGov.adjustedConfidence;
    (strategyOutput.signal as any).regimeGovernance = {
      profileName: regimeGov.profileName,
      bayesBias: regimeGov.bayesBias,
      baseProfileChoice: regimeGov.baseProfileChoice,
      switched: regimeGov.switched,
      artifacts: regimeGov.artifacts,
    };

    const sizeRatio = regimeGov.profile.basePositionPct / config.strategy.basePositionPct;
    strategyOutput.positionSizeRaw *= sizeRatio;
    strategyOutput.positionSize *= sizeRatio;

    const atrValue = strategyOutput.indicators.atr;
    if (atrValue !== null) {
      if (strategyOutput.signal.direction === 'LONG') {
        strategyOutput.stopLossPrice = strategyOutput.currentPrice - (regimeGov.profile.stopLossAtrMultiple * atrValue);
      } else if (strategyOutput.signal.direction === 'SHORT') {
        strategyOutput.stopLossPrice = strategyOutput.currentPrice + (regimeGov.profile.stopLossAtrMultiple * atrValue);
      }
    }

    if (strategyOutput.signal.confidence < regimeGov.profile.confidenceThreshold) {
      strategyOutput.signal.reason = `[REGIME GOVERNANCE BLOCK] confidence ${strategyOutput.signal.confidence.toFixed(2)} below profile threshold ${regimeGov.profile.confidenceThreshold.toFixed(2)} | ${strategyOutput.signal.reason}`;
      strategyOutput.signal.direction = 'NEUTRAL';
      strategyOutput.signal.confidence = 0;
      strategyOutput.positionSizeRaw = 0;
      strategyOutput.positionSize = 0;
      strategyOutput.stopLossPrice = null;
    } else if (regimeGov.switched) {
      strategyOutput.signal.reason = `[PROFILE SWITCH → ${regimeGov.profileName}] ${strategyOutput.signal.reason}`;
    }
  }

  // Step 2d: Supervisory meta-agent — trust-aware capital steward
  const lastTrustScore = getLastTrustScore(agentId);
  const structureRegime = (strategyOutput.signal.structureRegime ?? 'UNKNOWN') as 'TRENDING' | 'RANGING' | 'STRESSED' | 'UNCERTAIN' | 'UNKNOWN';
  const edgeAllowed = strategyOutput.signal.edge?.allowed ?? true;
  const supervisory = evaluateSupervisoryDecision({
    trustScore: lastTrustScore,
    drawdownPct: cbState.drawdownPct,
    structureRegime,
    edgeAllowed,
    volatilityRegime: strategyOutput.indicators.volatility
      ? (strategyOutput.indicators.volatility > 0.04 ? 'extreme'
        : strategyOutput.indicators.volatility > 0.03 ? 'high'
        : strategyOutput.indicators.volatility < 0.01 ? 'low'
        : 'normal')
      : 'normal',
    currentOpenPositions: positions.length,
    maxOpenPositions: MAX_OPEN_POSITIONS,
  });

  if (!supervisory.canTrade) {
    strategyOutput.signal.direction = 'NEUTRAL';
    strategyOutput.signal.confidence = 0;
    strategyOutput.signal.reason = `[SUPERVISORY BLOCK] ${summarizeSupervisoryDecision(supervisory)} | ${strategyOutput.signal.reason}`;
    strategyOutput.positionSizeRaw = 0;
    strategyOutput.positionSize = 0;
    strategyOutput.stopLossPrice = null;
  } else {
    const preSupervisorySize = strategyOutput.positionSizeRaw;
    const resizedRaw = applySupervisorySizing(
      preSupervisorySize,
      capital,
      strategyOutput.currentPrice,
      supervisory,
    );
    strategyOutput.positionSizeRaw = resizedRaw;
    strategyOutput.positionSize = resizedRaw;
    if (resizedRaw === 0) {
      strategyOutput.signal.direction = 'NEUTRAL';
      strategyOutput.signal.confidence = 0;
      strategyOutput.signal.reason = `[SUPERVISORY THROTTLE->ZERO] ${summarizeSupervisoryDecision(supervisory)} | ${strategyOutput.signal.reason}`;
      strategyOutput.stopLossPrice = null;
    } else if (resizedRaw < preSupervisorySize) {
      strategyOutput.signal.reason = `[SUPERVISORY THROTTLE] ${summarizeSupervisoryDecision(supervisory)} | ${strategyOutput.signal.reason}`;
    }
  }

  // Step 2d: Agent mandate enforcement — asset/protocol/capital permissions
  const mandate = getDefaultMandate(Math.max(capital, 10000));
  const mandateDecision = evaluateMandate({
    mandate,
    strategyOutput,
    capitalUsd: capital,
    protocol: config.allowedProtocols[0] ?? 'uniswap',
    asset: config.tradingPair,
    dailyPnlPct: cbState.dailyPnlPct,
  });
  (strategyOutput.signal as any).mandateApproved = mandateDecision.approved && !mandateDecision.requiresHumanApproval;

  if (!mandateDecision.approved || mandateDecision.requiresHumanApproval) {
    strategyOutput.signal.direction = 'NEUTRAL';
    strategyOutput.signal.confidence = 0;
    const prefix = mandateDecision.requiresHumanApproval ? '[MANDATE HUMAN APPROVAL]' : '[MANDATE BLOCK]';
    strategyOutput.signal.reason = `${prefix} ${mandateDecision.reasons.join('; ') || 'mandate restriction'} | ${strategyOutput.signal.reason}`;
    strategyOutput.positionSizeRaw = 0;
    strategyOutput.positionSize = 0;
    strategyOutput.stopLossPrice = null;
  }

  // Step 3: Risk engine evaluation
  const riskDecision = riskEngine.evaluate(strategyOutput);
  riskDecision.checks.push(...buildMandateRiskChecks(mandateDecision));

  // Step 4: Position limit check (additional production guard)
  const openCount = riskEngine.getOpenPositions().length;
  const positionLimitHit = openCount >= MAX_OPEN_POSITIONS;

  if (riskDecision.approved && positionLimitHit) {
    log.warn(`Position limit reached (${openCount}/${MAX_OPEN_POSITIONS}) — trade skipped`);
  }

  // Cooldown guard: prevent rapid-fire position stacking at the same price level
  const timeSinceLastTrade = Date.now() - lastTradeOpenedAt;
  const cooldownHit = timeSinceLastTrade < MIN_TRADE_INTERVAL_MS && openCount > 0;
  if (riskDecision.approved && cooldownHit) {
    log.warn(`Trade cooldown active (${Math.round(timeSinceLastTrade / 1000)}s < ${MIN_TRADE_INTERVAL_MS / 1000}s) — trade skipped`);
  }

  // Post-close cooldown: after any position closes (stop-loss, max-hold, etc.),
  // wait before re-entering to avoid whipsaw re-entries in the same price zone.
  const timeSinceLastClose = Date.now() - lastTradeClosedAt;
  const postCloseCooldownHit = lastTradeClosedAt > 0 && timeSinceLastClose < POST_CLOSE_COOLDOWN_MS;
  if (riskDecision.approved && postCloseCooldownHit) {
    log.warn(`Post-close cooldown active (${Math.round(timeSinceLastClose / 1000)}s < ${POST_CLOSE_COOLDOWN_MS / 1000}s) — trade skipped`);
  }

  // Global loss streak cooldown: if we've hit N consecutive losses recently,
  // pause trading entirely to avoid bleeding in choppy markets.
  const lossStreakCooldownHit = Date.now() < lossStreakCooldownUntil;
  if (riskDecision.approved && lossStreakCooldownHit) {
    const remaining = Math.round((lossStreakCooldownUntil - Date.now()) / 1000);
    log.warn(`Loss streak cooldown active (${remaining}s remaining) — trade skipped`);
  }

  // Minimum ATR gate: skip trading when ATR is too low (market is dead/ranging).
  // In such conditions, stops are micro and every trade becomes a coin flip.
  const atrPct = strategyOutput.indicators.atr !== null && strategyOutput.currentPrice > 0
    ? strategyOutput.indicators.atr / strategyOutput.currentPrice
    : null;
  const atrMinPct = 0.0010; // 0.15% — allow low-vol mean-reversion trades (simulator at volMult=600 is the real safety net)
  const atrTooLow = atrPct !== null && atrPct < atrMinPct;
  if (riskDecision.approved && atrTooLow) {
    log.warn(`ATR too low (${(atrPct! * 100).toFixed(3)}% < ${(atrMinPct * 100).toFixed(2)}%) — market too flat, trade skipped`);
  }

  let shouldExecute = riskDecision.approved && !positionLimitHit && !cooldownHit && !postCloseCooldownHit && !lossStreakCooldownHit && !atrTooLow;

  // Step 4a: DEX routing — governed best-execution venue selection
  const routingInput = {
    asset: config.tradingPair,
    side: strategyOutput.signal.direction as 'LONG' | 'SHORT',
    notionalUsd: riskDecision.finalPositionSize * strategyOutput.currentPrice,
    volatility: strategyOutput.indicators.volatility ?? 0.02,
    isTestnet: config.chainId === 11155111 || config.chainId === 84532,
    enabledDexes: config.allowedProtocols.filter(
      (p): p is DexId => p === 'aerodrome' || p === 'uniswap'
    ),
  };
  const dexRouting: RoutingDecision = shouldExecute
    ? await routeTrade(routingInput)
    : { selectedDex: 'uniswap' as DexId, quotes: [], savingsBps: 0, rationale: ['no trade'], timestamp: new Date().toISOString(), routingVersion: '1.0' };

  // Step 4b: Execution simulation — required pre-trade safety stage (uses DEX-specific fees)
  // On testnet (Sepolia or Base Sepolia), use minimal fee assumptions — no real DEX fees or gas costs.
  const isTestnet = config.chainId === 11155111 || config.chainId === 84532;
  const executionSimulation = simulateExecution({
    strategyOutput,
    riskDecision,
    // Testnet gas is free (Sepolia faucet ETH) — don't let fictional gas
    // eat into net edge and block trades that would be profitable.
    // Only charge gas on mainnet with real on-chain execution.
    gasUsd: isTestnet ? 0 : (config.riskRouterAddress ? 0.35 : 0),
    dexId: dexRouting.selectedDex,
    dexFeeBps: isTestnet ? 5 : getDexFeeBps(dexRouting.selectedDex),
  });
  if (shouldExecute && !executionSimulation.allowed) {
    shouldExecute = false;
    strategyOutput.signal.reason = `[SIMULATION BLOCK] ${executionSimulation.reason} | ${strategyOutput.signal.reason}`;
    log.warn('Execution simulation blocked trade', executionSimulation);
  }

  // Step 4c: On-chain risk policy check (ActuraRiskPolicy contract)
  let onChainRiskCheck: Awaited<ReturnType<typeof checkTradeOnChain>> | null = null;
  if (shouldExecute) {
    onChainRiskCheck = await checkTradeOnChain(
      strategyOutput.signal.direction as 'LONG' | 'SHORT',
      riskDecision.finalPositionSize * strategyOutput.currentPrice,
    );
    if (onChainRiskCheck.available && !onChainRiskCheck.approved) {
      shouldExecute = false;
      strategyOutput.signal.reason = `[ON-CHAIN RISK BLOCK] ${onChainRiskCheck.reason} | ${strategyOutput.signal.reason}`;
      log.warn('On-chain risk policy blocked trade', { reason: onChainRiskCheck.reason });
    }
  }

  // ── Gate Trace: single structured log showing signal at each gate ──
  const gateTrace = {
    cycle: cycleCount,
    signal: strategyOutput.signal.direction,
    gates: {
      strategy:   { dir: strategyOutput.signal.direction, conf: +(strategyOutput.signal.confidence).toFixed(3) },
      prism:      prism.signal ? { dir: prism.signal.direction, str: prism.signal.strength, mod: +prismModifier.toFixed(3), rsi: prism.signal.rsi?.toFixed(1) ?? null } : null,
      oracle:     { pass: oracleIntegrity.passed },
      neuro:      { dir: cognitive.adjustedSignal, conf: +cognitive.adjustedConfidence.toFixed(3), rules: cognitive.rulesFired },
      regime:     regimeGov ? { profile: regimeGov.profileName, conf: +regimeGov.adjustedConfidence.toFixed(3), threshold: regimeGov.profile.confidenceThreshold } : null,
      supervisory:{ canTrade: supervisory.canTrade, tier: supervisory.trustTier },
      mandate:    { approved: mandateDecision.approved },
      risk:       { approved: riskDecision.approved, failed: riskDecision.checks.filter(c => !c.passed).map(c => c.name) },
      simulator:  { allowed: executionSimulation.allowed, reason: executionSimulation.reason },
      onChain:    onChainRiskCheck ? { approved: onChainRiskCheck.approved, reason: onChainRiskCheck.reason } : 'skipped',
    },
    execute: shouldExecute,
  };
  log.info('Gate trace', gateTrace);

  // Step 5: Build validation artifact (ALWAYS — even for rejected trades)
  let artifact = buildTradeArtifact(strategyOutput, riskDecision, agentId);
  artifact = await attachGovernanceEvidence(artifact, {
    mandateDecision,
    oracleIntegrity,
    executionSimulation,
    dexRouting,
    operatorControl: {
      ...operatorControl,
      latestAction: getLatestOperatorAction(),
    },
  });

  // Add cognitive + supervisory layer data to artifact
  (artifact as any).supervisory = supervisory;
  if (onChainRiskCheck?.available) {
    (artifact as any).onChainRiskPolicy = {
      contract: onChainRiskCheck.contractAddress,
      approved: onChainRiskCheck.approved,
      reason: onChainRiskCheck.reason,
    };
  }
  if ((strategyOutput.signal as any).regimeGovernance) {
    (artifact as any).regimeGovernance = (strategyOutput.signal as any).regimeGovernance;
  }

  if (cognitive.rulesFired > 0) {
    (artifact as any).cognitive = {
      rulesEvaluated: cognitive.rulesEvaluated,
      rulesFired: cognitive.rulesFired,
      override: cognitive.override,
      overrideReason: cognitive.overrideReason,
      adjustments: cognitive.ruleResults.filter(r => r.fired).map(r => ({
        rule: r.ruleName,
        action: r.action,
        reason: r.reason,
        confidenceAdjust: r.confidenceAdjustment,
      })),
      originalSignal: cognitive.originalSignal,
      originalConfidence: cognitive.originalConfidence,
    };
  }

  // Add PRISM data to artifact
  if (prism.signal || prism.risk) {
    (artifact as any).prism = {
      signal: prism.signal ? {
        direction: prism.signal.direction,
        strength: prism.signal.strength,
        netScore: prism.signal.netScore,
        rsi: prism.signal.rsi,
        macd: prism.signal.macd,
        macdHistogram: prism.signal.macdHistogram,
      } : null,
      risk: prism.risk ? {
        dailyVolatility: prism.risk.dailyVolatility,
        sharpeRatio: prism.risk.sharpeRatio,
        maxDrawdown: prism.risk.maxDrawdown,
        currentDrawdown: prism.risk.currentDrawdown,
      } : null,
      confidenceModifier: prismModifier,
    };
  }

  // Add sentiment data to artifact
  if (sentiment && sentiment.sources.length > 0) {
    (artifact as any).sentiment = {
      composite: sentiment.composite,
      fearGreed: sentiment.fearGreed,
      newsSentiment: sentiment.newsSentiment,
      fundingRate: sentiment.fundingRate,
      socialSentiment: (sentiment as any).socialSentiment ?? null,
      sources: sentiment.sources,
    };
  }

  // Step 5b: Enrich with AI reasoning + market snapshot + confidence intervals
  const aiReasoning = await generateReasoning(
    strategyOutput, riskDecision, marketData.prices, capital, openCount, sentiment
  );
  artifact = enrichArtifact(artifact, aiReasoning, marketData.prices);

  // Step 6: Upload to IPFS with retry
  let ipfsResult = null;
  if (shouldExecute) {
    try {
      ipfsResult = await retry(
        () => uploadArtifact(artifact),
        { maxRetries: 2, baseDelayMs: 500, label: 'IPFS upload' }
      );
    } catch (e) {
      log.error('IPFS upload failed after retries — proceeding without artifact link');
    }
  }

  // Step 7: Record checkpoint
  const checkpoint = saveCheckpoint(strategyOutput, riskDecision, artifact, ipfsResult);

  // Step 8: Execute trade
  let mainExecutorRanValidation = false;
  if (shouldExecute) {
    if (MODE === 'live' && agentId && config.riskRouterAddress) {
      // REAL EXECUTION: Sign intent → Risk Router → Validation → Reputation
      // Only runs when Risk Router is configured (hackathon publishes the address)
      const execResult = await executeTrade(strategyOutput, riskDecision, artifact, agentId);
      if (execResult.success) {
        checkpoint.onChainTxHash = execResult.intentTxHash;
        mainExecutorRanValidation = true;
        ipfsResult = ipfsResult || { cid: execResult.artifactIpfsCid!, uri: execResult.artifactIpfsUri!, gatewayUrl: '' };
      } else {
        log.warn('On-chain execution failed — recording locally only', { error: execResult.error });
      }
    }

    // Step 8b: Kraken CLI execution (combined track — runs alongside ERC-8004)
    // Paper trading doesn't need API keys — just the CLI binary with local simulation
    const krakenPaperEnabled = process.env.KRAKEN_PAPER_TRADING !== 'false';
    const krakenLiveEnabled = !!(process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET);
    const krakenEnabled = krakenLiveEnabled || krakenPaperEnabled;
    if (krakenEnabled && (MODE === 'live' || MODE === 'kraken' || krakenPaperEnabled)) {
      const krakenResult = await executeKrakenTrade(
        strategyOutput, riskDecision, artifact, agentId,
        { skipOnChainValidation: mainExecutorRanValidation },
      );
      if (krakenResult.success) {
        (checkpoint as any).krakenOrderId = krakenResult.orderId;
        (checkpoint as any).krakenPaperTrade = krakenResult.paperTrade;
        if (!ipfsResult && krakenResult.artifactIpfsCid) {
          ipfsResult = { cid: krakenResult.artifactIpfsCid, uri: krakenResult.artifactIpfsUri!, gatewayUrl: '', size: 0 };
          checkpoint.ipfs = ipfsResult;
        }
        if (!checkpoint.onChainTxHash && krakenResult.validationTxHash) {
          checkpoint.onChainTxHash = krakenResult.validationTxHash;
        }
        log.info('Kraken order executed', {
          orderId: krakenResult.orderId,
          paper: krakenResult.paperTrade,
          side: krakenResult.side,
          volume: krakenResult.volume,
        });
      } else {
        log.warn('Kraken execution failed — position tracked locally only', { error: krakenResult.error });
      }
    }

    // Step 8c: Record trade on-chain in ActuraRiskPolicy
    if (shouldExecute) {
      recordTradeOnChain(
        strategyOutput.signal.direction as 'LONG' | 'SHORT',
        riskDecision.finalPositionSize * strategyOutput.currentPrice,
      ).catch(e => log.warn('recordTradeOnChain failed (non-critical)', { error: String(e) }));
    }


    // Always record position locally (for our risk engine tracking)
    // First, close any opposing positions (deferred from risk evaluation).
    // This is done here — AFTER all gates pass — so we don't lose positions
    // when downstream checks (on-chain risk policy, simulator) block the trade.
    if (strategyOutput.signal.direction === 'LONG' || strategyOutput.signal.direction === 'SHORT') {
      const flipped = riskEngine.closeOpposingPositions(
        strategyOutput.signal.direction as 'LONG' | 'SHORT',
        strategyOutput.currentPrice,
      );
      // Record each flip on-chain so openPositionCount stays in sync
      for (const f of flipped) {
        lastTradeClosedAt = Date.now(); // trigger post-close cooldown for flips too
        recordCloseOnChain(f.pnl, f.size * f.entry)
          .catch(e => log.warn('recordCloseOnChain (flip) failed', { error: String(e) }));
        const now = new Date().toISOString();
        const pnlPct = f.entry > 0 ? (f.pnl / (f.entry * f.size)) * 100 : 0;
        const openTime = new Date(f.openedAt).getTime();
        const closeTime = Date.now();
        recordClosedTrade({
          id: f.id,
          asset: config.tradingPair,
          side: f.side as 'LONG' | 'SHORT',
          size: f.size,
          entryPrice: f.entry,
          exitPrice: f.exit,
          pnl: f.pnl,
          pnlPct,
          stopHit: false,
          reason: 'direction_flip',
          openedAt: f.openedAt,
          closedAt: now,
          durationMs: closeTime - openTime,
          ipfsCid: f.ipfsCid,
          txHash: f.txHash,
        });
      }
    }

    // Calculate dynamic take-profit price based on ATR and regime profile.
    const atrValue = strategyOutput.indicators.atr;
    const tpAtrMult = regimeGov?.profile.takeProfitAtrMultiple ?? 2.0;
    if (atrValue !== null && atrValue > 0) {
      if (strategyOutput.signal.direction === 'LONG') {
        takeProfitPrice = strategyOutput.currentPrice + (tpAtrMult * atrValue);
      } else if (strategyOutput.signal.direction === 'SHORT') {
        takeProfitPrice = strategyOutput.currentPrice - (tpAtrMult * atrValue);
      }
    }

    riskEngine.openPosition({
      asset: config.tradingPair,
      side: strategyOutput.signal.direction as 'LONG' | 'SHORT',
      size: riskDecision.finalPositionSize,
      entryPrice: strategyOutput.currentPrice,
      stopLoss: riskDecision.stopLossPrice,
      openedAt: new Date().toISOString(),
      ipfsCid: ipfsResult?.cid ?? null,
      txHash: checkpoint.onChainTxHash ?? null,
      atr: atrValue,
      takeProfitPrice,
    });
    lastTradeOpenedAt = Date.now();

    // Persist immediately after opening a position so it survives crashes
    persistState();
  }

  // Step 8d: Post validation attestation to ValidationRegistry (rate-limited to 1 per 5 min)
  const VAL_POST_INTERVAL_MS = 60 * 1000;
  if (agentId && (Date.now() - lastValidationPostAt) >= VAL_POST_INTERVAL_MS) {
    lastValidationPostAt = Date.now();
    const valHash = "0x" + (await import("node:crypto")).createHash("sha256").update(checkpoint.timestamp + "-" + (checkpoint.direction || "NEUTRAL")).digest("hex");
    postCheckpoint(agentId, valHash, 100, 'Cycle ' + cycleCount + ' ' + (checkpoint.direction || 'NEUTRAL'))
      .catch(function(e) { log.warn('Validation posting failed (non-critical)', { error: String(e).slice(0, 120) }); });
  }

  // Step 9: Update trailing stops and check stop-losses
  // Skip price-based stop-loss/TP checks when price is noise-injected from a feed failure
  // — synthetic noise should never trigger real position closures.
  // BUT always run max-hold duration checks regardless of price availability,
  // so positions never get stuck forever when the price feed is down.
  const currentPrice = strategyOutput.currentPrice;
  let closedPositions: ReturnType<typeof riskEngine.updateStops>;
  if (livePriceAvailable) {
    closedPositions = riskEngine.updateStops(currentPrice);
  } else {
    // Price feed down — only check max-hold expiry (uses last known price)
    closedPositions = riskEngine.updateStops(currentPrice, { maxHoldOnly: true });
  }

  // Persist immediately after stop-loss closes so state survives crashes.
  // Without this, a crash between stop-close and the next persist (up to
  // 10 cycles later) replays the close on restart with a potentially
  // different price.
  if (closedPositions.length > 0) {
    lastTradeClosedAt = Date.now(); // trigger post-close cooldown
    persistState();

    // Record closes on-chain in ActuraRiskPolicy
    for (const closed of closedPositions) {
      recordCloseOnChain(closed.pnl, closed.size * closed.entryPrice)
        .catch(e => log.warn('recordCloseOnChain failed (non-critical)', { error: String(e) }));
    }

    // Close corresponding Kraken positions when stop-losses fire
    const krakenCloseEnabled = !!(process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET) || process.env.KRAKEN_PAPER_TRADING !== 'false';
    if (krakenCloseEnabled && (MODE === 'live' || MODE === 'kraken' || process.env.KRAKEN_PAPER_TRADING !== 'false')) {
      for (const closed of closedPositions) {
        const pos = positions.find(p => p.id === closed.id);
        if (pos) {
          closeKrakenPosition(pos.asset, pos.side, pos.size.toFixed(8), closed.reason)
            .then(r => {
              if (r.success) log.info('Kraken position closed', { orderId: r.orderId, reason: closed.reason });
              else log.warn('Kraken close failed', { error: r.error, reason: closed.reason });
            })
            .catch(e => log.warn('Kraken close threw', { error: String(e) }));
        }
      }
    }
  }

  // Step 9b: Record outcomes for neuro-symbolic + adaptive learning
  for (const closed of closedPositions) {
    const pos = positions.find(p => p.id === closed.id);
    if (pos) {
      const pnlPct = pos.entryPrice > 0 ? closed.pnl / (pos.entryPrice * pos.size) * 100 : 0;
      recordClosedTrade({
        id: pos.id, asset: pos.asset, side: pos.side, size: pos.size,
        entryPrice: pos.entryPrice, exitPrice: currentPrice, pnl: closed.pnl, pnlPct,
        stopHit: closed.reason === 'stop_loss', reason: closed.reason,
        openedAt: pos.openedAt, closedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(pos.openedAt).getTime(),
        ipfsCid: pos.ipfsCid, txHash: pos.txHash,
      });
      recordOutcome({
        direction: pos.side,
        confidence: strategyOutput.signal.confidence,
        price: currentPrice,
        result: closed.pnl >= 0 ? 'win' : 'loss',
        timestamp: new Date().toISOString(),
      });

      // Track loss streak for global cooldown
      const isWin = closed.pnl >= 0;
      recentCloseTimestamps.push({ time: Date.now(), win: isWin });
      // Keep only last 10 closes
      if (recentCloseTimestamps.length > 10) recentCloseTimestamps.shift();
      if (!isWin) {
        // Count consecutive recent losses (any direction)
        let streak = 0;
        for (let i = recentCloseTimestamps.length - 1; i >= 0; i--) {
          if (!recentCloseTimestamps[i].win) streak++;
          else break;
        }
        if (streak >= LOSS_STREAK_THRESHOLD) {
          lossStreakCooldownUntil = Date.now() + LOSS_STREAK_COOLDOWN_MS;
          log.warn(`${streak} consecutive losses — activating ${LOSS_STREAK_COOLDOWN_MS / 60000}min cooldown`, {
            streak, cooldownUntil: new Date(lossStreakCooldownUntil).toISOString(),
          });
        }
      }
      recordTradeOutcome({
        direction: pos.side as 'LONG' | 'SHORT',
        entryPrice: pos.entryPrice,
        exitPrice: currentPrice,
        pnlPct,
        stopHit: closed.reason === 'stop_loss',
        regime: riskDecision.volatility.regime as any,
        confidence: strategyOutput.signal.confidence,
        timestamp: new Date().toISOString(),
      });
      // SAGE: record enriched outcome with feature vector for LLM reflection
      recordSAGEOutcome({
        direction: pos.side as 'LONG' | 'SHORT',
        entryPrice: pos.entryPrice,
        exitPrice: currentPrice,
        pnlPct,
        stopHit: closed.reason === 'stop_loss',
        regime: riskDecision.volatility.regime as any,
        confidence: strategyOutput.signal.confidence,
        ret5: strategyOutput.signal.ret5 ?? undefined,
        ret20: strategyOutput.signal.ret20 ?? undefined,
        rsi: strategyOutput.signal.rsi ?? undefined,
        adx: strategyOutput.signal.adx ?? undefined,
        zscore: strategyOutput.signal.zscore ?? undefined,
        sentimentComposite: strategyOutput.signal.sentimentComposite ?? undefined,
        alphaScore: strategyOutput.signal.alphaScore ?? undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Step 10: Adaptive learning (every 10 cycles)
  if (cycleCount % 10 === 0) {
    const adaptations = runAdaptation(cycleCount);
    for (const adapt of adaptations) {
      log.info(`Adaptation: ${adapt.parameter} ${adapt.previousValue} → ${adapt.newValue} (${adapt.trigger})`);
    }

    // SAGE reflection: LLM-powered learning from trade outcomes
    if (isSAGEEnabled()) {
      const sageReflection = await runSAGEReflection(cycleCount);
      if (sageReflection) {
        log.info(`SAGE: ${sageReflection.insights.length} insights, ${sageReflection.newRules.length} rules, ${sageReflection.weightChanges.length} weight changes`);
        for (const wc of sageReflection.weightChanges) {
          log.info(`SAGE weight: ${wc.parameter} ${wc.from} → ${wc.to} (${wc.reasoning.slice(0, 80)})`);
        }
      }
    }

    persistState();
  }

  const currentPositions = riskEngine.getOpenPositions();

  // Log cycle
  const elapsed = Date.now() - cycleStart;
  const marker = shouldExecute ? '✅' : (riskDecision.circuitBreaker.active ? '🛑' : '⏸️');

  log.info(
    `${marker} Cycle ${cycleCount} | ` +
    `$${strategyOutput.currentPrice.toFixed(2)} | ` +
    `${strategyOutput.signal.direction} (${strategyOutput.signal.confidence.toFixed(2)}) | ` +
    `Cap: $${capital.toFixed(0)} | ` +
    `Pos: ${currentPositions.length}/${MAX_OPEN_POSITIONS} | ` +
    `${cognitive.rulesFired > 0 ? `Rules: ${cognitive.rulesFired} | ` : ''}` +
    `${sentiment?.sources.length ? `Sent: ${sentiment.composite.toFixed(2)} (${sentiment.sources.join(',')}) | ` : ''}` +
    `Oracle: ${oracleIntegrity.status} | DEX: ${dexRouting.selectedDex} | Sim: ${executionSimulation.reason} | ` +
    `${elapsed}ms`
  );

  if (shouldExecute) {
    log.info(
      `  → ${strategyOutput.signal.direction} ${riskDecision.finalPositionSize.toFixed(4)} @ $${strategyOutput.currentPrice.toFixed(2)} | ` +
      `Stop: $${riskDecision.stopLossPrice?.toFixed(2) ?? 'N/A'} | ` +
      `TP: $${takeProfitPrice?.toFixed(2) ?? 'N/A'} | ` +
      `IPFS: ${ipfsResult?.cid?.slice(0, 16) ?? 'none'}`
    );
  }
}

// ──── State Persistence ────

function persistState(): void {
  const status = riskEngine.getStatus();
  const stats = getTradeStats();
  const state: PersistedState = {
    capital: status.capital,
    openPositions: status.openPositions,
    peakCapital: status.circuitBreaker.peakCapital,
    totalTrades: stats.totalTrades,
    totalPnl: status.capital - INITIAL_CAPITAL,
    agentId,
    lastCycle: cycleCount,
    lastSavedAt: new Date().toISOString(),
  };
  saveState(state);
  // Persist price history alongside state so SMA50 survives restarts
  if (marketData) {
    savePriceHistory(marketData);
  }
}

// ──── Public Accessors (for Dashboard/MCP) ────

export function getAgentState() {
  return {
    cycleCount,
    running: scheduler?.isRunning() ?? false,
    agentId,
    risk: riskEngine?.getStatus() ?? null,
    market: marketData ? computeMarketState(marketData) : null,
    liveFeed: getLiveFeedStatus(),
    krakenFeed: getKrakenFeedStatus(),
    krakenCli: getCliStatus(),
    eventIndexer: getIndexerStatus(),
    recentCheckpoints: getCheckpoints(10),
    scheduler: scheduler?.getState() ?? null,
    maxPositions: MAX_OPEN_POSITIONS,
    operatorControl: getOperatorControlState(),
    sentiment: lastSentiment,
  };
}

export function getHealthCheck() {
  const state = scheduler?.getState();
  let ownerAddress = '';
  try { ownerAddress = getWalletAddress(); } catch { /* not initialised yet */ }
  return {
    status: state?.running ? 'healthy' : 'stopped',
    uptime: state?.uptime ?? 0,
    cycles: state?.cycleCount ?? 0,
    errors: state?.errorCount ?? 0,
    consecutiveErrors: state?.consecutiveErrors ?? 0,
    lastCycle: state?.lastCycleAt,
    lastError: state?.lastError,
    capital: riskEngine?.getCapital() ?? 0,
    positions: riskEngine?.getOpenPositions().length ?? 0,
    agentId: agentId ?? config.agentId ?? 338,
    identityRegistry: config.identityRegistry,
    reputationRegistry: config.reputationRegistry,
    validationRegistry: config.validationRegistry,
    chainId: config.chainId,
    ownerAddress,
    riskPolicyAddress: process.env.RISK_POLICY_ADDRESS || '',
  };
}

export function getLogs(limit?: number) {
  return getRecentLogs(limit);
}

export function getErrors(limit?: number) {
  return getErrorLogs(limit);
}

export { getCheckpoints, getTradeCheckpoints };

export function initAgent_export(): Promise<void> { return initAgent(); }
export function stopAgent(): void { scheduler?.shutdown('manual'); }

// ──── Simulation Mode (for testing) ────

export async function runSimulation(cycles: number = 50): Promise<void> {
  await initAgent();

  log.info(`Running ${cycles} trading cycles (simulation mode)`);

  for (let i = 0; i < cycles; i++) {
    await runCycle();
  }

  // Print summary
  const status = riskEngine.getStatus();
  const allCheckpoints = getCheckpoints(1000);
  const trades = allCheckpoints.filter(c => c.riskDecision.approved);
  const marketState = computeMarketState(marketData);

  console.log('\n═══════════════════════════════════════════');
  console.log('  SIMULATION COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Cycles:         ${cycleCount}`);
  console.log(`  Trades:         ${trades.length}`);
  console.log(`  Final Capital:  $${status.capital.toFixed(2)}`);
  console.log(`  PnL:            $${(status.capital - INITIAL_CAPITAL).toFixed(2)} (${(((status.capital - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100).toFixed(2)}%)`);
  console.log(`  Open Positions: ${status.openPositions.length}`);
  console.log(`  Circuit Breaks: ${status.circuitBreaker.tripsToday}`);
  console.log(`  Artifacts:      ${allCheckpoints.length} generated`);
  console.log(`  Current Price:  $${marketState.currentPrice.toFixed(2)}`);
  console.log(`  Volatility:     ${marketState.volatility?.toFixed(4) ?? 'N/A'}`);
  console.log('═══════════════════════════════════════════\n');

  persistState();
}

// ──── Entry Point ────
import { executeTrade, preflight, claimSandboxCapital } from '../chain/executor.js';
import { getWalletAddress } from '../chain/sdk.js';
import { startDashboard, stopDashboard } from '../dashboard/server.js';
import { startMcpServer, stopMcpServer } from '../mcp/server.js';

// ──── Graceful Shutdown ────

let shuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Received ${signal} — shutting down gracefully...`);

  scheduler?.shutdown(signal);
  persistState();

  Promise.all([stopDashboard(), stopMcpServer()])
    .then(() => {
      log.info('All servers stopped. Goodbye.');
      process.exit(0);
    })
    .catch(() => process.exit(1));

  // Force exit after 10s if graceful shutdown stalls
  setTimeout(() => {
    log.warn('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Prevent ancillary server errors (EADDRINUSE on dashboard/MCP) from
// crashing the trading loop.  Log and continue.
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception (non-fatal)', { message: err.message, stack: err.stack });
  // Only re-throw if this is something truly fatal (OOM, etc.)
  if (err.message.includes('out of memory') || err.message.includes('ENOMEM')) {
    process.exit(1);
  }
});

// Start servers
startDashboard(3000);
startMcpServer(3001);

// Run in simulation mode (swap for scheduler in production)
// Run in selected mode
if (MODE === 'live') {
  // Production: preflight → claim sandbox → scheduler

  (async () => {
    await initAgent();

    // Preflight checks
    const flight = await preflight();
    if (!flight.ready) {
      log.warn('Preflight issues found — some features may not work');
    }

    // Claim sandbox capital (idempotent — safe to call multiple times)
    if (config.capitalVaultAddress) {
      try {
        await claimSandboxCapital();
      } catch (e) {
        log.warn('Sandbox claim failed — may already be claimed', { error: String(e) });
      }
    }

    // Start scheduled trading
    scheduler = new Scheduler(config.tradingIntervalMs);
    scheduler.onShutdown(() => {
      log.info('Persisting state on shutdown...');
      persistState();
    });
    scheduler.start(runCycle, () => {
      log.info('Daily circuit breaker reset');
      riskEngine.resetDaily();
    });
  })().catch(err => {
    log.fatal('Live mode startup failed', { error: String(err) });
    process.exit(1);
  });
} else {
  // Simulation: run N cycles fast
  runSimulation(50).catch(err => {
    log.fatal('Simulation failed', { error: String(err) });
    process.exit(1);
  });
}
