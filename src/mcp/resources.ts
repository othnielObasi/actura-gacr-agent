/**
 * MCP Resource Definitions
 * Resources that Actura publishes for other agents to subscribe to
 */

import { getAgentState } from '../agent/index.js';
import { config } from '../agent/config.js';

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: () => unknown;
}

/**
 * Resource 1: Live market state
 */
export const marketState: McpResource = {
  uri: 'actura://market-state',
  name: 'Current Market State',
  description: 'Real-time indicators: SMA20, SMA50, volatility, ATR, price change',
  mimeType: 'application/json',
  handler: () => {
    const state = getAgentState();
    const market = state.market;
    return {
      pair: config.tradingPair,
      currentPrice: market?.currentPrice ?? null,
      smaFast: market?.smaFast ?? null,
      smaSlow: market?.smaSlow ?? null,
      volatility: market?.volatility ?? null,
      atr: market?.atr ?? null,
      priceChange24h: market?.priceChange24h ?? null,
      dataPoints: market?.dataPoints ?? 0,
      lastUpdate: market?.lastUpdate ?? null,
    };
  },
};

/**
 * Resource 2: Agent governance policy
 */
export const governancePolicy: McpResource = {
  uri: 'actura://governance-policy',
  name: 'Agent Governance Policy',
  description: 'Risk limits, circuit breaker thresholds, position sizing rules, and trading parameters',
  mimeType: 'application/json',
  handler: () => ({
    agent: {
      name: config.agentName,
      description: config.agentDescription,
      strategy: 'VolAdjMomentum',
      version: '1.0',
    },
    riskLimits: {
      maxPositionPct: config.maxPositionPct,
      maxDailyLossPct: config.maxDailyLossPct,
      maxDrawdownPct: config.maxDrawdownPct,
      maxLeverage: 1.0,
    },
    strategy: {
      smaFastPeriod: config.strategy.smaFast,
      smaSlowPeriod: config.strategy.smaSlow,
      ewmaSpan: config.strategy.ewmaSpan,
      atrPeriod: config.strategy.atrPeriod,
      basePositionPct: config.strategy.basePositionPct,
      stopLossAtrMultiple: config.strategy.stopLossAtrMultiple,
      baselineVolatility: config.strategy.baselineVolatility,
    },
    circuitBreaker: {
      dailyLossThreshold: config.maxDailyLossPct,
      maxDrawdownThreshold: config.maxDrawdownPct,
      action: 'halt_all_trading',
    },
    trust: {
      registries: ['ERC-8004 Identity', 'ERC-8004 Validation', 'ERC-8004 Reputation'],
      artifactStorage: 'IPFS (Pinata)',
      validationFrequency: 'every_trade',
    },
  }),
};

/** All resources */
export const ALL_RESOURCES: McpResource[] = [
  marketState,
  governancePolicy,
];
