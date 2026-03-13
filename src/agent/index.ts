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
import { buildTradeArtifact, enrichArtifact, attachGovernanceEvidence } from '../trust/artifact-emitter.js';
import { getLastTrustScore } from '../trust/trust-policy-scorecard.js';
import { evaluateSupervisoryDecision, applySupervisorySizing, summarizeSupervisoryDecision } from './supervisory-meta-agent.js';
import { generateReasoning } from '../strategy/ai-reasoning.js';
import { applySymbolicReasoning, recordOutcome } from '../strategy/neuro-symbolic.js';
import { runAdaptation, recordTradeOutcome, getAdaptiveParams, getAdaptationSummary, type AdaptationArtifact } from '../strategy/adaptive-learning.js';
import { RegimeGovernanceController, mapVolToRegime } from '../strategy/regime-governance.js';
import { uploadArtifact } from '../trust/ipfs.js';
import { saveCheckpoint, getCheckpoints, getTradeCheckpoints } from '../trust/checkpoint.js';
import { computeMarketState } from '../data/market-state.js';
import { evaluateOracleIntegrity } from '../security/oracle-integrity.js';
import { evaluateMandate, getDefaultMandate, buildMandateRiskChecks } from '../chain/agent-mandate.js';
import { simulateExecution } from '../chain/execution-simulator.js';
import { generateSimulatedData, appendCandle } from '../data/price-feed.js';
import { fetchLivePrice, fetchOHLCHistory, buildLiveCandle, getLiveFeedStatus } from '../data/live-price-feed.js';
import { getOperatorControlState, getLatestOperatorAction } from './operator-control.js';
import { recordClosedTrade, getRecentTrades, getTradeStats, loadClosedTrades } from './trade-log.js';

const log = createLogger('AGENT');

const MODE = process.env.MODE || 'simulation';
const DATA_SOURCE = process.env.DATA_SOURCE || 'live'; // 'live' | 'simulated'

// ──── Agent State ────
const INITIAL_CAPITAL = 10000;
const MAX_OPEN_POSITIONS = 2;

let marketData: MarketData;
let riskEngine: RiskEngine;
let scheduler: Scheduler;
let agentId: number | null = config.agentId ?? null;
let cycleCount = 0;
let regimeGovernance = new RegimeGovernanceController();

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
}

// ──── Trading Cycle ────

/**
 * Load initial market data — tries live OHLC history first, falls back to simulation.
 */
async function loadInitialMarketData(): Promise<MarketData> {
  // Try to restore persisted price history first — avoids SMA50 cold-start.
  const cached = loadPriceHistory();

  if (DATA_SOURCE === 'live') {
    log.info('Fetching live OHLC history from CoinGecko...');
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

    // CoinGecko failed — try cached price history.
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

  // Step 2: Run strategy
  const capital = riskEngine.getCapital();
  const strategyOutput = runStrategy(marketData, capital);

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

  let shouldExecute = riskDecision.approved && !positionLimitHit;

  // Step 4b: Execution simulation — required pre-trade safety stage
  const executionSimulation = simulateExecution({
    strategyOutput,
    riskDecision,
    // Paper trading has no real gas cost — don't let fictional gas
    // eat into net edge and block trades that would be profitable.
    // Only charge gas when Risk Router is configured for real on-chain execution.
    gasUsd: config.riskRouterAddress ? 0.35 : 0,
  });
  if (shouldExecute && !executionSimulation.allowed) {
    shouldExecute = false;
    strategyOutput.signal.reason = `[SIMULATION BLOCK] ${executionSimulation.reason} | ${strategyOutput.signal.reason}`;
    log.warn('Execution simulation blocked trade', executionSimulation);
  }

  // Step 5: Build validation artifact (ALWAYS — even for rejected trades)
  let artifact = buildTradeArtifact(strategyOutput, riskDecision, agentId);
  artifact = attachGovernanceEvidence(artifact, {
    mandateDecision,
    oracleIntegrity,
    executionSimulation,
    operatorControl: {
      ...operatorControl,
      latestAction: getLatestOperatorAction(),
    },
  });

  // Add cognitive + supervisory layer data to artifact
  (artifact as any).supervisory = supervisory;
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

  // Step 5b: Enrich with AI reasoning + market snapshot + confidence intervals
  const aiReasoning = await generateReasoning(
    strategyOutput, riskDecision, marketData.prices, capital, openCount
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
  if (shouldExecute) {
    if (MODE === 'live' && agentId) {
      // REAL EXECUTION: Sign intent → Risk Router → Validation → Reputation
      const execResult = await executeTrade(strategyOutput, riskDecision, artifact, agentId);
      if (execResult.success) {
        checkpoint.onChainTxHash = execResult.intentTxHash;
        ipfsResult = ipfsResult || { cid: execResult.artifactIpfsCid!, uri: execResult.artifactIpfsUri!, gatewayUrl: '' };
      } else {
        log.warn('On-chain execution failed — recording locally only', { error: execResult.error });
      }
    }

    // Always record position locally (for our risk engine tracking)
    riskEngine.openPosition({
      asset: config.tradingPair,
      side: strategyOutput.signal.direction as 'LONG' | 'SHORT',
      size: riskDecision.finalPositionSize,
      entryPrice: strategyOutput.currentPrice,
      stopLoss: riskDecision.stopLossPrice,
      openedAt: new Date().toISOString(),
      ipfsCid: ipfsResult?.cid ?? null,
      txHash: checkpoint.onChainTxHash ?? null,
    });

    // Persist immediately after opening a position so it survives crashes
    persistState();
  }

  // Step 9: Update trailing stops and check stop-losses
  // Skip stop-loss checks when price is noise-injected from a feed failure
  // — synthetic noise should never trigger real position closures.
  const currentPrice = strategyOutput.currentPrice;
  const closedPositions = livePriceAvailable
    ? riskEngine.updateStops(currentPrice)
    : [];

  // Persist immediately after stop-loss closes so state survives crashes.
  // Without this, a crash between stop-close and the next persist (up to
  // 10 cycles later) replays the close on restart with a potentially
  // different price.
  if (closedPositions.length > 0) {
    persistState();
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
    }
  }

  // Step 10: Adaptive learning (every 10 cycles)
  if (cycleCount % 10 === 0) {
    const adaptations = runAdaptation(cycleCount);
    for (const adapt of adaptations) {
      log.info(`Adaptation: ${adapt.parameter} ${adapt.previousValue} → ${adapt.newValue} (${adapt.trigger})`);
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
    `Oracle: ${oracleIntegrity.status} | Sim: ${executionSimulation.reason} | ` +
    `${elapsed}ms`
  );

  if (shouldExecute) {
    log.info(
      `  → ${strategyOutput.signal.direction} ${riskDecision.finalPositionSize.toFixed(4)} @ $${strategyOutput.currentPrice.toFixed(2)} | ` +
      `Stop: $${riskDecision.stopLossPrice?.toFixed(2) ?? 'N/A'} | ` +
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
    recentCheckpoints: getCheckpoints(10),
    scheduler: scheduler?.getState() ?? null,
    maxPositions: MAX_OPEN_POSITIONS,
    operatorControl: getOperatorControlState(),
  };
}

export function getHealthCheck() {
  const state = scheduler?.getState();
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
