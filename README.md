# Actura on GACR

**Actura** is a governed autonomous trading agent running inside the **Governed Autonomous Capital Runtime (GACR)** — a governance-first operating environment for autonomous financial agents.

This repository is designed for the **AI Trading Agents with ERC-8004 Hackathon** and focuses on three things judges care about most:

- **risk-adjusted profitability**
- **drawdown control**
- **validation quality**

Actura does not simply place trades. It must continuously **earn the right to control capital** by proving policy compliance, risk discipline, validation completeness, and acceptable execution outcomes.

---

## What This Project Is

The correct way to understand this repository is:

- **GACR** = the governance-first runtime infrastructure
- **Actura** = the first autonomous trading agent running inside that runtime

That means the project is not just a trading bot. It is a prototype of a broader **autonomous capital operating system**.

---

## Core Runtime Flow

```text
Market Data
↓
Structure / Volatility Regime Classification
↓
Strategy Proposal
↓
Neuro-Symbolic Validation
↓
Mandate Enforcement
↓
Security Validation (Oracle Integrity)
↓
Execution Simulation
↓
Supervisory Capital Decision
↓
On-Chain Execution
↓
Trust Policy Scorecard
↓
Reputation Evolution + Capital Trust Ladder
```

---

## Key Features

### 1. Governance-First Trading Runtime
Actura is designed around governance, not raw alpha alone.

Implemented controls include:

- **agent mandate enforcement**
- **risk guardrails and exposure limits**
- **drawdown-sensitive supervisory control**
- **edge-aware trade filtering**
- **execution simulation before live execution**
- **oracle integrity checks**
- **trust-scored validation artifacts**

### 2. Neuro-Symbolic Safety Layer
The decision engine combines statistical signal generation with explicit symbolic controls.

Examples include:

- consecutive loss protection
- drawdown recovery mode
- directional balance constraints
- volatility spike caution
- mean-reversion at extremes

### 3. Trust Policy Scorecard
Every important action is scored across four trust dimensions:

| Dimension | Description |
|---|---|
| Policy Compliance | Was the action within mandate and policy? |
| Risk Discipline | Was the action acceptable for the market and risk state? |
| Validation Completeness | Were the required artifacts and reasoning traces present? |
| Outcome Quality | Did execution stay within acceptable quality bounds? |

The scorecard outputs:

- `trustScore`
- `trustDelta`
- `status` (`trusted`, `watch`, `restricted`)
- `trustTier`
- `capitalMultiplier`
- `capitalLimitPct`

### 4. Reputation Evolution + Capital Trust Ladder
Actura must earn the right to deploy capital.

| Trust Tier | Score Range | Capital Multiplier | Soft Capital Limit |
|---|---:|---:|---:|
| probation | 0–71 | 0.40x | 3% |
| limited | 72–81 | 0.70x | 6% |
| standard | 82–89 | 0.90x | 8% |
| elevated | 90–94 | 1.00x | 10% |
| elite | 95+ | 1.00x | 12% |

This ladder is used by the **supervisory meta-agent** to throttle or pause trading when trust deteriorates.

### 5. Security Hardening
Implemented security controls include:

- oracle deviation checks
- stale feed detection
- single-bar anomaly detection
- execution simulation blocks
- supervisory pause logic under stress and drawdown
- operator emergency stop and manual pause receipts

---

## Repository Structure

```text
actura/
├── contracts/
│   └── ActuraRiskPolicy.sol
├── scripts/
│   └── register-agent.ts
├── src/
│   ├── agent/
│   │   ├── index.ts
│   │   └── supervisory-meta-agent.ts
│   ├── chain/
│   │   ├── agent-mandate.ts
│   │   ├── execution-simulator.ts
│   │   ├── identity.ts
│   │   ├── intent.ts
│   │   ├── reputation.ts
│   │   ├── risk-router.ts
│   │   └── validation.ts
│   ├── risk/
│   ├── security/
│   │   └── oracle-integrity.ts
│   ├── strategy/
│   ├── trust/
│   │   ├── artifact-emitter.ts
│   │   ├── reputation-evolution.ts
│   │   └── trust-policy-scorecard.ts
│   └── dashboard/
├── test/
└── README.md
```

---

## Hackathon Alignment

Actura is designed to align directly with the ERC-8004 hackathon requirements.

