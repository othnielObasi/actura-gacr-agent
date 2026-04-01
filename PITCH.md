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
    → Neuro-Symbolic Safety Layer
      → Mandate Enforcement
        → Oracle Integrity Guard
          → Execution Simulation
            → Supervisory Approval
              → Risk Engine (6 checks)
                → On-Chain Execution + IPFS Artifact
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

`ActuraRiskPolicy.sol` — a Solidity smart contract deployed on Base Sepolia — enforces risk limits **at the contract level**:
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

---

## Live System

Actura is **live on Base Sepolia** right now:

| Component | Details |
|-----------|---------|
| Agent ID | **338** (ERC-8004 Identity Registry) |
| Risk Policy | [`0x27C9766b...`](https://sepolia.basescan.org/address/0x27C9766b30BAB8b59998f7F3e80E0eb92c8a9AC9) |
| Dashboard | [http://192.248.145.196:3000](http://192.248.145.196:3000) |
| MCP Server | `http://192.248.145.196:3001/mcp` (12 tools, 8 resources, 4 prompts) |
| Artifacts | [Browse all decisions](http://192.248.145.196:3000/api/artifacts) |
| Chain | Base Sepolia (84532) |

**Current stats (as of April 1, 2026):**
- 500+ trading cycles executed
- 13+ closed trades with full governance artifacts
- Every decision IPFS-pinned with TEE attestation
- Live Kraken paper trading integration

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
| **Best Trustless Trading Agent** | Full ERC-8004 integration, live trading, governance pipeline |
| **Best Validation & Trust Model** | Four-dimensional trust scoring, capital ladder, IPFS artifacts, TEE attestation |
| **Best Compliance & Risk Guardrails** | On-chain risk contract, 11 risk checks, circuit breaker, mandate enforcement |

---

## Team

**Sovereign AI Lab** — building autonomous agent infrastructure for open capital markets.

---

## The Tagline

> *"Not the smartest trader. The most accountable."*

Actura proves that autonomous agents can be powerful AND governed. Every decision is transparent. Every trade is justified. Every artifact is permanent.

**The future of autonomous finance isn't uncontrolled AI — it's governed AI that earns trust.**
