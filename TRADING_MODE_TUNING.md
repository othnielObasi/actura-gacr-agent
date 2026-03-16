# Actura — Trading Mode Tuning Guide

> This document defines the correct parameter settings for **sandbox (paper trading)**
> vs **live trading** environments. The governance architecture (9-gate pipeline, trust
> scorecard, circuit breaker, IPFS audit trail) remains identical in both modes —
> only cost/edge thresholds change to match the execution environment.

---

## Parameter Comparison

| Parameter | File | Sandbox (Paper) | Live Trading | Rationale |
|-----------|------|:---:|:---:|-----------|
| `costBps` | `src/strategy/signals.ts` | **10** | **20–25** | Paper trading has no real execution cost. Live must account for DEX fees, slippage, gas, and MEV exposure on Base/Ethereum. |
| `minEdgeMultiple` | `src/strategy/edge-filter.ts` | **1.2** | **1.5** | Sandbox can accept tighter edge-to-cost ratios since costs are simulated. Live needs 1.5× margin because edge estimates are noisy and real costs can spike. |
| `net_edge floor` | `src/chain/execution-simulator.ts` | **0.0015 (0.15%)** | **0.003 (0.3%)** | The 0.3% floor protects against model error in live markets. In sandbox, 0.15% still requires positive expected edge while allowing more trades. |
| `net_edge multiplier` | `src/chain/execution-simulator.ts` | **1.5× totalCost** | **2× totalCost** | Live needs wider safety margin over costs. Sandbox can be tighter since costs are fictional. |
| `baseBps` (exec sim) | `src/chain/execution-simulator.ts` | **5** | **8** | Base DEX fee estimate. Paper trading has no real fee; 5bps is conservative for simulation. Live should use 8+ to reflect real Uniswap v3 fees. |
| `Claude model` | `src/strategy/ai-reasoning.ts` | `claude-sonnet-4-20250514` | `claude-sonnet-4-20250514` | Verify model name matches Anthropic API access. Current 400 errors suggest key/model mismatch. |

---

## What NEVER Changes Between Modes

These governance and risk controls remain identical regardless of trading mode:

### 9-Gate Pipeline
1. Signal generation (SMA crossover, momentum scorecard)
2. Risk engine (6 checks: circuit breaker, signal quality, max position size, total exposure, volatility regime, position conflict)
3. Neuro-symbolic reasoning (safety overrides)
4. Regime governance (bounded confidence by volatility profile)
5. Supervisory meta-agent (trust-aware capital steward)
6. Execution simulation (slippage model, cost model)
7. Agent mandate (asset/protocol/capital permissions)
8. Trust scorecard (4 dimensions, 5 tiers, recovery mode)
9. IPFS artifact recording (immutable audit trail)

### Risk Management
- **Circuit breaker**: Daily loss limit -2%, max drawdown -8%
- **Position limits**: Max 2 open positions
- **Max hold duration**: 4 hours (auto-close stale positions)
- **Volatility regime gating**: Block trades in extreme volatility
- **Take-profit**: Auto-exit at 3% unrealized gain
- **Stop-loss**: ATR-based trailing stops

### Trust & Accountability
- Trust scorecard dimensions and tier boundaries
- IPFS artifact structure and upload
- On-chain risk policy (ActuraRiskPolicy contract)
- ERC-8004 identity/reputation/validation registries
- Adaptive learning with immutable cage bounds

---

## Switching Between Modes

### To Sandbox Mode
Set environment variables (or use code defaults as tuned):
```bash
# These are reflected in code defaults after sandbox tuning
EDGE_COST_BPS=10
EDGE_MIN_MULTIPLE=1.2
SIM_NET_EDGE_FLOOR=0.0015
SIM_NET_EDGE_MULT=1.5
SIM_BASE_BPS=5
```

### To Live Mode
Override with conservative values:
```bash
EDGE_COST_BPS=22
EDGE_MIN_MULTIPLE=1.5
SIM_NET_EDGE_FLOOR=0.003
SIM_NET_EDGE_MULT=2.0
SIM_BASE_BPS=8
```

Additionally for live:
- Verify all API keys are valid and funded
- Reduce `basePositionPct` from 2% to 1% initially
- Tighten circuit breaker daily loss to -1%
- Ensure PRIVATE_KEY wallet has sufficient ETH for gas
- Monitor first 10 trades manually before leaving unattended

---

## Expected Behavior After Sandbox Tuning

| Metric | Before (Live Settings) | After (Sandbox Settings) |
|--------|----------------------|-------------------------|
| Trades per day | 0–1 | 3–10 |
| Signal pass rate | ~5% | ~20–30% |
| Edge filter pass rate | ~2% | ~40% |
| Execution sim pass rate | ~1% | ~50% |
| IPFS artifacts per day | 0–3 | 10–30 |
| Full pipeline demonstrations | Rare | Regular |
| Governance visibility | Minimal | All 9 gates visible |

---

## Audit Note

All parameter changes are:
- **Deterministic** — no randomness introduced
- **Bounded** — all gates still require positive expected edge
- **Reversible** — can switch to live settings via env vars
- **Transparent** — every trade artifact records the thresholds used
- **Governance-preserving** — pipeline structure unchanged

Last updated: 2026-03-16
