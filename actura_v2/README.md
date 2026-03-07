# Actura
## Trust-Governed Autonomous Trading Agent

Actura is a **trust-governed autonomous trading agent** built on the **Governed Autonomous Capital Runtime (GACR)** and designed to operate in open agent economies using the **ERC-8004 Trustless Agent framework**.

Unlike traditional AI trading bots that optimize purely for profit, Actura ensures that **every capital decision passes a governance pipeline** including risk checks, execution simulation, trust validation, and supervisory oversight.

---

# System Architecture

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

---

# Governance Decision Pipeline

Every trade goes through a deterministic pipeline:

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

Trades only execute when **all stages pass**.

---

# Key Features

## Market Intelligence Engine

Analyzes market structure using:

- ADX trend strength
- CHOP regime detection
- volatility ratio
- Bayesian bias adjustment

Outputs:

- signal direction
- confidence score
- market regime classification

---

# Trade Trust Proof (Explainability)

Actura provides **deterministic explainability for every decision**.

Selecting a trade reveals the reasoning chain:

```text
Signal confidence
Bayesian bias
Adjusted confidence
Market regime
Volatility profile
Expected edge
Oracle integrity
Trust score
Trust tier
Capital multiplier
Supervisory decision
```

This produces a **Trade Trust Proof**.

---

# Capital Governance

Actura uses a **Trust Ladder** to determine capital allocation.

| Tier | Trust Score | Capital Rights |
|-----|-------------|---------------|
| T0 | <60 | Blocked |
| T1 | 60-74 | 0.25x |
| T2 | 75-84 | 0.60x |
| T3 | 85-92 | 1.00x |
| T4 | 93+ | 1.25x |

Higher trust unlocks greater capital allocation.

---

# Capital Rights Visualizer

The dashboard displays **how trust score determines capital rights in real time**.

This demonstrates **programmable capital governance**.

---

# Execution Safety

Before submitting a trade, the runtime simulates execution:

- slippage estimation
- gas cost estimation
- expected net edge

Possible statuses:

```text
APPROVED
WATCH
BLOCKED
```

---

# Artifact Layer

Each trade generates verification artifacts:

- TradeIntent hash
- Validation request hash
- IPFS receipt
- transaction hash

This creates a **verifiable audit trail**.

---

# ERC-8004 Integration

Actura integrates with the **ERC-8004 Trustless Agent Protocol**.

### Identity Registry
Registers Actura as a discoverable agent.

### Validation Registry
Stores verification receipts proving correct execution.

### Reputation Signals
Trade outcomes emit feedback signals.

This enables **trust-based agent discovery and evaluation**.

---

# Dashboard

The Actura dashboard displays the runtime in real time.

Key sections:

### Market Intelligence
Live price and regime detection.

### Decision Engine
List of recent trade decisions.

### Trade Trust Proof
One-click explainability.

### Capital Rights Visualizer
Trust-based capital allocation.

### Execution + Security
Simulation and oracle integrity checks.

### Operator Controls
Pause, resume, emergency stop.

### Artifact Drawer
Trade verification receipts.

---

# README Media Placeholders

Add these files to strengthen the repo presentation:

```text
docs/dashboard.png
docs/architecture.png
```

And reference them like this:

```markdown
![Actura Dashboard](docs/dashboard.png)
![System Architecture](docs/architecture.png)
```

---

# Demo Flow

Recommended hackathon demo sequence:

1. Market signal detected  
2. Governance pipeline evaluation  
3. Execution simulation  
4. Trust score update  
5. TradeIntent signing  
6. Validation artifact generation  

The dashboard visualizes each stage.

---

# Running the Dashboard

Install dependencies

```bash
npm install
```

Start dev server

```bash
npm run dev
```

Open

```text
http://localhost:3000
```

---

# Hackathon Focus

This project targets:

- **Best Trustless Trading Agent**
- **Best Validation & Trust Model**
- **Best Compliance & Risk Guardrails**

---

# Vision

Actura demonstrates how **AI agents can safely manage capital through programmable governance and trust verification**.

The goal is enabling **trustless agent economies**.

---

License: MIT
