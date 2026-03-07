/**
 * MCP Tool Definitions
 * Defines the tools Actura exposes via MCP
 * Other agents can call these to query risk, trades, and explanations
 */

import { getAgentState } from '../agent/index.js';
import { getCheckpoints, getTradeCheckpoints, getLastCheckpoint } from '../trust/checkpoint.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: Record<string, unknown>) => unknown;
}

/**
 * Tool 1: Get current risk metrics
 */
export const getRiskStatus: McpTool = {
  name: 'get_risk_status',
  description: 'Returns current risk engine state: volatility, exposure, drawdown, circuit breaker status',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: () => {
    const state = getAgentState();
    return {
      capital: state.risk.capital,
      volatility: state.risk.volatility,
      circuitBreaker: {
        active: state.risk.circuitBreaker.active,
        reason: state.risk.circuitBreaker.reason,
        dailyPnl: state.risk.circuitBreaker.dailyPnl,
        dailyPnlPct: state.risk.circuitBreaker.dailyPnlPct,
        drawdownPct: state.risk.circuitBreaker.drawdownPct,
      },
      openPositions: state.risk.openPositions.length,
      totalTrades: state.risk.totalTrades,
    };
  },
};

/**
 * Tool 2: Explain last trade
 */
export const explainLastTrade: McpTool = {
  name: 'explain_last_trade',
  description: 'Returns human-readable explanation and validation artifact for the most recent trade decision',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: () => {
    const checkpoint = getLastCheckpoint();
    if (!checkpoint) {
      return { error: 'No trades yet' };
    }
    return {
      cycle: checkpoint.id,
      timestamp: checkpoint.timestamp,
      signal: checkpoint.strategyOutput.signal.direction,
      confidence: checkpoint.strategyOutput.signal.confidence,
      approved: checkpoint.riskDecision.approved,
      explanation: checkpoint.riskDecision.explanation,
      riskChecks: checkpoint.riskDecision.checks.map(c => ({
        name: c.name,
        passed: c.passed,
        detail: c.detail,
      })),
      artifactIpfs: checkpoint.ipfs?.uri || null,
      onChainTx: checkpoint.onChainTxHash || null,
    };
  },
};

/**
 * Tool 3: Get trade history
 */
export const getTradeHistory: McpTool = {
  name: 'get_trade_history',
  description: 'Returns recent trade decisions with validation artifact links',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Number of trades to return (default: 10)' },
      approved_only: { type: 'boolean', description: 'Only show approved trades (default: false)' },
    },
  },
  handler: (args) => {
    const limit = (args.limit as number) || 10;
    const approvedOnly = (args.approved_only as boolean) || false;

    const checkpoints = approvedOnly
      ? getTradeCheckpoints(limit)
      : getCheckpoints(limit);

    return {
      count: checkpoints.length,
      trades: checkpoints.map(cp => ({
        id: cp.id,
        timestamp: cp.timestamp,
        signal: cp.strategyOutput.signal.direction,
        confidence: cp.strategyOutput.signal.confidence,
        price: cp.strategyOutput.currentPrice,
        approved: cp.riskDecision.approved,
        positionSize: cp.riskDecision.finalPositionSize,
        explanation: cp.riskDecision.explanation,
        artifactIpfs: cp.ipfs?.uri || null,
      })),
    };
  },
};

/**
 * Tool 4: Get portfolio summary
 */
export const getPortfolio: McpTool = {
  name: 'get_portfolio',
  description: 'Returns current capital, positions, and performance metrics',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: () => {
    const state = getAgentState();
    return {
      capital: state.risk.capital,
      openPositions: state.risk.openPositions.map(p => ({
        asset: p.asset,
        side: p.side,
        size: p.size,
        entryPrice: p.entryPrice,
        stopLoss: p.stopLoss,
        openedAt: p.openedAt,
      })),
      totalTrades: state.risk.totalTrades,
      recentPnl: state.risk.recentPnl,
      market: {
        currentPrice: state.market?.currentPrice ?? null,
        volatility: state.market?.volatility ?? null,
        smaFast: state.market?.smaFast ?? null,
        smaSlow: state.market?.smaSlow ?? null,
      },
    };
  },
};

/**
 * Tool 5: Ask the agent anything (natural language)
 * Judges can interrogate the agent about its decisions
 */
