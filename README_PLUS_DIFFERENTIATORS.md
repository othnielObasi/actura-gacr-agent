# Actura
## Trust-Governed Autonomous Trading Agent
### Built on the Governed Autonomous Capital Runtime (GACR)

Actura is a **trust-governed autonomous trading agent** designed for open agent economies.

Unlike traditional AI trading bots that optimize purely for profit, Actura ensures that every capital decision passes a deterministic governance pipeline including:

- market intelligence
- mandate enforcement
- oracle integrity checks
- execution simulation
- trust-based capital control
- supervisory oversight
- ERC-8004-compatible trust artifacts

The system is designed to align with the ERC-8004 trustless agent model, which introduces three lightweight registries for **Identity**, **Reputation**, and **Validation**.

## Why Actura Exists

Autonomous financial agents are increasingly capable of taking actions such as:

- trading
- managing risk
- routing capital
- interacting with on-chain markets

But capability alone is not enough.

In real capital environments, agents must also be:

- governed
- explainable
- trust-minimized
- auditable
- overrideable

Actura was built to solve that problem.

Instead of behaving like a black-box trading bot, Actura behaves like a **governed capital runtime** that decides whether it has earned the right to act.

## System Architecture

```text
                Market Intelligence
                        │
                        ▼
                Decision Engine
                        │
                        ▼
                Governance Layer
                        │
                        ▼
                Execution Simulation
                        │
                        ▼
                Trust Evaluation
                        │
                        ▼
                Supervisory Runtime
                        │
                        ▼
                ERC-8004 Trust Layer
```

## Governance Decision Pipeline

Every trade passes through a structured pipeline:

```text
Signal
 → Risk Evaluation
 → Governance Checks
 → Security Controls
 → Execution Simulation
 → Trust Validation
 → TradeIntent Signing
 → Submission
 → Validation Receipt
```

Only trades that pass **all stages** are allowed to execute.

## Core Features

### Market Intelligence
Actura analyzes market conditions using:

- ADX trend strength
- CHOP regime classification
- volatility ratio
- Bayesian signal bias

### Regime Governance
Actura includes explicit regime-governance logic with:

- deterministic profile selection
- hysteresis
- defensive escalation
- drawdown-sensitive throttling
- audited profile-switch artifacts

### Adaptive Learning
Adaptive learning is bounded and policy-safe.

It includes:

- bounded parameter tuning
- context-sensitive confidence bias
- regime-aware statistics
- no unrestricted self-modification

### Execution Safety
Before a trade can be sent, the system evaluates:

- slippage estimate
- gas estimate
- expected net edge
- oracle deviation
- trust state
- supervisory status

Possible outcomes:

- `APPROVED`
- `WATCH`
- `BLOCKED`

### Trade Trust Proof
The dashboard includes a one-click explainability panel showing exactly why a trade was approved or blocked.

### Capital Rights Visualizer
The dashboard shows how the current trust score unlocks or restricts capital rights in real time.

### Supervisory Runtime
The runtime supports:

- pause
- resume
- emergency stop
- operator receipts
- trust-recovery throttling

### Artifact Layer
Each decision can produce artifacts such as:

- TradeIntent hash
- validation request hash
- IPFS receipt
- transaction hash
- feedback tag

---

# What Makes Actura Different

Most hackathon entries will present an AI trading bot.

Actura is different because it treats every trade as a **governed capital decision**, not just a market prediction.

## 1. Trust-governed capital rights
Trust is not just recorded. It directly determines how much capital the agent is allowed to control.

Actura uses a trust ladder:

| Tier | Trust Score | Capital Rights |
|---|---:|---:|
| T0 | < 60 | 0.00x |
| T1 | 60–74 | 0.25x |
| T2 | 75–84 | 0.60x |
| T3 | 85–92 | 1.00x |
| T4 | 93+ | 1.25x |

This turns trust into an operational capital-governance mechanism.

## 2. Deterministic explainability
Every selected trade can be explained through a **Trade Trust Proof** showing:

- signal confidence
- Bayesian bias
- adjusted confidence
- market regime
- volatility profile
- edge estimate
- oracle integrity
- trust score
- trust tier
- capital multiplier
- supervisory decision
- validation artifacts

This creates one-click explainability for each trade.

## 3. Governance before execution
Trades do not go straight from signal to execution.

They must pass:

**Signal → Risk → Governance → Security → Execution Simulation → Trust Validation → TradeIntent Signing → Submission → Receipt**

This ensures that trade execution is gated by policy, safety, and trust.

## 4. Recovery-aware autonomy
If trust deteriorates, the agent does not instantly regain full autonomy after one good trade.

Actura includes **Trust Recovery Mode**, which throttles capital rights until stability returns.

## 5. ERC-8004-aligned trust layer
Actura is built to plug into:

- **Identity Registry**
- **Reputation Registry**
- **Validation Registry**

## 6. Institutional-style oversight
Actura includes operator controls:

- pause
- resume
- emergency stop

These interventions generate operator receipts and reinforce accountable autonomy.

## In one sentence

**Actura does not just trade — it earns, explains, and defends the right to act on capital.**
