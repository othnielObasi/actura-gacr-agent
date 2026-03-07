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
| **Full audit trail** | Every decision produces an IPFS-pinned JSON artifact with AI reasoning, market snapshots, confidence intervals, and governance evidence |
| **MCP protocol server** | Exposes 7 tools and 2 resources via the Model Context Protocol for agent-to-agent interoperability |

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
| `RPC_URL` | JSON-RPC endpoint | `https://sepolia.base.org` |
| `CHAIN_ID` | Target chain ID | `84532` (Base Sepolia) |
| `PINATA_JWT` | Pinata API key for IPFS | — (mock mode if empty) |
| `MODE` | `simulation` or `live` | `simulation` |

See [`.env.example`](.env.example) for the full list of configurable parameters including risk limits, mandate settings, and registry addresses.

### Run

```bash
# Simulation mode (default) — runs 50 trading cycles with synthetic data
npm run dev

# Live mode — connects to Base Sepolia, real execution
MODE=live npm run dev

# Dashboard only
npm run dashboard

# Run all tests
npm test
```

---

## Architecture

```
Market Data (Price Feed / DEX)
        │
        ▼
┌─────────────────────────────────────────────┐
│           STRUCTURE & REGIME DETECTION       │
│  Volatility Classification · Trend Detection │
│  Market State Aggregation                    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│            STRATEGY ENGINE                   │
│  SMA Crossover · Momentum Signals            │
│  Volatility-Adjusted Sizing · ATR Stops      │
│  Edge Filter · Confidence Scoring            │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│         NEURO-SYMBOLIC REASONING             │
│  Consecutive Loss Protection                 │
│  Drawdown Recovery Mode                      │
│  Directional Balance · Mean Reversion        │
│  Volatility Spike Caution                    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│          MANDATE ENFORCEMENT                 │
│  Asset & Protocol Whitelisting               │
│  Capital Limits · Human Approval Thresholds  │
│  Daily Loss Budget · Trade Size Caps         │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│         ORACLE INTEGRITY GUARD               │
│  Median Deviation Check                      │
│  External Price Comparison                   │
│  Single-Bar Anomaly Detection                │
│  Stale Feed Detection                        │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│        EXECUTION SIMULATOR                   │
│  Slippage Estimation · Gas Cost Model        │
│  Net Edge Calculation · Price Impact         │
│  Worst-Case Analysis                         │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│      SUPERVISORY META-AGENT                  │
│  Trust-Aware Capital Steward                 │
│  Dynamic Position Throttling                 │
│  Drawdown-Sensitive Pause Logic              │
│  Operator Emergency Controls                 │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│       RISK ENGINE (6 Checks)                 │
│  Circuit Breaker · Signal Quality            │
│  Position Size · Total Exposure              │
│  Volatility Regime · Position Conflict       │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
   ┌─────────┐       ┌──────────────┐
   │ EXECUTE │       │   ARTIFACT   │
   │ ON-CHAIN│       │   EMITTER    │
   │ (Risk   │       │ Trust Score  │
   │ Router) │       │ IPFS Upload  │
   └─────────┘       └──────┬───────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │ TRUST SCORECARD  │
                  │ Reputation Evo.  │
                  │ Capital Ladder   │
                  │ Recovery Mode    │
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
│   ├── generate-registration.ts      # Spec-compliant registration JSON
│   └── register-agent.ts             # Agent identity registration
├── src/
│   ├── agent/
│   │   ├── index.ts                  # Main agent loop & entry point
│   │   ├── config.ts                 # Environment & runtime configuration
│   │   ├── logger.ts                 # Structured logging with levels
│   │   ├── operator-control.ts       # Human oversight (pause/resume/stop)
│   │   ├── retry.ts                  # Exponential backoff retry logic
│   │   ├── scheduler.ts              # Cron-based cycle scheduling
│   │   ├── state.ts                  # Persistent state (survives restarts)
│   │   ├── supervisory-meta-agent.ts # Trust-aware capital steward
│   │   └── validator.ts              # Config validation at startup
│   ├── chain/
│   │   ├── agent-mandate.ts          # Mandate enforcement engine
│   │   ├── execution-simulator.ts    # Pre-trade simulation & cost analysis
│   │   ├── executor.ts               # On-chain trade execution flow
│   │   ├── feedback-auth.ts          # Reputation feedback authorization
│   │   ├── identity.ts               # ERC-8004 identity registration
│   │   ├── intent.ts                 # EIP-712 signed trade intents
│   │   ├── reputation.ts             # On-chain reputation submission
│   │   ├── risk-router.ts            # Hackathon Risk Router integration
│   │   ├── sdk.ts                    # Ethers.js provider & wallet setup
│   │   └── validation.ts             # On-chain validation artifacts
│   ├── dashboard/
│   │   ├── server.ts                 # Express dashboard & REST API
│   │   └── public/index.html         # Web UI with live charts
│   ├── data/
│   │   ├── market-state.ts           # Market state aggregation
│   │   └── price-feed.ts             # Price feed (simulated / live)
│   ├── mcp/
│   │   ├── server.ts                 # MCP JSON-RPC server
│   │   ├── tools.ts                  # 7 MCP tools for agent interrogation
│   │   └── resources.ts              # 2 MCP resources (market state, policy)
│   ├── risk/
│   │   ├── engine.ts                 # Risk engine (6 checks, trailing stops)
│   │   ├── circuit-breaker.ts        # State machine: ARMED → TRIPPED → COOLING
│   │   └── volatility.ts             # EWMA volatility with regime detection
│   ├── security/
│   │   └── oracle-integrity.ts       # Oracle manipulation detection
│   ├── strategy/
│   │   ├── adaptive-learning.ts      # Bounded self-improvement ("the cage")
│   │   ├── ai-reasoning.ts           # AI-powered trade explanations
│   │   ├── edge-filter.ts            # Minimum edge threshold filter
│   │   ├── indicators.ts             # SMA, EMA, EWMA, RSI, ATR
│   │   ├── momentum.ts               # Core volatility-adjusted momentum strategy
│   │   ├── neuro-symbolic.ts         # Symbolic rule engine over signals
│   │   ├── signals.ts                # Signal generation & classification
│   │   └── structure-regime.ts       # Market structure & regime detection
│   └── trust/
│       ├── artifact-emitter.ts       # Validation artifact builder
│       ├── checkpoint.ts             # Strategy checkpoints & replay
│       ├── ipfs.ts                   # IPFS upload via Pinata
│       ├── reputation-evolution.ts   # Trust tier evolution & recovery mode
│       └── trust-policy-scorecard.ts # Four-dimensional trust scoring
└── test/                             # Comprehensive test suite (16 test files)
```

