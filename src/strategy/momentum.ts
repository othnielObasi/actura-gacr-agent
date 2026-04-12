/**
 * Volatility-Adjusted Momentum Strategy
 * 
 * Deliberately simple. The edge is NOT in alpha generation —
 * it's in risk management and on-chain accountability.
 * 
 * Signal: SMA(20) vs SMA(50) crossover
 * Sizing: Volatility-adjusted position sizing
 * Stops: ATR-based stop-loss
 */

import { sma, ewmaVolatility, atr, rsi, adx, choppinessIndex, zscore, returnOver, autocorrLag1 } from './indicators.js';
import { generateSignal, type TradingSignal, type SignalInput } from './signals.js';
import { config } from '../agent/config.js';

export interface MarketData {
  prices: number[];      // Close prices (most recent last)
  highs: number[];       // High prices
  lows: number[];        // Low prices
  timestamps: string[];  // ISO timestamps
}

export interface StrategyOutput {
  signal: TradingSignal;
  positionSize: number;     // Size in base asset units
  positionSizeRaw: number;  // Before volatility adjustment
  stopLossPrice: number | null;
  currentPrice: number;
  indicators: {
    smaFast: number | null;
    smaSlow: number | null;
    volatility: number | null;
    atr: number | null;
    rsi: number | null;
    adx: number | null;
    choppiness: number | null;
    zscore: number | null;
    ret5: number | null;
    ret20: number | null;
    autocorr1: number | null;
  };
}

// Store previous SMAs for crossover detection
let prevSmaFast: number | null = null;
let prevSmaSlow: number | null = null;

/**
 * Run the strategy on current market data
 */
export function runStrategy(data: MarketData, capitalUsd: number, sentimentComposite?: number | null): StrategyOutput {
  const { smaFast: fastPeriod, smaSlow: slowPeriod, ewmaSpan, atrPeriod, basePositionPct, stopLossAtrMultiple, baselineVolatility } = config.strategy;
  
  const currentPrice = data.prices[data.prices.length - 1];
  
  // Calculate indicators
  const smaFastValue = sma(data.prices, fastPeriod);
  const smaSlowValue = sma(data.prices, slowPeriod);
  const volatility = ewmaVolatility(data.prices, ewmaSpan);
  const atrValue = atr(data.highs, data.lows, data.prices, atrPeriod);


  const rsiValue = rsi(data.prices, 14);
  const adxValue = adx(data.highs, data.lows, data.prices, 14);
  const chopValue = choppinessIndex(data.highs, data.lows, data.prices, 14);
  const zValue = zscore(data.prices, 20);
  const ret5 = returnOver(data.prices, 5);
  const ret20 = returnOver(data.prices, 20);
  const ac1 = autocorrLag1(data.prices, 30);


  // Generate signal
  const signalInput: SignalInput = {
    smaFast: smaFastValue,
    smaSlow: smaSlowValue,
    prevSmaFast,
    prevSmaSlow,
    volatility,
    baselineVolatility,
    atr: atrValue,
    currentPrice,
    rsi: rsiValue,
    adx: adxValue,
    choppiness: chopValue,
    zscore: zValue,
    ret5,
    ret20,
    autocorr1: ac1,
    sentimentComposite: sentimentComposite ?? null,
  };

  const signal = generateSignal(signalInput);

  // Update previous values for next iteration
  prevSmaFast = smaFastValue;
  prevSmaSlow = smaSlowValue;

  // Calculate position size
  const baseSize = capitalUsd * basePositionPct;
  let adjustedSize = baseSize;

  if (volatility !== null && volatility > 0) {
    // Scale position inversely with volatility
    adjustedSize = baseSize * (baselineVolatility / volatility);
  }

  // Cap at max position
  const maxSize = capitalUsd * config.maxPositionPct;
  adjustedSize = Math.min(adjustedSize, maxSize);

  // Convert to asset units
  const positionSizeRaw = baseSize / currentPrice;
  const positionSize = signal.direction === 'NEUTRAL' ? 0 : adjustedSize / currentPrice;

  // Calculate stop-loss
  // Enforce a minimum stop distance of 1.0% of price to avoid
  // micro-stops in low-volatility (ranging) markets where normal
  // oscillation clips positions before they can develop.
  let stopLossPrice: number | null = null;
  if (atrValue !== null && signal.direction !== 'NEUTRAL') {
    const atrStop = stopLossAtrMultiple * atrValue;
    const minStop = currentPrice * 0.010; // 1.0% floor — survive normal range oscillation
    const stopDistance = Math.max(atrStop, minStop);
    if (signal.direction === 'LONG') {
      stopLossPrice = currentPrice - stopDistance;
    } else {
      stopLossPrice = currentPrice + stopDistance;
    }
  }

  return {
    signal,
    positionSize,
    positionSizeRaw,
    stopLossPrice,
    currentPrice,
    indicators: {
      smaFast: smaFastValue,
      smaSlow: smaSlowValue,
      volatility,
      atr: atrValue,
      rsi: rsiValue,
      adx: adxValue,
      choppiness: chopValue,
      zscore: zValue,
      ret5,
      ret20,
      autocorr1: ac1,
    },
  };
}

/** Reset strategy state (for testing) */
export function resetStrategy(): void {
  prevSmaFast = null;
  prevSmaSlow = null;
}
