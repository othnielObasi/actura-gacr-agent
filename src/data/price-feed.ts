/**
 * Price Feed
 * 
 * In production: connects to DEX price feeds (Uniswap, etc.)
 * For development/testing: generates realistic simulated data
 */

import type { MarketData } from '../strategy/momentum.js';

export interface PriceCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Generate simulated price data with realistic properties
 * Uses geometric Brownian motion with mean reversion
 */
export function generateSimulatedData(
  periods: number = 100,
  startPrice: number = 3000,
  dailyVolatility: number = 0.02,
  trendBias: number = 0.0002  // Slight upward bias
): MarketData {
  const prices: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const timestamps: string[] = [];
  
  let price = startPrice;
  const now = Date.now();

  for (let i = 0; i < periods; i++) {
    // Geometric Brownian motion
    const drift = trendBias;
    const shock = dailyVolatility * gaussianRandom();
    const returnPct = drift + shock;
    
    price = price * (1 + returnPct);
    
    // Generate OHLC candle
    const range = price * dailyVolatility * 0.5;
    const high = price + Math.abs(gaussianRandom() * range);
    const low = price - Math.abs(gaussianRandom() * range);
    
    prices.push(Math.round(price * 100) / 100);
    highs.push(Math.round(high * 100) / 100);
    lows.push(Math.round(Math.max(low, 1) * 100) / 100);
    timestamps.push(new Date(now - (periods - i) * 3600000).toISOString()); // hourly
  }

  return { prices, highs, lows, timestamps };
}

/**
 * Generate data with a specific pattern for testing
 */
export function generateTrendingData(
  direction: 'up' | 'down',
  periods: number = 100,
  startPrice: number = 3000
): MarketData {
  const bias = direction === 'up' ? 0.003 : -0.003;
  return generateSimulatedData(periods, startPrice, 0.015, bias);
}

/**
 * Generate volatile/choppy data
 */
export function generateChoppyData(
  periods: number = 100,
  startPrice: number = 3000
): MarketData {
  return generateSimulatedData(periods, startPrice, 0.04, 0);
}

/**
 * Append a new candle to existing market data
 */
export function appendCandle(data: MarketData, candle: PriceCandle): MarketData {
  return {
    prices: [...data.prices, candle.close],
    highs: [...data.highs, candle.high],
    lows: [...data.lows, candle.low],
    timestamps: [...data.timestamps, candle.timestamp],
  };
}

// Box-Muller transform for Gaussian random numbers
function gaussianRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