---

## Features

### 1. Governance-First Trading Runtime

Every trade must pass through a multi-stage validation pipeline before execution:

| Stage | Module | Purpose |
|---|---|---|
| Signal Generation | `strategy/momentum.ts` | SMA crossover with volatility-adjusted sizing |
| Symbolic Reasoning | `strategy/neuro-symbolic.ts` | Rule-based overrides (loss streaks, drawdown, balance) |
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

Every adaptation is recorded as an artifact with reasoning and before/after values.

### 3. Trust Policy Scorecard

Every action is scored across four weighted dimensions:

| Dimension | Weight | Description |
|---|---|---|
| Policy Compliance | 30% | Were all governed checks passed? |
| Risk Discipline | 30% | Was the action appropriate for market and risk state? |
| Validation Completeness | 20% | Were reasoning traces, artifacts, and evidence present? |
| Outcome Quality | 20% | Did execution stay within acceptable quality bounds? |

### 4. Capital Trust Ladder

Trust score determines the agent's capital rights:

| Trust Tier | Score Range | Capital Multiplier | Capital Limit |
|---|---:|---:|---:|
| Probation | 0 – 71 | 0.40x | 3% |
| Limited | 72 – 81 | 0.70x | 6% |
| Standard | 82 – 89 | 0.90x | 8% |
| Elevated | 90 – 94 | 1.00x | 10% |
| Elite | 95+ | 1.00x | 12% |

When trust falls below a threshold, the agent enters **Trust Recovery Mode** and must demonstrate consecutive compliant actions before capital rights are restored.

### 5. On-Chain Risk Enforcement

