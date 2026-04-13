# Actura — Real Trading Roadmap

> From hackathon demo to profitable live trading system.

---

## Current State

- **Strategy**: SMA 20/50 crossover — lagging indicator, 40% win rate across 181 trades
- **Execution**: Simulated fills at mid-price, no slippage or gas accounting
- **Data**: 60-second cycle, single Kraken feed, hourly candles
- **ML/Learning**: LLM-based SAGE reflection (Gemini 2.5 Pro), no real ML
- **Governance**: Trust scoring, IPFS artifacts, capital ladder, on-chain attestation — strong and differentiated

---

## Phase 1 — Backtesting Framework

**Priority: Highest — nothing else matters without this.**

- [ ] Build backtest engine with realistic fill simulation (slippage model, partial fills, latency)
- [ ] Feed historical OHLCV data (1h candles minimum, ideally 1m)
- [ ] Model transaction costs: gas fees (~$0.01–0.05 per Base L2 trade), spread, slippage
- [ ] Implement walk-forward optimization (train on window N, test on window N+1)
- [ ] Require minimum 1,000+ simulated trades for statistical significance
- [ ] Track key metrics: Sharpe ratio, max drawdown, profit factor, win rate, expectancy per trade
- [ ] **Gate**: Do not proceed to Phase 2 until backtest Sharpe > 1.5 after costs

---

## Phase 2 — Strategy Overhaul

### 2a. Regime-Adaptive Strategy Selection

The agent already detects market regimes (NORMAL / TRENDING / VOLATILE) but uses the same SMA strategy in all of them. Different regimes need fundamentally different approaches.

- [ ] **Range-bound / NORMAL regime**: Mean-reversion strategy (Bollinger band bounce, RSI overbought/oversold, z-score reversion)
- [ ] **Trending regime**: Keep momentum/crossover signals but switch to faster EMAs or breakout detection
- [ ] **Volatile regime**: Reduce position size, widen stops, or sit out entirely
- [ ] Route signals through regime detector before strategy selection

### 2b. Signal Quality

- [ ] Replace or supplement SMA 20/50 crossover with faster-reacting signals
- [ ] Add orderbook / microstructure data (bid-ask imbalance, orderflow, liquidation levels)
- [ ] Multi-timeframe confirmation (e.g., 15m trend + 1h structure + 4h bias)
- [ ] Improve the NEUTRAL problem — currently NEUTRAL ~90% of cycles, missing opportunities

### 2c. Stop-Loss & Take-Profit Tuning

- [ ] Widen trailing stop from 0.3× ATR to 1.0–1.5× ATR to avoid noise stop-outs
- [ ] Implement asymmetric R:R targets (e.g., 1:2 risk-reward minimum)
- [ ] Add time-based exits for trades that go nowhere after N candles

---

## Phase 3 — Execution Upgrade

### 3a. Order Types

- [ ] Switch from market orders to **limit orders** placed slightly inside the spread
- [ ] Implement smart order routing — split large orders if needed
- [ ] Add retry logic with price checks for failed/stale fills

### 3b. Cost Accounting

- [ ] Track and deduct actual gas costs per trade
- [ ] Model realistic slippage based on order size vs. available liquidity
- [ ] Set minimum edge threshold: don't trade if expected PnL < estimated costs

### 3c. Latency

- [ ] Reduce cycle time for entry timing (sub-minute price checks even if strategy is hourly)
- [ ] Co-locate or reduce network hops to exchange data sources
- [ ] Add mempool monitoring for on-chain trades (front-running protection)

---

## Phase 4 — Risk Management v2

- [ ] **Dynamic position sizing**: Kelly criterion (or fractional Kelly) based on signal confidence × volatility regime
- [ ] **Correlation-aware limits**: 2 LONGs on WETH is effectively 1 bigger position — cap net directional exposure
- [ ] **Adaptive daily loss limit**: Scale max daily loss based on recent performance (tighter after losses, looser during streaks)
- [ ] **Portfolio-level drawdown**: Track cumulative drawdown across all positions, not just per-trade
- [ ] **Cooldown after consecutive losses**: Reduce size or pause after 3+ consecutive stop-outs

---

## Phase 5 — Data Pipeline

- [ ] **Sub-minute candles** (1s or 5s) for entry/exit timing precision
- [ ] **Multi-exchange feeds**: Aggregate prices from Kraken + Binance + Coinbase to avoid stale/manipulated data
- [ ] **Funding rate streaming**: Real-time funding data for carry trade signals
- [ ] **On-chain data**: Whale wallet movements, DEX volume, bridge flows
- [ ] **News/sentiment pipeline**: Faster ingestion with relevance filtering (current sentiment is lagging)

---

## Phase 6 — Real ML (Replace LLM Learning)

### 6a. Feature Engineering

- [ ] Store full feature vectors for every decision point (not just outcomes):
  - Signal values (trend, ret5, ret20, crossover, RSI, z-score, sentiment)
  - Market context (regime, volatility percentile, ATR, spread)
  - Time features (hour of day, day of week, time since last trade)
  - Outcome label (PnL after N minutes/hours)
- [ ] Minimum 10,000 labeled samples before training

### 6b. Model Selection

- [ ] **Contextual bandit** for signal weight optimization (replacing SAGE LLM reflection)
- [ ] **Gradient-boosted trees** (XGBoost/LightGBM) for trade entry classification
- [ ] **Bayesian optimization** for hyperparameter tuning (stop distance, position size, thresholds)
- [ ] Online learning with rolling retrain window (adapt to regime shifts)

### 6c. Validation

- [ ] Time-series cross-validation (no future leakage)
- [ ] Out-of-sample holdout testing
- [ ] Monitor for model degradation — auto-fallback to rule-based if performance drops

---

## Phase 7 — Paper Trading on Mainnet Fork

**Gate before real capital deployment.**

- [ ] Run full system on mainnet fork for 2+ weeks
- [ ] Verify execution matches backtest expectations (within 10% of simulated metrics)
- [ ] Stress test: simulate flash crashes, exchange outages, gas spikes
- [ ] Confirm circuit breaker and risk limits activate correctly under stress
- [ ] **Gate**: Do not deploy real capital until paper trading Sharpe > 1.0 over 2 weeks

---

## Summary — Priority Order

| # | Phase | Impact | Effort |
|---|-------|--------|--------|
| 1 | Backtesting framework | Validates everything else | Medium |
| 2 | Mean-reversion strategy for range-bound markets | Fixes NEUTRAL ~90% problem | Medium |
| 3 | Limit orders + cost accounting | Saves 5–20 bps per trade | Low |
| 4 | Widen stops to 1–1.5× ATR | Reduces noise stop-outs | Low |
| 5 | Store feature vectors per decision | Enables ML later | Low |
| 6 | Dynamic position sizing (Kelly) | Better capital efficiency | Medium |
| 7 | Sub-minute data + multi-exchange | Better entry timing | High |
| 8 | Real ML models | Adaptive edge | High |
| 9 | Paper trade mainnet fork 2+ weeks | Final validation | Medium |

---

## What's Already Strong (Keep As-Is)

- Trust scoring with 4-dimension weighted model
- IPFS artifact pinning and on-chain attestation
- Capital ladder with tier-based limits
- Circuit breaker and drawdown protection
- SAGE reflection loop (good for hackathon; replace with ML for production)
- Dashboard and MCP server for observability
