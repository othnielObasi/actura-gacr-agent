<p align="center">
  <h1 align="center">Actura</h1>
  <p align="center"><strong>Governed Autonomous Capital Runtime — ERC-8004 Trustless Trading Agent</strong></p>
  <p align="center">
    <a href="#quickstart">Quickstart</a> &bull;
    <a href="#architecture">Architecture</a> &bull;
    <a href="#features">Features</a> &bull;
    <a href="#api-reference">API</a> &bull;
    <a href="#testing">Testing</a> &bull;
    <a href="#deployment">Deployment</a>
  </p>
</p>

---

## Overview

Actura is an **accountable autonomous trading agent** built on the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Trustless Agent standard. It operates inside the **Governed Autonomous Capital Runtime (GACR)** — a governance-first operating environment where autonomous agents must continuously **earn the right to control capital** through policy compliance, risk discipline, validation completeness, and acceptable execution outcomes.

Unlike conventional trading bots, Actura produces a **complete audit trail** for every decision — from market signal to on-chain execution — and publishes immutable validation artifacts to IPFS. Every trade is scored across four trust dimensions, and the agent’s capital rights evolve dynamically based on its track record.

### Key Differentiators

| Capability | Description |
|---|---|
| **Governance-first execution** | Every trade passes through mandate enforcement, oracle integrity checks, execution simulation, and supervisory approval before execution |
| **Neuro-symbolic safety layer** | Combines statistical signal generation with explicit symbolic controls (consecutive loss protection, drawdown recovery, volatility spike caution) |
| **Trust Policy Scorecard** | Four-dimensional trust scoring: Policy Compliance, Risk Discipline, Validation Completeness, Outcome Quality |
| **Capital Trust Ladder** | Dynamic capital allocation based on earned trust tier (probation → limited → standard → elevated → elite) |
| **On-chain risk enforcement** | Solidity smart contract (`ActuraRiskPolicy.sol`) enforces risk limits trustlessly at the contract level |
| **EIP-1271 signature verification** | Smart-contract wallet signature support — every signed TradeIntent is verified via EIP-1271 (auto-detects EOA vs contract wallets) before Risk Router submission |
| **TEE attestation** | Software-based Trusted Execution Environment attestation — every artifact includes a signed attestation binding agent identity to runtime environment (code hash, git commit, OS fingerprint) |
| **Full audit trail** | Every decision produces an IPFS-pinned JSON artifact with AI reasoning, market snapshots, confidence intervals, governance evidence, and TEE attestation. Artifacts are also saved locally to `./artifacts/` for re-pinning resilience |
| **PRISM Intelligence** | Real-time technical signal integration via Strykr PRISM API — RSI, MACD, Bollinger Bands, directional bias. Confirmation-only confidence modifier (+0–15%) — boosts when PRISM agrees with the primary strategy, never penalizes |
| **AI Reasoning (3-tier LLM)** | Every trade decision includes a natural-language AI explanation generated via Claude → Gemini → OpenAI failover chain. Summaries are embedded in IPFS artifacts |
| **ACE/SAGE — Agentic Context Engineering** | LLM-powered self-improving layer: Gemini 2.5 Pro reflects on trade outcomes, auto-tunes 7 signal weights within CAGE bounds, builds conditional playbook rules, and injects accumulated wisdom into AI reasoning. 3-layer overfitting protection: regime diversity gate, holdout validation, auto-revert |
| **Sentiment-driven signals** | Multi-source sentiment scoring — Fear & Greed Index (40%), Alpha Vantage news (35%), Kraken funding rate proxy (25%) — adjusts confidence and position sizing |
| **Kraken Challenge integration** | Full live/paper trading via Kraken CLI bridge — governed strategy → Kraken orders with stop-losses, TP targets, and ERC-8004 artifact preservation |
| **Profit-locking trailing stops** | Tiered breakeven mechanism: >0.5% profit → 95% trail, >0.8% → 50% trail, >1.5% → 30% trail. Stops only ratchet tighter, never widen |
| **Dynamic ATR take-profit** | Regime-aware TP targets: LOW=1.0×, NORMAL=1.2×, HIGH=1.5×, EXTREME=2.0× ATR. Retroactive TP assignment on restart for legacy positions |
| **Regime Governance** | Deterministic volatility-regime profile switching with Bayesian confidence bias and hysteresis-based transitions |
| **DEX routing** | Multi-DEX routing engine (Uniswap V3, Aerodrome) — compares fees, slippage, and liquidity to select optimal route |
| **On-chain event indexer** | Real-time polling of ERC-8004 registry events (reputation, validation) for chain-state awareness |
| **Performance Analytics** | Risk-adjusted metrics (Sharpe, Sortino, max drawdown, Calmar ratio, profit factor) computed in real time |
| **MCP protocol server** | Exposes 12 tools, 8 resources, and 4 prompts via the Model Context Protocol with visibility-tiered access control |

---

## Live Deployment & Public Verification

