# Actura — Pitch Deck

<p align="center"><strong>The Most Accountable Trading Agent in DeFi</strong></p>

---

## The Problem

Autonomous AI trading agents are becoming more capable every month. They can analyze markets, generate signals, and execute trades faster than any human.

But **capability is not the bottleneck** — **trust is**.

Today's AI trading agents are black boxes. They make decisions no one can audit, control capital with no enforceable limits, and produce no verifiable proof of their reasoning. When they fail, there is no trail. When they succeed, there is no way to verify the process was sound.

**No institution, protocol, or serious capital allocator will delegate funds to an agent they cannot govern, audit, or override.**

---

## The Solution: Actura

Actura is a **governed autonomous trading agent** built on the **Governed Autonomous Capital Runtime (GACR)**.

Every trading decision passes through an 8-stage governance pipeline — from signal to execution — and every decision produces an **immutable, IPFS-pinned artifact** containing the full reasoning chain.

The agent doesn't just trade. It **earns the right to trade** through continuous policy compliance, risk discipline, and trust accumulation.

---

## How It Works

```
Market Signal
  → Sentiment & PRISM Intelligence
    → SAGE Weight Optimization & Playbook Rules
      → Neuro-Symbolic Safety Layer
        → Mandate Enforcement
          → Oracle Integrity Guard
            → Execution Simulation
              → Supervisory Approval
                → Risk Engine (6 checks)
                  → On-Chain Execution + IPFS Artifact
                    → SAGE Reflection (learns from outcome)
```

**Only trades that pass ALL 8 stages execute.** Every rejected trade still produces an artifact explaining why.

---

## Key Differentiators

### 1. Governance-First, Not Profit-First

Most agents optimize for returns. Actura optimizes for **accountable returns**. Every trade must prove it was:
- Within mandate (asset whitelist, capital limits, protocol restrictions)
- Validated by oracle integrity checks (no stale/manipulated data)
- Simulated for slippage, gas, net edge, worst-case
- Approved by the supervisory meta-agent
- Within risk limits (circuit breaker, exposure, position size, volatility)
- Recorded on-chain via ERC-8004

### 2. Neuro-Symbolic Safety Layer

Combines **statistical signal generation** (momentum, SMA crossover, volatility-adjusted sizing) with **explicit symbolic rules**:
- Consecutive loss protection — throttles after loss streaks
- Drawdown recovery mode — reduces exposure until trust rebuilds
- Directional balance — prevents over-concentration in one direction
- Volatility spike caution — reduces during regime transitions

### 3. Trust Policy Scorecard & Capital Ladder

Every action is scored across 4 dimensions:

| Dimension | Weight |
|-----------|--------|
| Policy Compliance | 30% |
| Risk Discipline | 30% |
| Validation Completeness | 20% |
| Outcome Quality | 20% |

Trust score determines capital rights:

| Tier | Score | Capital |
|------|-------|---------|
| Probation | 0–71 | 40% |
| Limited | 72–81 | 70% |
| Standard | 82–89 | 90% |
| Elevated | 90–94 | 100% |
| Elite | 95+ | 100% (12% max) |

The agent **dynamically earns or loses the right to control capital** based on its track record.

### 4. On-Chain Risk Enforcement

`ActuraRiskPolicy.sol` — a Solidity smart contract deployed on Ethereum Sepolia — enforces risk limits **at the contract level**:
- Max position size, total exposure, open positions
- Daily loss circuit breaker
- Max drawdown circuit breaker
- Trade cooldown (anti-churn)
- Asset whitelisting

These limits are **immutable after deployment** — not even the agent can change them.

### 5. PRISM Intelligence Integration

Real-time technical signals via Strykr PRISM API — RSI, MACD, Bollinger Bands, directional bias. Uses a **confirmation-only** model:
- When PRISM agrees with the primary strategy → confidence boost (+0–15%)
- When PRISM disagrees → no penalty (0%)
- Avoids the "two conflicting signals kill every trade" problem

### 6. Complete Audit Trail

Every decision produces an IPFS-pinned JSON artifact containing:
- Trade details (direction, size, stops, take-profit)
- 11 risk checks (pass/fail with reasons)
- Mandate compliance evidence
- Neuro-symbolic rule firings
- Market snapshot (10 price candles, trend strength)
- Confidence intervals (best/worst/max loss)
- AI reasoning narrative (Claude → Gemini → OpenAI failover)
- TEE attestation (code hash, git commit, OS fingerprint)

**Anyone can verify any decision by fetching its IPFS CID.**

### 7. SAGE — Self-Adapting Generative Engine (Self-Improving)

Actura doesn't just trade — it **learns from every trade** using LLM-powered reflection.

**How it works:**
- After every batch of trades, Gemini 2.5 Pro analyzes outcomes: which signals worked, which failed, and why
- The LLM recommends **signal weight adjustments** (7 weights, each bounded by immutable CAGE limits)
- It builds a **playbook** of conditional rules: e.g., "reduce confidence for SHORT trades in LOW volatility regimes when RSI > 60"
- Accumulated wisdom is **injected into every AI reasoning prompt**, making the agent progressively smarter

