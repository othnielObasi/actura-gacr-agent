# Actura — Tuning Changelog & Post-Hackathon Roadmap

## Current Changes (April 1, 2026)

### What Changed and Why

| Parameter | Before | After | File | Reason |
|-----------|--------|-------|------|--------|
| Cycle interval | 5 min (300,000 ms) | 2 min (120,000 ms) | `src/agent/config.ts` | More signal checks per day (288 → 720). Agent was missing opportunities between cycles. |
| Max open positions | 2 | 4 | `src/agent/index.ts` | Agent was stuck idle for hours at 2/2 positions. 4 allows layering while keeping total exposure under 6% of capital. |
| Max hold duration | 6 hours | 4 hours | `src/risk/engine.ts` | Positions sitting at breakeven were blocking new entries. 4h is long enough for most take-profits, short enough to free capital. |
| PRISM modifier | ±15% (symmetric) | 0 to +15% (confirmation-only) | `src/data/prism-feed.ts` | PRISM was killing valid trades when it disagreed with the primary strategy (e.g. cycle 517: SHORT blocked by bullish PRISM). Now it only boosts, never penalizes. |

### Existing Parameters (Unchanged)

| Parameter | Value | File | Notes |
|-----------|-------|------|-------|
| Base position size | 10% of capital | `src/agent/config.ts` | ~$1,000 per position at $10K equity |
| Max position size | 10% of capital | `src/agent/config.ts` | Capped at base (volatility scaling can reduce, never increase) |
| Stop-loss ATR multiple | 1.365x | `src/agent/config.ts` | ~$45 below entry at current ATR |
| Take-profit ATR multiple | 1.365x | `src/agent/config.ts` | ~$45 above entry |
| Circuit breaker drawdown | 8% | `src/agent/config.ts` | Halts all trading if equity drops 8% from peak |
| Max daily loss | 2% | `src/agent/config.ts` | Daily PnL cap |
| SMA fast period | 20 | `src/agent/config.ts` | Short-term moving average |
| SMA slow period | 50 | `src/agent/config.ts` | Long-term moving average |
| Baseline volatility | 0.02 (2%) | `src/agent/config.ts` | Reference for volatility ratio |
| EWMA span | 20 | `src/agent/config.ts` | Exponential weighted volatility lookback |
| ATR period | 14 | `src/agent/config.ts` | Average True Range lookback |
| Confidence threshold | 0.08 | Regime governance | Minimum confidence to trade (regime-dependent) |
| Edge filter cost | 5 bps | `src/strategy/signals.ts` | Minimum expected edge above execution cost |
| Sentiment weight (Fear & Greed) | 40% | `src/data/sentiment-feed.ts` | Largest sentiment component |
| Sentiment weight (News) | 35% | `src/data/sentiment-feed.ts` | Alpha Vantage news sentiment |
| Sentiment weight (Funding) | 25% | `src/data/sentiment-feed.ts` | Kraken funding rate proxy |
| PRISM signal cache TTL | 3 min | `src/data/prism-feed.ts` | Avoids excessive API calls |
| PRISM risk cache TTL | 10 min | `src/data/prism-feed.ts` | Risk metrics change slowly |
| Regime governance defensive lock | 6% drawdown | `src/strategy/regime-governance.ts` | Switches to defensive profile |

### Revert Instructions

If these changes perform worse, revert with env vars on VPS (no code change needed):

```bash
# On VPS: /opt/actura/.env
TRADING_INTERVAL_MS=300000   # Back to 5 min
MAX_HOLD_HOURS=6             # Back to 6 hours
```

For MAX_OPEN_POSITIONS, change line 60 in `src/agent/index.ts`:
```typescript
const MAX_OPEN_POSITIONS = 2;  // Revert from 4
```

---

## Post-Hackathon Implementation Plan

### Phase 1: Backtesting Engine (Week 1-2)

**Goal:** Validate strategies against historical data before live deployment.

- Build historical data pipeline: fetch 2+ years of ETH OHLCV from CoinGecko/Kraken
- Create backtesting harness that replays candles through `generateSignal()` + `RiskEngine`
- Metrics output: Sharpe, Sortino, max drawdown, profit factor, win rate per strategy
- Walk-forward validation: train on 80% of data, test on 20%, slide window
- Compare SMA crossover vs. PRISM-primary vs. ensemble approaches

### Phase 2: Signal Improvement (Week 3-4)

**Goal:** Move from 18% win rate to 45%+ with validated alpha.

- Test alternative strategies: Bollinger band mean reversion, RSI divergence, volume-weighted momentum
- Multi-timeframe analysis: 1h + 4h + 1d signal confluence
- ML feature engineering: train gradient-boosted model on 50+ features (price, volume, sentiment, funding, on-chain metrics)
- PRISM signal weighting: backtest PRISM accuracy independently, then weight by proven performance
- Proper sentiment integration: backtest Fear & Greed as contrarian indicator vs. momentum indicator

### Phase 3: Multi-Asset + Portfolio (Month 2)

**Goal:** Diversify beyond single ETH/USD pair.

- Add BTC/USD, SOL/USD, ARB/USD pairs
- Portfolio-level risk management: correlation-aware position sizing
- Cross-asset signals: BTC dominance as regime indicator
- Capital allocation: Kelly criterion-based sizing per strategy

### Phase 4: Mainnet + Vault (Month 3)

**Goal:** Accept delegated capital from external users.

- Deploy to Base mainnet (or Arbitrum)
- Implement ERC-4626 vault for capital delegation
- On-chain position tracking (replace simulation mode)
- Real DEX execution via Uniswap V3 / Aerodrome
- Capital Sandbox integration with ERC-8004 Risk Router
- Audit smart contracts

### Phase 5: Production Hardening (Month 4+)

**Goal:** Institutional-grade reliability.

- Multi-region deployment (failover between VPS nodes)
- Real-time monitoring + alerting (PagerDuty/Telegram)
- Automated strategy rotation based on regime detection
- MEV protection (Flashbots / private mempools)
- Slippage optimization with order splitting
- Full regulatory compliance review