The `ActuraRiskPolicy.sol` smart contract enforces risk limits trustlessly:

- Max position size (% of capital)
- Max total exposure
- Max open positions
- Daily loss circuit breaker
- Max drawdown circuit breaker
- Trade cooldown (anti-churn)
- Asset whitelisting

### 6. Circuit Breaker

Production-grade state machine: **ARMED → TRIPPED → COOLING → ARMED**

- Triggers on daily loss limit breach or max drawdown breach
- Configurable cooldown period before trading resumes
- Conditions must improve before re-arming
- Daily reset at midnight

### 7. Human Oversight Controls

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

### MCP Server (port 3001)

Exposes tools and resources via the [Model Context Protocol](https://modelcontextprotocol.io):

**Tools:**

| Tool | Description |
|---|---|
| `get_risk_status` | Current risk engine state, volatility, exposure, drawdown |
| `explain_last_trade` | Human-readable explanation of the most recent trade decision |
| `get_trade_history` | Recent trade decisions with validation artifact links |
| `get_portfolio` | Capital, positions, and performance metrics |
| `ask_agent` | Natural language Q&A about strategy, risk, and decisions |
| `get_risk_analysis` | Comprehensive risk analysis with confidence intervals |
| `get_validation_quality` | Artifact completeness metrics |

**Resources:**

| URI | Description |
|---|---|
| `actura://market-state` | Live market indicators (SMA, volatility, ATR, price) |
| `actura://governance-policy` | Risk limits, strategy parameters, trust config |

**Endpoints:**
- `GET /mcp/tools` — List available tools
- `POST /mcp/tools/:toolName` — Execute a tool
- `GET /mcp/resources` — List available resources
- `GET /mcp/resources/:resourceUri` — Read a resource
- `POST /mcp` — JSON-RPC endpoint (MCP standard)

---

## ERC-8004 Integration

Actura integrates with the ERC-8004 Trustless Agent standard across three registries:

| Registry | Address (Base Sepolia) | Purpose |
|---|---|---|
| Identity | `0x7177a6867296406881E20d6647232314736Dd09A` | Agent registration & metadata |
| Reputation | `0xB5048e3ef1DA4E04deB6f7d0423D06F63869e322` | On-chain performance feedback |
| Validation | `0x662b40A526cb4017d947e71eAF6753BF3eeE66d8` | Validation request/response artifacts |

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
| `test-trust-recovery-mode.ts` | Recovery mode entry/exit, streak tracking |
| `test-erc8004-adapters.ts` | ERC-8004 registration & adapter compliance |
| `test-identity-registration.ts` | Identity registry integration |
| `test-reputation-reviewer.ts` | External reputation feedback flow |

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
| Artifact Storage | IPFS via [Pinata](https://pinata.cloud) |
| Scheduling | [node-cron](https://github.com/node-cron/node-cron) |
| Target Chain | Base Sepolia (Chain ID 84532) |

---

## Environment Variables

<details>
<summary>Full reference</summary>

| Variable | Description | Default |
|---|---|---|
| `PRIVATE_KEY` | Agent wallet private key | — |
| `RPC_URL` | JSON-RPC endpoint | `https://sepolia.base.org` |
| `CHAIN_ID` | Chain ID | `84532` |
| `IDENTITY_REGISTRY` | ERC-8004 Identity Registry | `0x7177...Dd09A` |
| `REPUTATION_REGISTRY` | ERC-8004 Reputation Registry | `0xB504...8713` |
| `VALIDATION_REGISTRY` | ERC-8004 Validation Registry | `0x662b...66d8` |
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
| `TRADING_INTERVAL_MS` | Cycle interval (ms) | `60000` |
| `MODE` | `simulation` or `live` | `simulation` |
| `ALLOWED_ASSETS` | Comma-separated allowed assets | `WETH/USDC,ETH,USDC` |
| `ALLOWED_PROTOCOLS` | Comma-separated allowed protocols | `uniswap` |
| `REQUIRE_HUMAN_APPROVAL_ABOVE_USD` | Auto-approval limit | `20000` |

</details>

---

## License

MIT © Sovereign AI Lab

---

<p align="center">
  <em>"Not the smartest trader. The most accountable."</em>
</p>