**Safety guarantees:**
- All weight changes bounded by immutable CAGE ranges (cannot exceed pre-set min/max)
- Max 30% change per parameter per reflection cycle
- Playbook rules can only modify confidence — they cannot bypass risk checks or governance
- 3-layer overfitting protection: regime diversity gate, holdout validation, auto-revert on degradation
- LLM failure = no change (deterministic fallback to last known good weights)
- Kill switch: `ACE_ENABLED=false`

**This is what separates Actura from static rule-based agents.** It improves continuously while maintaining every safety guarantee.

---

## Live System

Actura is **live on Ethereum Sepolia** right now:

| Component | Details |
|-----------|--------|
| Agent ID | **18** (Hackathon AgentRegistry) |
| Risk Policy | [`0x054773f3...`](https://sepolia.etherscan.io/address/0x054773f36E142BDCD01aF13d6863f90681eF8009) |
| Dashboard | [http://api.actura.nov-tia.com:3000](http://api.actura.nov-tia.com:3000) |
| Judge Mode | [http://api.actura.nov-tia.com:3000/judge.html](http://api.actura.nov-tia.com:3000/judge.html) |
| MCP Server | `http://api.actura.nov-tia.com:3001/mcp` (12 tools, 8 resources, 4 prompts) |
| Artifacts | [Browse all decisions](http://api.actura.nov-tia.com:3000/api/artifacts) |
| Chain | Ethereum Sepolia (11155111) |

**Current stats (as of April 9, 2026):**
- 890+ trading cycles executed
- 50+ closed trades with full governance artifacts
- 50+ IPFS-pinned decision artifacts
- Trust Score: elite tier — on-chain Validation: 99, Reputation: 99
- Leaderboard: Rank 4/48
- Live Kraken integration (paper + live modes)
- Every decision IPFS-pinned with TEE attestation

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    MARKET INTELLIGENCE                     │
│  CoinGecko · Kraken · PRISM (Strykr) · Sentiment Feed    │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│                    STRATEGY ENGINE                         │
│  SMA Crossover · Momentum · Volatility-Adjusted Sizing    │
│  Regime Governance · Adaptive Learning (bounded)          │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│            SAGE — Self-Adapting Generative Engine             │
│  LLM Reflection · Weight Optimization · Playbook Rules    │
│  Overfitting Guards · Context Injection                   │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│               8-STAGE GOVERNANCE PIPELINE                  │
│  Neuro-Symbolic → Mandate → Oracle → Simulation           │
│  → Supervisory → Risk Engine → Trust Score → On-Chain     │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌───────────────────┐  ┌───────────────────────────────────┐
│  EXECUTION        │  │  TRUST & ACCOUNTABILITY            │
│  Kraken Orders    │  │  IPFS Artifacts · TEE Attestation  │
│  DEX Routing      │  │  ERC-8004 Registry · Reputation    │
│  On-Chain Records │  │  Trust Scorecard · Capital Ladder   │
└───────────────────┘  └───────────────────────────────────┘
```

---

## ERC-8004 Alignment

Actura integrates with the ERC-8004 Trustless Agent standard:

| Registry | Purpose |
|----------|---------|
| **Identity** | Agent registration, metadata, wallet verification |
| **Reputation** | On-chain performance feedback with tagged scores |
| **Validation** | Validation request/response artifacts |

Every trade publishes a signed `TradeIntent` (EIP-712), verified via EIP-1271 (supports both EOA and smart-contract wallets).

---

## MCP Protocol

Actura exposes a full **Model Context Protocol** surface for agent-to-agent interoperability:

- **12 tools** — market state, trust state, trade proposals, operator controls
- **8 resources** — trust, market, mandate, ERC-8004, risk, operator, performance, adaptive state
- **4 prompts** — explain current trade, risk summary, incident report, audit readiness
- **Visibility tiers** — public, restricted, operator-only

External agents can query Actura's governance state, propose trades through its pipeline, or audit its decisions — all without bypassing the runtime.

---

## Target Prize Lanes

| Lane | Fit |
|------|-----|
| **Best Trustless Trading Agent** | Full ERC-8004 integration, live trading, governance pipeline, SAGE self-improving engine |
| **Best Validation & Trust Model** | Four-dimensional trust scoring, capital ladder, IPFS artifacts, TEE attestation, on-chain validation score 99, reputation 99 |
| **Best Compliance & Risk Guardrails** | On-chain risk contract, 11 risk checks, circuit breaker, mandate enforcement, SAGE overfitting protections |

---

## Team

**Sovereign AI Lab** — building autonomous agent infrastructure for open capital markets.

---

## The Tagline

> *"Not the smartest trader. The most accountable — and getting smarter every cycle."*

Actura proves that autonomous agents can be powerful AND governed. Every decision is transparent. Every trade is justified. Every artifact is permanent. And every outcome makes the next decision better.

**The future of autonomous finance isn't uncontrolled AI — it's governed AI that earns trust and learns responsibly.**