| Requirement | Implementation Status |
|---|---|
| Agent identity and metadata | Implemented via identity + mandate integration |
| Trustless validation artifacts | Implemented |
| Risk-aware trading runtime | Implemented |
| Reputation from objective outcomes | Implemented |
| Security validation before execution | Implemented |
| Governance-first capital control | Implemented |

Current position:

- **Hackathon alignment:** strong
- **GACR runtime coverage:** strong prototype
- **Validation quality:** excellent

---

## Commands

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Run dashboard:

```bash
npm run dashboard
```

Run the end-to-end on-chain demo path:

```bash
npm run demo:onchain
```

Run all tests:

```bash
npm test
```

Build TypeScript:

```bash
npm run build
```

---

## Tests

The repository includes tests for:

- strategy and indicators
- risk engine
- artifacts
- chain integrations
- mandate engine
- execution simulator
- oracle integrity guard
- trust policy scorecard
- reputation evolution
- supervisory meta-agent

---

## What Makes This Different

Most hackathon agents will show:

- strategy
- trades
- maybe profit
- maybe logs

Actura shows:

- trade intent
- regime context
- mandate approval
- risk decision
- oracle safety result
- execution simulation
- supervisory decision
- trust score
- trust tier
- capital eligibility

That is what makes it look less like a bot and more like a **governed autonomous capital runtime**.

---

## Post-Hackathon Roadmap

These are intentionally **not required for the hackathon submission**, but are natural GACR extensions:

- multi-agent coordination
- cross-chain execution
- strategy plugin framework
- decentralized policy governance
- decentralized trust scoring
- liquidity and sentiment intelligence

---

## Suggested Small But Powerful Improvement

A very small next enhancement with outsized judging impact is a **Trust Recovery Mode**.

Instead of only reducing capital when trust falls, the agent would enter a visible recovery state that requires:

- consecutive compliant actions
- full validation completeness
- no abnormal execution outcomes

before capital rights are restored.

This is powerful because it turns trust into a visibly earned, path-dependent control system — a very strong story for ERC-8004 with minimal code.


## Human Oversight Controls

The dashboard now exposes operator controls for:

- **Pause Trading**
- **Resume Trading**
- **Emergency Stop**

Each operator action creates a receipt containing:

- action type
- reason
- timestamp
- affected agent
- resulting runtime mode

These receipts are attached to the runtime control plane and surfaced in the dashboard so judges can see that Actura is not fully unsupervised when capital safety requires intervention.

## Trust Evolution Chart

The dashboard includes a live **trust / capital tier evolution chart** showing how:

- trust score changes over time
- trust tier changes over time
- capital rights evolve as trust rises or falls

This makes the **Reputation Evolution + Capital Trust Ladder** visible during the demo, which strengthens the validation-quality and institutional-readiness story.

## End-to-End On-Chain Demo Path

A dedicated script is included for a real execution walkthrough:

```bash
npm run demo:onchain
```

This demo path performs:

1. wallet and router preflight checks
2. optional sandbox capital claim
3. sample trade generation through the current strategy and risk engine
4. real TradeIntent submission when `RUN_ONCHAIN_DEMO=true`

This gives you a clean, single-command demonstration path for hackathon judging and demo recording.


## ERC-8004 Bootstrapping

Generate a spec-compliant registration JSON:

```bash
npm run generate:registration
```

Bootstrap identity + optional wallet verification + sandbox claim:

```bash
npm run bootstrap:erc8004
```

These scripts prepare the missing ERC-8004 integration pieces around identity, registration metadata, and hackathon sandbox readiness.


## Hackathon Ready Bootstrap

1. Copy `.env.hackathon.example` to `.env`
2. Fill wallet and any known registry/router addresses
3. Generate the ERC-8004 registration JSON:

```bash
npm run generate:registration
```

4. Run the one-command bootstrap flow:

```bash
npm run bootstrap:erc8004
```

This will:
- run preflight checks
- generate and validate the registration JSON
- register the agent on the Identity Registry (unless `SKIP_REGISTER=true`)
- optionally verify a new agent wallet
- optionally claim sandbox capital

Use `HACKATHON-CHECKLIST.md` as the final wiring checklist when official addresses are released.


## Dashboard update

The dashboard now includes a Trade Trust Proof panel and a Capital Rights Visualizer to make governance decisions and trust-governed capital allocation clearer during demos.