export const askAgent: McpTool = {
  name: 'ask_agent',
  description: 'Ask Actura a natural language question about its strategy, risk management, or recent decisions. The agent will explain its reasoning.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Your question about the agent' },
    },
    required: ['question'],
  },
  handler: (args) => {
    const question = (args.question as string || '').toLowerCase();
    const state = getAgentState();
    const lastCp = getLastCheckpoint();

    // Route question to appropriate data
    if (question.includes('why') && (question.includes('trade') || question.includes('buy') || question.includes('sell'))) {
      if (!lastCp) return { answer: 'No trades executed yet. The agent is waiting for market data to accumulate.' };
      const reasoning = lastCp.artifact?.aiReasoning;
      return {
        answer: reasoning?.tradeRationale || lastCp.riskDecision.explanation,
        signal: lastCp.strategyOutput.signal.direction,
        confidence: lastCp.strategyOutput.signal.confidence,
        riskChecks: lastCp.riskDecision.checks.map(c => `${c.name}: ${c.passed ? '✓' : '✗'} — ${c.detail}`),
        marketContext: reasoning?.marketContext || 'N/A',
      };
    }

    if (question.includes('risk') || question.includes('safe') || question.includes('danger')) {
      return {
        answer: `Current risk profile: ${state.risk?.volatility?.regime || 'unknown'} volatility, ` +
          `drawdown at ${((state.risk?.circuitBreaker?.drawdownPct || 0) * 100).toFixed(2)}%, ` +
          `${state.risk?.openPositions?.length || 0} open positions. ` +
          `Circuit breaker: ${state.risk?.circuitBreaker?.active ? 'ACTIVE — trading halted' : 'inactive — trading allowed'}.`,
        drawdownPct: state.risk?.circuitBreaker?.drawdownPct,
        dailyPnlPct: state.risk?.circuitBreaker?.dailyPnlPct,
        volatilityRegime: state.risk?.volatility?.regime,
        circuitBreaker: state.risk?.circuitBreaker?.active ? state.risk.circuitBreaker.reason : 'not triggered',
      };
    }

    if (question.includes('strateg') || question.includes('how') && question.includes('work')) {
      return {
        answer: 'Actura uses a Volatility-Adjusted Momentum strategy. It monitors SMA(20) vs SMA(50) crossovers to detect trends, ' +
          'then sizes positions inversely to current volatility — smaller in choppy markets, larger in calm ones. ' +
          'Every trade must pass 6 risk checks: circuit breaker, signal quality, position size, total exposure, volatility regime, and position conflict. ' +
          'ATR-based trailing stop-losses protect against reversals. All decisions produce IPFS-pinned validation artifacts.',
        strategy: 'VolAdjMomentum (SMA20/50 crossover)',
        riskChecks: ['circuit_breaker', 'signal_quality', 'max_position_size', 'total_exposure', 'volatility_regime', 'position_conflict'],
        differentiators: [
          'AI-powered explainability on every trade',
          'Confidence intervals with risk/reward ratios',
          'Full market snapshots for reproducibility',
          'Trailing stops that move with price',
          '10bps slippage model for realistic execution',
        ],
      };
    }

    if (question.includes('performance') || question.includes('pnl') || question.includes('profit')) {
      return {
        answer: `Capital: $${state.risk?.capital?.toFixed(2) || 'N/A'}, ` +
          `Total trades: ${state.risk?.totalTrades || 0}, ` +
          `Open positions: ${state.risk?.openPositions?.length || 0}. ` +
          `Cycle count: ${state.cycleCount}.`,
        capital: state.risk?.capital,
        totalTrades: state.risk?.totalTrades,
        openPositions: state.risk?.openPositions?.length,
        recentPnl: state.risk?.recentPnl,
      };
    }

    // Default
    return {
      answer: `Actura is an accountable autonomous trading agent. I've run ${state.cycleCount} cycles, ` +
        `executed ${state.risk?.totalTrades || 0} trades, and generated validation artifacts for every decision. ` +
        `Ask me about my strategy, risk management, recent trades, or performance.`,
      availableQueries: [
        'Why did you make that trade?',
        'What is your risk level right now?',
        'How does your strategy work?',
        'What is your performance so far?',
        'What are you watching for?',
      ],
    };
  },
};

/**
 * Tool 6: Deep risk analysis
 */
