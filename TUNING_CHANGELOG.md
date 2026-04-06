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

## ACE Implementation (April 2, 2026)

### ACE — Agentic Context Engineering

Deployed a self-improving adaptive learning layer that uses LLM reflection to auto-tune the trading strategy from observed outcomes.

| Component | Details |
|-----------|--------|
| Engine | `src/strategy/ace-engine.ts` (750+ lines) |
| LLM | Gemini 2.5 Pro for trade batch reflection |
| Kill Switch | `ACE_ENABLED=false` env var |
| Persistence | `.actura/ace-weights.json`, `.actura/playbook.jsonl`, `.actura/ace-reflections.jsonl` |

#### What ACE Does

1. **Records trade outcomes** — After every closed trade, captures the full feature vector (direction, PnL, regime, confidence, ret5, ret20, RSI, ADX, zscore, sentiment)
2. **Runs reflection cycles** — Every ~20 min (10 agent cycles), sends the batch to Gemini 2.5 Pro for analysis
3. **Tunes signal weights** — LLM recommends adjustments to the 7 scorecard weights within immutable CAGE bounds
4. **Builds a playbook** — Creates conditional rules (BLOCK / REDUCE / BOOST confidence) based on pattern analysis
5. **Injects context** — Accumulated trading wisdom is prefixed to every AI reasoning prompt

#### Signal Weights (CAGE-Bounded)

| Weight | Default | Range | Purpose |
|--------|---------|-------|---------|
| trend | 0.60 | 0.0–2.0 | SMA crossover trend strength |
| ret5 | 1.80 | 0.0–4.0 | 5-bar momentum return |
| ret20 | 1.10 | 0.0–3.0 | 20-bar momentum return |
| crossover | 0.15 | 0.0–0.5 | Crossover event boost |
| rsi | 0.60 | 0.0–2.0 | RSI mean-reversion penalty |
| zscore | 0.50 | 0.0–2.0 | Z-score extreme penalty |
| sentiment | 0.12 | 0.0–0.5 | Sentiment composite weight |

Max change per reflection cycle: 30% of current value.

#### Overfitting Protections (3 Layers)

1. **Regime diversity gate** — Requires trades from 2+ market regimes (or 10+ total) before allowing weight changes. Prevents fitting to a single market condition.
2. **Holdout validation** — 80/20 train/holdout split. LLM only sees 80% of outcomes. Weight changes are validated against the holdout set and rejected if they would degrade performance.
3. **Auto-revert** — Monitors post-reflection performance. If win rate drops >15 percentage points after 5 trades, weights automatically revert to the pre-reflection snapshot. After 10 trades without degradation, the new weights are accepted.

#### Integration Points

| Where | What |
|-------|------|
| `src/strategy/signals.ts` | Weights from `getACEWeights()`, playbook rules from `applyPlaybookRules()` |
| `src/agent/index.ts` | `initACE()` on startup, `recordACEOutcome()` on trade close, `runACEReflection()` every 10 cycles |
| `src/strategy/ai-reasoning.ts` | `getACEContextPrefix()` injected into reasoning prompt |
| `src/dashboard/server.ts` | `/api/ace/status` and `/api/ace/playbook` endpoints |
| `judge.html` | Section 7: ACE dashboard with weights, reflections, rules |
| `ActuraDashboard.final.jsx` | ACE panel with live status, weights diff, wisdom display |

#### Rollback

```bash
# Disable ACE without code change:
ACE_ENABLED=false pm2 restart actura-agent

# Full code rollback to pre-ACE:
git checkout 7fcaa55 -- src/strategy/signals.ts src/agent/index.ts src/strategy/ai-reasoning.ts src/dashboard/server.ts
git checkout 7fcaa55 -- src/dashboard/public/judge.html src/dashboard/ActuraDashboard.final.jsx
rm src/strategy/ace-engine.ts
npm run build && pm2 restart actura-agent
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