Actura is **live on Ethereum Sepolia** with verifiable on-chain state:

| What | Address / Link |
|---|---|
| **Agent ID** | **18** (Hackathon AgentRegistry) |
| **AgentRegistry** | [`0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3`](https://sepolia.etherscan.io/address/0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3) |
| **ActuraRiskPolicy** | [`0x054773f36E142BDCD01aF13d6863f90681eF8009`](https://sepolia.etherscan.io/address/0x054773f36E142BDCD01aF13d6863f90681eF8009) |
| **RiskRouter** | [`0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC`](https://sepolia.etherscan.io/address/0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC) |
| **ValidationRegistry** | [`0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1`](https://sepolia.etherscan.io/address/0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1) |
| **ReputationRegistry** | [`0x423a9904e39537a9997fbaF0f220d79D7d545763`](https://sepolia.etherscan.io/address/0x423a9904e39537a9997fbaF0f220d79D7d545763) |
| **Owner Wallet** | [`0xE8684cfb...DdCD7`](https://sepolia.etherscan.io/address/0xE8684cfbA08541C607898E55BAB58302204DdCD7) |
| **Live Dashboard** | [http://api.actura.nov-tia.com:3000](http://api.actura.nov-tia.com:3000) |
| **Judge Mode** | [http://api.actura.nov-tia.com:3000/judge.html](http://api.actura.nov-tia.com:3000/judge.html) |
| **MCP Endpoint** | `http://api.actura.nov-tia.com:3001/mcp` (JSON-RPC) |

**Current live stats (as of April 10, 2026):**
- **2,730+ trading cycles** executed continuously since March 2026
- **153 closed trades** with full governance artifacts
- **153 IPFS-pinned** decision artifacts (zero mock CIDs)
- Trust Score: **elite** tier (95+)
- On-chain Validation Score: **99**, Reputation Score: **99**
- Leaderboard: **Rank 1/51**
- Win rate: **52%** | Sharpe: −0.16 | Max drawdown: 0.39%
- Live Kraken integration (paper + live modes)
- Every decision IPFS-pinned with TEE attestation

### Decision Audit Trail (Public)

Every trading decision produces an immutable IPFS artifact containing the full reasoning chain — signal, risk checks, mandate compliance, neuro-symbolic adjustments, market snapshot, confidence intervals, and AI narrative.

| Endpoint | Description |
|---|---|
| [`/api/artifacts`](http://api.actura.nov-tia.com:3000/api/artifacts) | Browse all decision artifacts with IPFS CIDs |
| [`/api/artifact/latest`](http://api.actura.nov-tia.com:3000/api/artifact/latest) | Full JSON of the most recent decision |
| [`/api/checkpoints`](http://api.actura.nov-tia.com:3000/api/checkpoints) | Recent trade checkpoints with signals, confidence, IPFS links |

**Example artifact on IPFS** (anyone can view, no keys needed):
[`QmUVE9Px5Z58HEi8wSp8i6ZriA1rg4aQxPeDZRSq1hFaw5`](https://aqua-advisory-vicuna-831.mypinata.cloud/ipfs/QmUVE9Px5Z58HEi8wSp8i6ZriA1rg4aQxPeDZRSq1hFaw5)

Each artifact records: trade details, 11 risk checks (pass/fail), mandate evidence, neuro-symbolic rule firings, market snapshot (10 price candles, trend strength), confidence interval (best/worst/max loss), and a natural-language AI reasoning summary.

---

## Quickstart

### Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- A wallet private key (for on-chain operations)
- [Pinata](https://app.pinata.cloud) JWT (optional, for IPFS artifact pinning)

### Installation

```bash
git clone https://github.com/othnielObasi/actura-gacr-agent.git
cd actura-gacr-agent
npm install
```

### Configuration

Copy the environment template and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description | Default |
|---|---|---|
| `PRIVATE_KEY` | Wallet private key (never commit) | — |
| `RPC_URL` | JSON-RPC endpoint | `https://ethereum-sepolia-rpc.publicnode.com` |
| `CHAIN_ID` | Target chain ID | `11155111` (Ethereum Sepolia) |
| `PINATA_JWT` | Pinata API key for IPFS | — (mock mode if empty) |
| `MODE` | `simulation` or `live` | `simulation` |

See [`.env.example`](.env.example) for the full list of configurable parameters including risk limits, mandate settings, and registry addresses.

### Run

```bash
# Simulation mode (default) — runs 50 trading cycles with synthetic data
npm run dev

# Live mode — connects to Ethereum Sepolia, real execution
MODE=live npm run dev

# Dashboard only
npm run dashboard

# MCP Server (port 3001)
npm run mcp

# Run all tests
npm test
```

---

## Architecture

```
Market Data (CoinGecko / Kraken / DEX)
        │
        ├──────────────────────────────┐
        ▼                              ▼
┌─────────────────────────┐  ┌──────────────────────┐
│   PRICE FEED LAYER      │  │   SENTIMENT FEED     │
│  CoinGecko · Kraken     │  │  Fear & Greed Index  │
│  Live / Simulation      │  │  Alpha Vantage News  │
└───────────┬─────────────┘  │  Kraken Funding Rate │
            │                │  PRISM (Strykr) API  │
            │                └──────────┬───────────┘
            ▼                           │
┌─────────────────────────────────────────────────┐
│           STRUCTURE & REGIME DETECTION           │
│  Volatility Classification · Trend Detection     │
│  Market State Aggregation · Sentiment Scoring    │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│            STRATEGY ENGINE                       │
│  SMA Crossover · Momentum Signals                │
│  Volatility-Adjusted Sizing · ATR Stops          │
│  Edge Filter · Confidence Scoring                │
│  Sentiment-Adjusted Confidence                   │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│         NEURO-SYMBOLIC REASONING                 │
│  Consecutive Loss Protection                     │
│  Drawdown Recovery Mode                          │
│  Directional Balance · Mean Reversion            │
│  Volatility Spike Caution                        │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│          MANDATE ENFORCEMENT                     │
│  Asset & Protocol Whitelisting                   │
│  Capital Limits · Human Approval Thresholds      │
│  Daily Loss Budget · Trade Size Caps             │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│         ORACLE INTEGRITY GUARD                   │
│  Median Deviation Check                          │
│  External Price Comparison                       │
│  Single-Bar & Multi-Bar Anomaly Detection        │
│  Stale Feed Detection                            │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│        EXECUTION SIMULATOR                       │
│  Slippage Estimation · Gas Cost Model            │
│  Net Edge Calculation · Price Impact             │
│  Worst-Case Analysis                             │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│      SUPERVISORY META-AGENT                      │
│  Trust-Aware Capital Steward                     │
│  Dynamic Position Throttling                     │
│  Drawdown-Sensitive Pause Logic                  │
│  Operator Emergency Controls                     │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│       RISK ENGINE (6 Checks)                     │
│  Circuit Breaker · Signal Quality                │
│  Position Size · Total Exposure                  │
│  Volatility Regime · Position Conflict           │
│  Profit-Locking Trailing Stops · ATR Take-Profit │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        ▼          │          ▼
   ┌──────────┐    │   ┌──────────────┐
   │ EXECUTE  │    │   │   ARTIFACT   │
   │ Kraken   │    │   │   EMITTER    │
   │ CLI/API  │    │   │ Trust Score  │
   │ (live/   │    │   │ IPFS Upload  │
   │  paper)  │    │   │ TEE Attest.  │
   └──────────┘    │   └──────┬───────┘
                   │          │
                   ▼          ▼
          ┌──────────────────────────┐
          │  ON-CHAIN EXECUTION      │
          │  EIP-712 Sign Intent     │
          │  EIP-1271 Verification   │
          │  Risk Router Submission  │
          │  Validation Registry     │
          │  Reputation Feedback     │
          └──────────┬───────────────┘
                     │
                     ▼
           ┌──────────────────┐
           │ TRUST SCORECARD  │
           │ Reputation Evo.  │
           │ Capital Ladder   │
           │ Recovery Mode    │
           │ Event Indexer    │
           └──────────────────┘
```

### Project Structure

```
actura-gacr-agent/
├── contracts/
│   └── ActuraRiskPolicy.sol          # On-chain risk enforcement (Solidity)
├── scripts/
│   ├── bootstrap-erc8004.ts          # One-command ERC-8004 setup
│   ├── demo-onchain-path.ts          # End-to-end demo walkthrough
│   ├── deploy-risk-policy.ts         # Deploy ActuraRiskPolicy contract
│   ├── generate-registration.ts      # Spec-compliant registration JSON
│   ├── register-agent.ts             # Agent identity registration
│   └── kraken-cli-wrapper.py         # Python Kraken CLI wrapper
├── src/
│   ├── agent/
│   │   ├── index.ts                  # Main agent loop & entry point
│   │   ├── config.ts                 # Environment & runtime configuration
│   │   ├── logger.ts                 # Structured logging with levels
│   │   ├── operator-control.ts       # Human oversight (pause/resume/stop)
│   │   ├── retry.ts                  # Exponential backoff retry logic
│   │   ├── scheduler.ts             # Cron-based cycle scheduling
│   │   ├── state.ts                  # Persistent state (survives restarts)
│   │   ├── supervisory-meta-agent.ts # Trust-aware capital steward
│   │   ├── trade-log.ts             # Structured trade history logging
│   │   └── validator.ts              # Config validation at startup
│   ├── analytics/
│   │   └── performance-metrics.ts    # Sharpe, Sortino, max drawdown, Calmar, profit factor
│   ├── chain/
│   │   ├── agent-mandate.ts          # Mandate enforcement engine
│   │   ├── dex-router.ts            # Multi-DEX routing (Uniswap V3, Aerodrome)
│   │   ├── eip1271.ts               # EIP-1271 smart-contract signature verification
│   │   ├── event-indexer.ts         # On-chain event indexer (reputation, validation)
│   │   ├── execution-simulator.ts    # Pre-trade simulation & cost analysis
│   │   ├── executor.ts               # On-chain trade execution flow
│   │   ├── feedback-auth.ts          # Reputation feedback authorization
│   │   ├── identity.ts               # ERC-8004 identity registration
│   │   ├── intent.ts                 # EIP-712 signed trade intents
│   │   ├── reputation.ts             # On-chain reputation submission
│   │   ├── risk-policy-client.ts    # On-chain risk policy contract client
│   │   ├── risk-router.ts            # Hackathon Risk Router integration
│   │   ├── sdk.ts                    # Ethers.js provider & wallet setup
│   │   └── validation.ts             # On-chain validation artifacts
│   ├── dashboard/
│   │   ├── server.ts                 # Express dashboard & REST API
│   │   └── public/
│   │       ├── index.html            # Web UI with live charts
│   │       ├── trades.html           # Trade history view
│   │       └── judge.html            # Hackathon judge evaluation view
│   ├── data/
│   │   ├── kraken-bridge.ts         # Governed trade → Kraken order bridge
│   │   ├── kraken-cli.ts           # Kraken CLI wrapper (order placement)
│   │   ├── kraken-feed.ts          # Kraken market data (ticker, balance, orders)
│   │   ├── live-price-feed.ts      # Live CoinGecko/Kraken price feed
│   │   ├── market-state.ts          # Market state aggregation
│   │   ├── price-feed.ts            # Price feed (simulated / live)
│   │   ├── prism-feed.ts           # PRISM (Strykr) technical signal & risk feed
│   │   └── sentiment-feed.ts       # Multi-source sentiment aggregator
│   ├── mcp/
│   │   ├── server.ts                 # MCP JSON-RPC server with health & discovery
│   │   ├── tools.ts                  # 12 MCP tools (public/restricted/operator)
│   │   ├── resources.ts              # 8 MCP resources (trust, market, mandate, etc.)
│   │   └── prompts.ts                # 4 MCP prompts (explain, summarize, report, audit)
│   ├── risk/
│   │   ├── engine.ts                 # Risk engine (6 checks, trailing stops, ATR TP)
│   │   ├── circuit-breaker.ts        # State machine: ARMED → TRIPPED → COOLING
│   │   └── volatility.ts             # EWMA volatility with regime detection
│   ├── security/
│   │   ├── oracle-integrity.ts       # Oracle manipulation detection
│   │   └── tee-attestation.ts       # Software-based TEE attestation
│   ├── social/
│   │   └── share.ts                 # Social proof & sharing
│   ├── strategy/
│   │   ├── ace-engine.ts             # SAGE: LLM-powered adaptive learning (reflection, playbook, weights)
│   │   ├── adaptive-learning.ts      # Bounded self-improvement with Bayesian context bias
│   │   ├── ai-reasoning.ts           # AI-powered trade explanations (Claude/Gemini/OpenAI)
│   │   ├── edge-filter.ts            # Minimum edge threshold filter
│   │   ├── indicators.ts             # SMA, EMA, EWMA, RSI, ATR
│   │   ├── momentum.ts               # Core volatility-adjusted momentum strategy
│   │   ├── neuro-symbolic.ts         # Symbolic rule engine over signals
│   │   ├── regime-governance.ts      # Deterministic regime profile switching with hysteresis
│   │   ├── signals.ts                # Signal generation & classification
│   │   └── structure-regime.ts       # Market structure & regime detection
│   └── trust/
│       ├── artifact-emitter.ts       # Validation artifact builder (incl. TEE attestation)
│       ├── checkpoint.ts             # Strategy checkpoints & replay
│       ├── ipfs.ts                   # IPFS upload via Pinata + local backup
│       ├── reputation-evolution.ts   # Trust tier evolution & regime-aware recovery
│       └── trust-policy-scorecard.ts # Four-dimensional trust scoring
└── test/                             # Comprehensive test suite (24 test files)
```

---

## Features

### 1. Governance-First Trading Runtime

Every trade must pass through a multi-stage validation pipeline before execution:

| Stage | Module | Purpose |
|---|---|---|
| Signal Generation | `strategy/momentum.ts` | SMA crossover with volatility-adjusted sizing |
| Symbolic Reasoning | `strategy/neuro-symbolic.ts` | Rule-based overrides (loss streaks, drawdown, balance) |
| Regime Governance | `strategy/regime-governance.ts` | Deterministic profile switching with Bayesian confidence bias |
| Mandate Enforcement | `chain/agent-mandate.ts` | Asset/protocol whitelisting, capital limits, human approval thresholds |
| Oracle Integrity | `security/oracle-integrity.ts` | Median deviation, stale feed, single-bar anomaly detection |
| Execution Simulation | `chain/execution-simulator.ts` | Slippage, gas, net edge, and worst-case analysis |
| Supervisory Approval | `agent/supervisory-meta-agent.ts` | Trust-aware capital allocation and position throttling |
| Risk Engine | `risk/engine.ts` | 6 risk checks: circuit breaker, signal quality, position size, exposure, volatility, conflict |

### 2. Adaptive Learning with Immutable Boundaries

The agent self-improves within an **immutable cage** — it can adjust parameters but cannot:
- Change its own boundaries
- Disable risk checks
- Expand parameter ranges beyond pre-set limits
- Override symbolic rules

Adjustable parameters (within cage):

| Parameter | Range | Default |
|---|---|---|
| Stop-loss ATR multiple | 1.0 – 2.5 | 1.5 |
| Base position size | 1% – 4% | 2% |
| Confidence threshold | 5% – 30% | 10% |

The adaptive learner also computes a **bounded Bayesian context confidence bias** per regime and direction. This uses a Beta(1,1) posterior mean over observed win rates to adjust confidence — capped at ± 12% — without ever altering stops, sizing, or risk thresholds.

Every adaptation is recorded as an artifact with reasoning and before/after values.

### 3. SAGE — Self-Adapting Generative Engine (formerly ACE)

SAGE is an LLM-powered self-improving layer that sits above adaptive learning, using **Gemini 2.5 Pro** to reflect on trade outcomes and auto-tune the strategy.

**What SAGE produces:**
- **Weight optimization** — Auto-tunes 7 scorecard signal weights within immutable CAGE bounds (max 30% change per cycle)
- **Playbook rules** — Conditional filters (BLOCK / REDUCE / BOOST confidence) based on pattern analysis, with expiry after 30 trades
- **Context injection** — Accumulated trading wisdom prefixed to every AI reasoning prompt
- **Reflection artifacts** — Every reflection cycle is persisted as an auditable JSONL record

**Signal weights managed by SAGE:**

| Weight | Default | CAGE Range |
|---|---|---|
| trend | 0.60 | 0.0 – 2.0 |
| ret5 | 1.80 | 0.0 – 4.0 |
| ret20 | 1.10 | 0.0 – 3.0 |
| crossover | 0.15 | 0.0 – 0.5 |
| rsi | 0.60 | 0.0 – 2.0 |
| zscore | 0.50 | 0.0 – 2.0 |
| sentiment | 0.12 | 0.0 – 0.5 |

**Overfitting protections (3 layers):**
1. **Regime diversity** — Requires outcomes from 2+ market regimes before allowing weight changes
2. **Holdout validation** — 80/20 split; LLM only sees training set; changes rejected if they'd hurt holdout set
3. **Auto-revert** — If win rate drops >15pp post-reflection, weights revert to pre-reflection snapshot

**Kill switch:** `ACE_ENABLED=false` — agent continues with last known good weights, no LLM calls.

**API endpoints:** `/api/sage/status`, `/api/sage/playbook`

### 4. Regime Governance

The **Regime Governance Controller** provides deterministic volatility-regime profile switching with hysteresis:

| Profile | Stop-Loss ATR | Take-Profit ATR | Position Size | Confidence Threshold |
|---|---|---|---|---|
| LOW_VOL | 0.50 | 0.80 | 4.0% | 3% |
| NORMAL | 0.50 | 1.00 | 4.0% | 2% |
| HIGH_VOL | 0.60 | 1.20 | 3.0% | 3% |
| EXTREME_DEFENSIVE | 0.75 | 1.00 | 2.0% | 5% |

Key behaviors:
- **Hysteresis-based transitions** — separate enter/exit thresholds prevent oscillation
- **Defensive-only fast switching** — can always escalate to a more defensive profile, but must hold for `minHoldCycles` (12) before relaxing
- **Drawdown lock** — locks into `EXTREME_DEFENSIVE` when drawdown exceeds 6%
- **Cooldown** — minimum 8 cycles between profile switches
- Every profile switch emits an auditable `ProfileSwitchArtifact`

### 5. Trust Policy Scorecard

Every action is scored across four weighted dimensions:

| Dimension | Weight | Description |
|---|---|---|
| Policy Compliance | 30% | Were all governed checks passed? |
| Risk Discipline | 30% | Was the action appropriate for market and risk state? |
| Validation Completeness | 20% | Were reasoning traces, artifacts, and evidence present? |
| Outcome Quality | 20% | Did execution stay within acceptable quality bounds? |

### 6. Capital Trust Ladder

Trust score determines the agent's capital rights:

| Trust Tier | Score Range | Capital Multiplier | Capital Limit |
|---|---:|---:|---:|
| Probation | 0 – 71 | 0.40x | 3% |
| Limited | 72 – 81 | 0.70x | 6% |
| Standard | 82 – 89 | 0.90x | 8% |
| Elevated | 90 – 94 | 1.00x | 10% |
| Elite | 95+ | 1.00x | 12% |

When trust falls below a threshold, the agent enters **Trust Recovery Mode**:

- **Regime-aware streak requirements** — recovery demands fewer consecutive compliant cycles in stable markets (2 in TRENDING) and more in volatile ones (4 in STRESSED)
- **Graduated deduction** — minor dips reduce the compliance streak by 1 instead of resetting it; only severe regressions (Δ < −5) trigger a full reset
- **Regime-specific tier cap** — during recovery, capital tier is capped at `standard` in TRENDING markets and `limited` in all other regimes

### 7. On-Chain Risk Enforcement

The `ActuraRiskPolicy.sol` smart contract enforces risk limits trustlessly:

- Max position size (% of capital)
- Max total exposure
- Max open positions
- Daily loss circuit breaker
- Max drawdown circuit breaker
- Trade cooldown (anti-churn)
- Asset whitelisting

### 8. Circuit Breaker

Production-grade state machine: **ARMED → TRIPPED → COOLING → ARMED**

- Triggers on daily loss limit breach or max drawdown breach
- Configurable cooldown period before trading resumes
- Conditions must improve before re-arming
- Daily reset at midnight

### 9. Human Oversight Controls

The dashboard exposes operator controls:

| Action | Effect |
|---|---|
| **Pause Trading** | Temporarily halts all trade execution |
| **Resume Trading** | Re-enables trading after pause |
| **Emergency Stop** | Immediately halts all activity (requires manual restart) |

Each operator action creates an auditable receipt with timestamp, reason, actor, and resulting runtime mode.

---

## API Reference

### Dashboard REST API (port 3000)

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | GET | Agent overview (capital, market, risk state) |
| `/api/checkpoints` | GET | Recent decision checkpoints |
| `/api/artifact/latest` | GET | Full validation artifact JSON |
| `/api/positions` | GET | Open positions |
| `/api/governance` | GET | Strategy & risk policy configuration |
| `/api/reputation/history` | GET | Trust score evolution timeline |
| `/api/health` | GET | Health check (200 = healthy, 503 = stopped) |
| `/api/logs` | GET | Recent structured logs |
| `/api/errors` | GET | Error logs |
| `/api/operator/state` | GET | Current operator control state |
| `/api/operator/actions` | GET | Operator action receipt history |
| `/api/operator/pause` | POST | Pause trading |
| `/api/operator/resume` | POST | Resume trading |
| `/api/operator/emergency-stop` | POST | Emergency stop |
| `/api/prism` | GET | PRISM signal & risk data (direction, RSI, MACD, Bollinger, volatility) |
| `/api/performance` | GET | Risk-adjusted metrics (Sharpe, Sortino, max drawdown, Calmar, profit factor) |
| `/api/sage/status` | GET | SAGE engine status: weights, CAGE bounds, reflections, playbook rules |
| `/api/sage/playbook` | GET | Active playbook rules, current weights, reflection count |
| `/api/artifacts` | GET | Browse all decision artifacts with IPFS CIDs |
| `/api/artifact/latest` | GET | Full JSON of the most recent decision artifact |

### MCP Server (port 3001)

Exposes tools, resources, and prompts via the [Model Context Protocol](https://modelcontextprotocol.io) with **visibility-tiered access control**:

**Tools (Public):**

| Tool | Description |
|---|---|
| `get_market_state` | Current market and regime state from the runtime |
| `explain_trade` | Human-readable explanation of the most recent trade decision |
| `get_trust_state` | Trust score, history, and capital-rights state |
| `get_capital_rights` | Capital multiplier and tier based on current trust score |
| `get_performance_metrics` | Risk-adjusted metrics (Sharpe, Sortino, drawdown, Calmar, profit factor) |
| `get_validation_summary` | Recent checkpoint summaries with approval status |
| `get_adaptive_params` | Current adaptive learning parameters and context stats |

**Tools (Restricted):**

| Tool | Description |
|---|---|
| `propose_trade` | Generate a governed trade proposal |
| `execute_trade` | Execute a signed trade intent |

**Tools (Operator):**

| Tool | Description |
|---|---|
| `pause_agent` | Pause trading with reason and actor |
| `resume_agent` | Resume trading after pause |
| `emergency_stop` | Immediately halt all activity |

**Resources:**

| URI | Description |
|---|---|
| `actura://state/trust` | Trust score, timeline, and capital-rights state |
| `actura://state/market` | Live market indicators and pricing |
| `actura://state/mandate` | Capital mandate, allowlists, and governance limits |
| `actura://state/erc8004` | ERC-8004 integration state |
| `actura://state/risk` | Risk engine configuration and status |
| `actura://state/operator` | Operator control state and action receipts |
| `actura://state/performance` | Risk-adjusted performance metrics |
| `actura://state/adaptive` | Adaptive learning parameters and context stats |

**Prompts:**

| Prompt | Visibility | Description |
|---|---|---|
| `explain_current_trade` | public | Human explanation of the latest trade decision |
| `summarize_risk_state` | public | Summary of risk, operator, and trust posture |
| `prepare_operator_incident_report` | operator | Incident report after pause or emergency stop |
| `audit_readiness_report` | operator | Audit readiness summary for compliance review |

**Endpoints:**
- `GET /health` — Service health, version, and surface counts
- `GET /mcp/info` — Full discovery (tools, resources, prompts with visibility)
- `GET /mcp/tools` — List available tools
- `POST /mcp/tools/:toolName` — Execute a tool
- `GET /mcp/resources` — List available resources
- `GET /mcp/resources/:resourceUri` — Read a resource
- `GET /mcp/prompts` — List available prompts
- `POST /mcp/prompts/:promptName` — Execute a prompt
- `POST /mcp` — JSON-RPC endpoint (MCP standard)

---

## ERC-8004 Integration

Actura integrates with the ERC-8004 Trustless Agent standard across hackathon-provided shared registries:

| Registry | Address (Ethereum Sepolia) | Purpose |
|---|---|---|
| AgentRegistry | `0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3` | Agent registration & metadata |
| Reputation | `0x423a9904e39537a9997fbaF0f220d79D7d545763` | On-chain performance feedback |
| Validation | `0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1` | Validation request/response artifacts |
| RiskRouter | `0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC` | Hackathon trade routing |
| HackathonVault | `0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90` | Sandbox capital vault |

### Registration

```bash
# Generate spec-compliant registration JSON
npm run generate:registration

# Bootstrap identity + wallet verification + sandbox claim
npm run bootstrap:erc8004
```

### On-Chain Demo

```bash
# End-to-end execution walkthrough
npm run demo:onchain
```

This runs:
1. Wallet and router preflight checks
2. Optional sandbox capital claim
3. Sample trade generation through strategy + risk engine
4. TradeIntent submission (when `RUN_ONCHAIN_DEMO=true`)

---

## Testing

```bash
# Run all tests
npm test

# Individual test suites
npm run test:strategy     # Strategy & indicators
npm run test:risk         # Risk engine & circuit breaker
npm run test:artifacts    # Validation artifact generation
npm run test:mandate      # Mandate enforcement engine
npm run test:simulation   # Execution simulator
npm run test:oracle       # Oracle integrity guard
npm run test:mcp          # MCP surface tests
```

Full test coverage includes:

| Suite | Covers |
|---|---|
| `test-strategy.ts` | SMA crossover, signal generation, volatility adjustment |
| `test-risk.ts` | Risk engine, circuit breaker, position management |
| `test-artifacts.ts` | Artifact builder, enrichment, governance evidence |
| `test-chain.ts` | Chain SDK, identity registration, intent signing |
| `test-mandate-engine.ts` | Asset/protocol whitelisting, capital limits |
| `test-execution-simulator.ts` | Slippage, gas, net edge calculations |
| `test-oracle-integrity.ts` | Median deviation, stale feeds, anomaly detection |
| `test-trust-scorecard.ts` | Four-dimensional trust scoring |
| `test-reputation-evolution.ts` | Trust tier transitions, capital ladder |
| `test-supervisory-meta-agent.ts` | Supervisory decisions, position throttling |
| `test-operator-control.ts` | Pause/resume/emergency stop receipts |
| `test-trust-recovery-mode.ts` | Recovery mode entry/exit, regime-aware streaks, graduated deduction |
| `test-erc8004-adapters.ts` | ERC-8004 registration & adapter compliance |
| `test-identity-registration.ts` | Identity registry integration |
| `test-reputation-reviewer.ts` | External reputation feedback flow |
| `test-regime-governance.ts` | Regime profile switching, hysteresis, drawdown lock |
| `test-performance-metrics.ts` | Sharpe, Sortino, max drawdown, Calmar, profit factor |
| `test-mcp-surface.ts` | MCP tools, resources, prompts validation |

---

## Deployment

### Simulation Mode (Default)

```bash
npm run dev
```

Runs 50 trading cycles with synthetic Geometric Brownian Motion price data. Prints a full performance summary on completion.

### Live Mode

```bash
# 1. Configure .env with real wallet and RPC
cp .env.hackathon.example .env
# Edit .env with your credentials

# 2. Generate ERC-8004 registration
npm run generate:registration

# 3. Bootstrap on-chain identity
npm run bootstrap:erc8004

# 4. Start in live mode
MODE=live npm run dev
```

### Production Deployment (Vultr VPS)

```bash
# 1. Build and deploy to Vultr
npm run build
rsync -avz --exclude node_modules . root@<your-vultr-ip>:/opt/actura/

# 2. Install dependencies on server
ssh root@<your-vultr-ip> 'cd /opt/actura && npm ci --production'

# 3. Start with PM2
ssh root@<your-vultr-ip> 'cd /opt/actura && pm2 start ecosystem.config.cjs'

# 4. Verify
curl http://<your-vultr-ip>:3000/api/health
```

The Express server serves both the REST API and frontend dashboard on port 3000. The MCP server runs on port 3001.

### Build

```bash
npm run build     # TypeScript → JavaScript (dist/)
npm start         # Run built version
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES2022), TypeScript 5.3+ |
| Execution | [tsx](https://github.com/privatenumber/tsx) for dev, `tsc` for production |
| Blockchain | [ethers.js](https://docs.ethers.org/v6/) v6, EIP-712 typed signing |
| Smart Contract | Solidity ^0.8.20 |
| Dashboard | Express 4.x, vanilla HTML/JS |
| Hosting | [Vultr](https://www.vultr.com) VPS (backend API + frontend dashboard) |
| Process Management | [PM2](https://pm2.keymetrics.io) with ecosystem config |
| AI / LLMs | Claude (primary) → Gemini 2.5 Pro (fallback) → OpenAI (tertiary) |
| Market Data | [CoinGecko](https://www.coingecko.com), [Kraken](https://www.kraken.com), [Strykr PRISM](https://strykr.com) |
| Artifact Storage | IPFS via [Pinata](https://pinata.cloud) |
| Scheduling | [node-cron](https://github.com/node-cron/node-cron) |
| Target Chain | Ethereum Sepolia (Chain ID 11155111) |

---

## Environment Variables

<details>
<summary>Full reference</summary>

| Variable | Description | Default |
|---|---|---|
| `PRIVATE_KEY` | Agent wallet private key | — |
| `RPC_URL` | JSON-RPC endpoint | `https://ethereum-sepolia-rpc.publicnode.com` |
| `CHAIN_ID` | Chain ID | `11155111` |
| `IDENTITY_REGISTRY` | ERC-8004 Identity Registry | `0x7177...Dd09A` |
| `REPUTATION_REGISTRY` | ERC-8004 Reputation Registry | `0x423a...4763` |
| `VALIDATION_REGISTRY` | ERC-8004 Validation Registry | `0x92bF...c2E1` |
| `PINATA_JWT` | Pinata API JWT for IPFS | — |
| `AGENT_NAME` | Agent display name | `Actura` |
| `AGENT_ID` | Registered agent ID | — |
| `RISK_ROUTER_ADDRESS` | Hackathon Risk Router | — |
| `CAPITAL_VAULT_ADDRESS` | Hackathon Capital Vault | — |
| `VALIDATOR_ADDRESS` | Separate validator wallet | — |
| `TRADING_PAIR` | Trading pair | `WETH/USDC` |
| `MAX_POSITION_PCT` | Max position size (%) | `10` |
| `MAX_DAILY_LOSS_PCT` | Daily loss circuit breaker (%) | `2` |
| `MAX_DRAWDOWN_PCT` | Max drawdown circuit breaker (%) | `8` |
| `TRADING_INTERVAL_MS` | Cycle interval (ms) | `120000` |
| `PRISM_API_KEY` | Strykr PRISM API key | — |
| `MAX_HOLD_HOURS` | Max position hold time (hours) | `4` |
| `MODE` | `simulation` or `live` | `simulation` |
| `ALLOWED_ASSETS` | Comma-separated allowed assets | `WETH/USDC,ETH,USDC` |
| `ALLOWED_PROTOCOLS` | Comma-separated allowed protocols | `uniswap` |
| `REQUIRE_HUMAN_APPROVAL_ABOVE_USD` | Auto-approval limit | `20000` |

</details>

---

## Operational Observations & Tuning Log

See [ISSUES_AND_FIXES.md](ISSUES_AND_FIXES.md) for the complete chronological log of all 15 issues discovered and fixed during live operation, with root cause analysis, exact code changes, and lessons learned.

See [OBSERVATIONS.md](OBSERVATIONS.md) for detailed early-stage analysis (execution simulator tuning, restart-induced losses).

See [TUNING_CHANGELOG.md](TUNING_CHANGELOG.md) for parameter tuning history and ACE/SAGE implementation details.

**Key fixes by severity:**

| # | Date | Issue | Severity |
|---|------|-------|----------|
| 9 | Apr 8 | RiskRouter event parsing BUFFER_OVERRUN — `indexed` keyword mismatch | Critical |
| 13 | Apr 8 | Trade history overwritten on every `git pull` | Critical |
| 6 | Mar 31 | 0% win rate — take-profit unreachable in low-vol market | Critical |
| 8 | Mar 31 | Positions stuck — no profit-locking mechanism | Critical |
| 1 | Mar 30 | SHORT-only signal bias in scorecard | Critical |
| 10 | Apr 8 | USD amount calculation $18 instead of $400 | High |
| 11 | Apr 8 | ATR gate blocking 100% of trades | High |
| 12 | Apr 8 | Self-attestation rejected (judge bot takeover) | Medium |
| 14 | Apr 8 | Missing reversal detection in signals | Medium |

**12 lessons learned** documented in [ISSUES_AND_FIXES.md](ISSUES_AND_FIXES.md#full-lessons-learned-updated).

---

## License

MIT © Sovereign AI Lab

---

<p align="center">
  <em>"Not the smartest trader. The most accountable."</em>
</p>