export const getRiskAnalysis: McpTool = {
  name: 'get_risk_analysis',
  description: 'Returns a comprehensive risk analysis including confidence intervals, exposure breakdown, and risk/reward ratios for open positions',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: () => {
    const state = getAgentState();
    const lastCp = getLastCheckpoint();

    const positions = state.risk?.openPositions || [];
    const currentPrice = state.market?.currentPrice || 0;

    const positionAnalysis = positions.map((p: any) => {
      const unrealizedPnl = p.side === 'LONG'
        ? (currentPrice - p.entryPrice) * p.size
        : (p.entryPrice - currentPrice) * p.size;
      const unrealizedPct = p.entryPrice > 0 ? unrealizedPnl / (p.entryPrice * p.size) * 100 : 0;
      const distToStop = p.stopLoss ? Math.abs(currentPrice - p.stopLoss) / currentPrice * 100 : null;

      return {
        id: p.id,
        side: p.side,
        entryPrice: p.entryPrice,
        currentPrice,
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
        unrealizedPct: Math.round(unrealizedPct * 100) / 100,
        stopLoss: p.stopLoss,
        distanceToStop: distToStop ? `${distToStop.toFixed(2)}%` : 'none',
      };
    });

    const totalUnrealized = positionAnalysis.reduce((s: number, p: any) => s + p.unrealizedPnl, 0);
    const totalExposure = positions.reduce((s: number, p: any) => s + p.size * currentPrice, 0);
    const exposurePct = state.risk?.capital ? totalExposure / state.risk.capital * 100 : 0;

    return {
      summary: `${positions.length} positions, $${totalUnrealized.toFixed(2)} unrealized PnL, ${exposurePct.toFixed(1)}% exposure`,
      capital: state.risk?.capital,
      totalExposure: Math.round(totalExposure * 100) / 100,
      exposurePct: Math.round(exposurePct * 100) / 100,
      maxExposurePct: state.risk?.maxExposurePct ? state.risk.maxExposurePct * 100 : 30,
      totalUnrealizedPnl: Math.round(totalUnrealized * 100) / 100,
      positions: positionAnalysis,
      circuitBreaker: state.risk?.circuitBreaker,
      volatility: state.risk?.volatility,
      lastArtifactConfidence: lastCp?.artifact?.confidenceInterval || null,
    };
  },
};

/**
 * Tool 7: Get validation quality metrics
 */
export const getValidationQuality: McpTool = {
  name: 'get_validation_quality',
  description: 'Returns metrics about the quality and completeness of validation artifacts produced',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Number of recent artifacts to analyze (default: 20)' },
    },
  },
  handler: (args) => {
    const limit = (args.limit as number) || 20;
    const checkpoints = getCheckpoints(limit);

    const totalArtifacts = checkpoints.length;
    const withIpfs = checkpoints.filter(c => c.ipfs?.cid).length;
    const withAiReasoning = checkpoints.filter(c => c.artifact?.aiReasoning).length;
    const withConfidenceInterval = checkpoints.filter(c => c.artifact?.confidenceInterval).length;
    const withMarketSnapshot = checkpoints.filter(c => c.artifact?.marketSnapshot).length;
    const approved = checkpoints.filter(c => c.riskDecision.approved).length;
    const rejected = totalArtifacts - approved;

    // Average risk checks passed
    const avgChecksPassed = totalArtifacts > 0
      ? checkpoints.reduce((sum, c) => sum + c.riskDecision.checks.filter((ch: any) => ch.passed).length, 0) / totalArtifacts
      : 0;

    // Completeness score (0-100)
    const completeness = totalArtifacts > 0
      ? Math.round(
          (withIpfs / totalArtifacts * 25) +
          (withAiReasoning / totalArtifacts * 25) +
          (withConfidenceInterval / totalArtifacts * 25) +
          (withMarketSnapshot / totalArtifacts * 25)
        )
      : 0;

    return {
      summary: `${totalArtifacts} artifacts analyzed, ${completeness}% completeness score`,
      totalArtifacts,
      completenessScore: completeness,
      breakdown: {
        ipfsPinned: `${withIpfs}/${totalArtifacts}`,
        aiReasoning: `${withAiReasoning}/${totalArtifacts}`,
        confidenceIntervals: `${withConfidenceInterval}/${totalArtifacts}`,
        marketSnapshots: `${withMarketSnapshot}/${totalArtifacts}`,
      },
      decisions: {
        approved,
        rejected,
        approvalRate: totalArtifacts > 0 ? `${(approved / totalArtifacts * 100).toFixed(1)}%` : 'N/A',
      },
      avgRiskChecksPassed: Math.round(avgChecksPassed * 100) / 100,
      totalRiskChecks: 6,
    };
  },
};

/** All tools */
export const ALL_TOOLS: McpTool[] = [
  getRiskStatus,
  explainLastTrade,
  getTradeHistory,
  getPortfolio,
  askAgent,
  getRiskAnalysis,
  getValidationQuality,
];
