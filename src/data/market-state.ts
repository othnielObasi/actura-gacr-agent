/**
 * Market State Aggregator
 * Maintains current market state from price feed
 */

import type { MarketData } from '../strategy/momentum.js';
import { sma, ewmaVolatility, atr } from '../strategy/indicators.js';
import { config } from '../agent/config.js';

export interface MarketState {
  currentPrice: number;
  smaFast: number | null;
  smaSlow: number | null;
  volatility: number | null;
  atr: number | null;
  priceChange24h: number | null;
  dataPoints: number;
  lastUpdate: string;
}

/**
 * Compute current market state from data
 */
export function computeMarketState(data: MarketData): MarketState {
  const currentPrice = data.prices[data.prices.length - 1];
  
  // Calculate indicators
  const smaFast = sma(data.prices, config.strategy.smaFast);
  const smaSlow = sma(data.prices, config.strategy.smaSlow);
  const volatility = ewmaVolatility(data.prices, config.strategy.ewmaSpan);
  const atrValue = atr(data.highs, data.lows, data.prices, config.strategy.atrPeriod);

  // 24h price change (assuming hourly data, 24 periods)
  let priceChange24h: number | null = null;
  if (data.prices.length >= 24) {
    const price24hAgo = data.prices[data.prices.length - 24];
    priceChange24h = (currentPrice - price24hAgo) / price24hAgo;
  }

  return {
    currentPrice,
    smaFast,
    smaSlow,
    volatility,
    atr: atrValue,
    priceChange24h,
    dataPoints: data.prices.length,
    lastUpdate: new Date().toISOString(),
  };
}
