# Actura: A Governed Autonomous Capital Runtime for Trustless AI Trading

**White Paper v1.0 — April 2026**

**Authors:** Sovereign AI Lab

---

## Abstract

We present Actura, a governed autonomous trading agent operating within a trust-minimized capital runtime aligned with the ERC-8004 Trustless Agent standard. Unlike conventional AI trading systems that optimize solely for financial returns, Actura enforces a deterministic governance pipeline on every capital decision — producing immutable validation artifacts, earning dynamic capital rights through a multi-dimensional trust scorecard, and enforcing risk limits at the smart-contract level. This paper describes the system architecture, governance model, trust mechanics, risk enforcement framework, and the rationale for prioritizing accountability alongside performance in autonomous financial agents.

---

## 1. Introduction

### 1.1 The Trust Gap in Autonomous Finance

The rapid advancement of AI has produced trading agents capable of analyzing market microstructure, generating signals, managing risk, and executing trades with minimal human intervention. However, the deployment of these agents in real capital environments faces a fundamental challenge: **the absence of verifiable trust**.

Current autonomous trading systems exhibit several deficiencies that prevent serious capital delegation:

1. **Opacity** — Decision-making processes are opaque, offering no auditable reasoning chain.
2. **Ungoverned execution** — Agents operate without enforceable mandates, capital limits, or compliance boundaries.
3. **No provenance** — There is no immutable record of what the agent considered, what it rejected, and why it acted.
4. **Static trust** — Capital allocation is fixed rather than dynamically adjusted based on demonstrated behavior.
5. **No recourse** — When agents fail, there is no evidence trail for post-mortem analysis.

### 1.2 Design Thesis

Actura is built on the thesis that **accountability and autonomy are not opposing forces** — they are complementary engineering requirements. A governed agent that produces complete decision artifacts is not a weaker agent; it is a more deployable one.

The system implements the **Governed Autonomous Capital Runtime (GACR)**, an operating environment where autonomous agents must continuously earn the right to control capital through policy compliance, risk discipline, validation completeness, and outcome quality.

### 1.3 Contributions

This paper makes the following contributions:

1. A **multi-stage governance pipeline** that deterministically validates every capital decision across 8 stages.
2. A **four-dimensional trust scorecard** with a dynamic capital rights ladder that adjusts capital allocation based on agent behavior.
3. A **neuro-symbolic safety layer** combining statistical signals with explicit symbolic controls.
4. An **on-chain risk enforcement contract** (`ActuraRiskPolicy.sol`) that makes risk limits trustlessly verifiable.
5. A **complete artifact system** producing IPFS-pinned decision records with TEE attestation.
6. Full alignment with **ERC-8004** (Trustless Agent Standard) across Identity, Reputation, and Validation registries.
7. **ACE (Agentic Context Engineering)** — an LLM-powered self-improving layer that uses structured reflection to optimize signal weights and build conditional playbook rules, with 3-layer overfitting protection.

---

## 2. System Architecture

### 2.1 Overview

Actura operates as a continuous-cycle trading agent. Each cycle proceeds through three phases:

1. **Intelligence** — Market data acquisition, structure detection, regime classification, and signal generation.
2. **Governance** — Eight-stage validation pipeline determining whether the agent has earned the right to execute.
3. **Execution & Accountability** — Trade execution, artifact creation, trust scoring, and on-chain recording.

### 2.2 Intelligence Layer

The intelligence layer aggregates data from multiple sources:

**Price Feeds:**
- Primary: CoinGecko API with DeFiLlama and Kraken fallback chain
- Cross-validation against multiple sources to detect anomalies

**Sentiment Signals:**
- Fear & Greed Index (40% weight) — crowd psychological state
- Alpha Vantage news sentiment (35% weight) — NLP-derived market sentiment
- Kraken funding rate proxy (25% weight) — derivatives market positioning

**PRISM Intelligence (Strykr API):**
- Technical signals: RSI, MACD, MACD histogram, Bollinger Bands, directional bias
- Risk metrics: daily volatility, Sharpe ratio, Sortino ratio, max drawdown
- Integration model: confirmation-only confidence modifier (+0% to +15%)
  - When PRISM confirms the primary strategy direction → confidence boost proportional to signal strength
  - When PRISM contradicts → no modification (avoids conflicting signal cancellation)

**Market Structure Detection:**
- ADX trend strength measurement
- CHOP index regime classification
- EWMA volatility with regime detection (LOW, NORMAL, HIGH, EXTREME)
- Bayesian context confidence bias per regime-direction pair

### 2.3 Strategy Engine

The strategy engine generates trading signals using:

- **SMA Crossover** — 20/50-period simple moving average crossover for trend direction
- **Momentum Scoring** — Volatility-adjusted confidence based on crossover magnitude relative to ATR
- **Position Sizing** — Dynamic sizing based on regime profile, trust tier capital multiplier, and volatility ratio
- **ATR-Based Risk Levels** — Stop-loss and take-profit targets derived from Average True Range, adjusted by regime
- **ACE-Tuned Signal Weights** — Seven scorecard weights (trend, ret5, ret20, crossover, rsi, zscore, sentiment) dynamically optimized by the ACE engine within immutable CAGE bounds

### 2.4 AI Reasoning

Every executed trade receives a natural-language explanation generated by a 3-tier LLM failover chain:

1. **Claude** (Anthropic) — primary
2. **Gemini** (Google) — first fallback
3. **OpenAI GPT** — second fallback

The AI reasoning module receives the full decision context (signal, risk state, regime, sentiment, positions) and produces a human-readable summary embedded in the IPFS artifact.

---

## 3. Governance Pipeline

### 3.1 Pipeline Stages

Every trading cycle passes through 8 sequential stages. A trade executes **only if all stages approve**.

| Stage | Module | Function |
|-------|--------|----------|
| 1. Signal Generation | `strategy/momentum.ts` | Generate directional signal with confidence score |
| 2. Neuro-Symbolic Reasoning | `strategy/neuro-symbolic.ts` | Apply symbolic safety rules (override, throttle, or confirm) |
| 3. Mandate Enforcement | `chain/agent-mandate.ts` | Verify asset whitelist, protocol restrictions, capital limits, human-approval thresholds |
| 4. Oracle Integrity Guard | `security/oracle-integrity.ts` | Detect stale feeds, median deviation, single/multi-bar anomalies |
| 5. Execution Simulation | `chain/execution-simulator.ts` | Estimate slippage, gas costs, net edge, worst-case scenario |
| 6. Supervisory Meta-Agent | `agent/supervisory-meta-agent.ts` | Trust-aware capital allocation, position throttling, drawdown-sensitive pausing |
| 7. Risk Engine | `risk/engine.ts` | 6 risk checks: circuit breaker, signal quality, position size, total exposure, volatility regime, position conflict |
| 8. On-Chain Recording | `chain/executor.ts` | EIP-712 signed TradeIntent, Risk Router submission, validation registry, reputation feedback |

### 3.2 Gate Trace

Every cycle produces a **gate trace** — a structured log recording the state of every pipeline stage:

```json
{
  "cycle": 518,
  "signal": "LONG",
  "gates": {
    "strategy": { "dir": "LONG", "conf": 0.32 },
    "prism": { "dir": "bullish", "str": "moderate", "mod": 0.05, "rsi": "60.8" },
    "oracle": { "pass": true },
    "neuro": { "dir": "LONG", "conf": 0.32, "rules": 1 },
    "regime": null,
    "supervisory": { "canTrade": true, "tier": "elevated" },
    "mandate": { "approved": true },
    "risk": { "approved": true, "failed": [] },
    "simulator": { "allowed": true },
    "onChain": "submitted"
  },
  "execute": true
}
```

This trace is included in every artifact, enabling complete post-mortem analysis of any decision.

### 3.3 Non-Execution Artifacts

A critical design principle: **rejected trades also produce artifacts**. When a signal is generated but blocked by any governance stage, the full reasoning chain is still recorded. This enables:

- Auditing of false negatives (valid opportunities missed by overly conservative gates)
- Tuning gate parameters with evidence
- Proving the agent was active and governed during periods of apparent inactivity

---

## 4. Trust Model

### 4.1 Trust Policy Scorecard

Every action is scored across four dimensions with the following weights:

| Dimension | Weight | Description |
|-----------|--------|-------------|
| **Policy Compliance** | 30% | Were all governance checks passed? Were mandates respected? |
| **Risk Discipline** | 30% | Was the action appropriate for the current market regime and risk state? |
| **Validation Completeness** | 20% | Were reasoning traces, artifacts, and governance evidence present? |
| **Outcome Quality** | 20% | Did execution stay within acceptable quality bounds (slippage, timing)? |

The composite score produces a trust rating on a 0–100 scale.

### 4.2 Capital Trust Ladder

Trust score maps to a **capital tier** that determines how much capital the agent may deploy:

| Tier | Score Range | Capital Multiplier | Max Position |
|------|-------------|-------------------|-------------|
| Probation | 0–71 | 0.40× | 3% |
| Limited | 72–81 | 0.70× | 6% |
| Standard | 82–89 | 0.90× | 8% |
| Elevated | 90–94 | 1.00× | 10% |
| Elite | 95+ | 1.00× | 12% |

**Key property:** The agent cannot self-promote. Tier advancement requires sustained high scores across multiple cycles. Tier demotion is immediate upon score degradation.

### 4.3 Trust Recovery Mode

When trust falls below a tier threshold, the agent enters **Trust Recovery Mode** with the following properties:

- **Regime-aware streak requirements** — recovery demands fewer consecutive compliant cycles in stable markets (2 in TRENDING) and more in volatile ones (4 in STRESSED)
- **Graduated deduction** — minor dips reduce the compliance streak by 1 instead of resetting it; only severe regressions (Δ < −5) trigger a full reset
- **Regime-specific tier cap** — during recovery, capital tier is capped at `standard` in trending markets and `limited` in all other regimes

This prevents a single bad cycle from permanently degrading the agent while ensuring recovery requires demonstrated consistency.

---

## 5. Risk Management

### 5.1 Off-Chain Risk Engine

The risk engine performs 6 checks on every trade:

1. **Circuit Breaker** — State machine (ARMED → TRIPPED → COOLING → ARMED) triggered by daily loss limit or max drawdown breach. Configurable cooldown with bounded extensions to prevent deadlocks.
2. **Signal Quality** — Minimum confidence threshold (regime-dependent, 8.5%–15%).
3. **Position Size** — Maximum single-position size as percentage of capital, adjusted by trust tier multiplier.
4. **Total Exposure** — Aggregate open position value must not exceed exposure limit.
5. **Volatility Regime** — Trades may be blocked or throttled during extreme volatility regimes.
6. **Position Conflict** — Prevents opening contradictory positions (e.g., LONG while SHORT is open on same asset).

### 5.2 Position Management

**Profit-Locking Trailing Stops:**
- Tiered breakeven mechanism activated at profit thresholds
- >0.5% profit → 95% trail (tight lock)
- >0.8% profit → 50% trail (balanced)
- >1.5% profit → 30% trail (let winners run)
- Stops only ratchet tighter, never widen

**Dynamic ATR Take-Profit:**
- Regime-aware TP targets: LOW=1.0×, NORMAL=1.2×, HIGH=1.5×, EXTREME=2.0× ATR
- Higher-volatility regimes demand wider targets to avoid premature exits

**Time-Based Exits:**
- Maximum position hold duration (configurable, default 4 hours)
- Prevents capital lockup in stagnant positions

### 5.3 On-Chain Risk Enforcement

The `ActuraRiskPolicy.sol` smart contract, deployed on Ethereum Sepolia, provides **trustless risk enforcement**:

```solidity
function checkTrade(address asset, uint8 side, uint256 amountUsd)
    external view returns (bool approved, string memory reason)
```

Enforced limits:
- Max position size (basis points of capital)
- Max total exposure (basis points of capital)
- Max open positions
- Daily loss circuit breaker
- Max drawdown circuit breaker
- Trade cooldown (seconds between trades)
- Asset whitelisting

**Critical property:** Risk parameters are **immutable after deployment**. Not even the contract owner can weaken them. They can be audited by any on-chain observer.

Contract address: [`0x054773f36E142BDCD01aF13d6863f90681eF8009`](https://sepolia.etherscan.io/address/0x054773f36E142BDCD01aF13d6863f90681eF8009)

---

## 6. Regime Governance

### 6.1 Volatility Regime Detection

Actura classifies markets into four volatility regimes using EWMA volatility with ADX and CHOP confirmation:

| Regime | Characteristics |
|--------|----------------|
| LOW | Low volatility, range-bound — tighter stops, larger positions |
| NORMAL | Standard conditions — default parameters |
| HIGH | Elevated volatility — wider stops, smaller positions, higher confidence threshold |
| EXTREME | Crisis/breakout — defensive mode, minimal exposure |

### 6.2 Deterministic Profile Switching

Regime transitions follow deterministic rules with **hysteresis** to prevent oscillation:

- Separate enter/exit thresholds for each regime boundary
- **Defensive-only fast switching** — the agent can always escalate to a more defensive profile immediately, but must hold for a minimum period (12 cycles) before relaxing
- **Drawdown lock** — locks into EXTREME_DEFENSIVE when drawdown exceeds 6%
- **Cooldown** — minimum 8 cycles between profile switches

Every profile switch is recorded as an auditable artifact with before/after parameters and the triggering conditions.

---

## 7. Adaptive Learning

### 7.1 Bounded Self-Improvement

Actura includes an adaptive learning module that adjusts parameters based on observed performance. The critical constraint: **the agent operates within an immutable cage**.

It **can** adjust:
- Stop-loss ATR multiple (range: 1.0–2.5)
- Base position size (range: 1%–4%)
- Confidence threshold (range: 5%–30%)

It **cannot**:
- Change its own boundaries
- Disable any risk check
- Expand parameter ranges
- Override symbolic rules
- Modify the governance pipeline

### 7.2 Bayesian Context Confidence Bias

The system maintains a **Beta(1,1) posterior mean** over observed win rates per regime-direction pair. This produces a bounded confidence bias (capped at ±12%) that adjusts signal confidence based on historical performance in similar market conditions.

This is not a black-box ML model — it is a transparent, interpretable Bayesian update with hard-coded bounds.

### 7.3 SAGE — Self-Adapting Generative Engine

Above the adaptive learning layer, Actura deploys **SAGE (Self-Adapting Generative Engine)** — an LLM-powered self-improving layer that uses structured reflection to progressively optimize the trading strategy.

#### 7.3.1 Reflection Cycle

After every batch of 5+ trade outcomes (minimum 10 agent cycles between reflections), SAGE sends the trade history with full feature vectors to **Gemini 2.5 Pro** for analysis. The LLM receives:

- Per-trade outcome data: direction, PnL, regime, confidence, stop-hit status
- Feature vectors: ret5, ret20, RSI, ADX, z-score, sentiment composite
- Current signal weights and their CAGE bounds
- Active playbook rules

The LLM returns structured JSON containing: insights (pattern analysis), weight recommendations, playbook rules, and a context summary.

#### 7.3.2 Signal Weight Optimization

SAGE manages 7 scorecard weights that drive signal generation:

| Weight | Default | CAGE Range | Purpose |
|--------|---------|------------|---------|
| trend | 0.60 | 0.0 – 2.0 | SMA crossover trend strength |
| ret5 | 1.80 | 0.0 – 4.0 | 5-bar momentum return |
| ret20 | 1.10 | 0.0 – 3.0 | 20-bar momentum return |
| crossover | 0.15 | 0.0 – 0.5 | Crossover event boost |
| rsi | 0.60 | 0.0 – 2.0 | RSI mean-reversion penalty |
| zscore | 0.50 | 0.0 – 2.0 | Z-score extreme penalty |
| sentiment | 0.12 | 0.0 – 0.5 | Sentiment composite weight |

**Safety properties:**
- All weight changes are bounded by immutable CAGE ranges
- Maximum 30% change per parameter per reflection cycle
- Weights are persisted to disk and survive restarts

#### 7.3.3 Playbook Rules

SAGE builds a library of conditional rules based on observed patterns:

- **BLOCK** — Force NEUTRAL for specific regime×direction×indicator combinations
- **REDUCE_CONFIDENCE** — Lower confidence by a specified magnitude (0.05–0.50)
- **BOOST_CONFIDENCE** — Raise confidence for favorable patterns

Rules are condition-matched against regime, direction, and indicator thresholds. Each rule has an evidence citation, creation timestamp, and automatic expiry after 30 trades. Maximum 20 active rules.

#### 7.3.4 Context Injection

Accumulated trading wisdom from reflections is injected as a prefix into every AI reasoning prompt. This enables the agent's natural-language explanations to incorporate learned experience without retraining.

#### 7.3.5 Overfitting Protections

SAGE implements three layers of overfitting defense:

1. **Regime diversity gate** — Weight changes require outcomes from at least 2 distinct market regimes (or 10+ total trades). This prevents overfitting to a single market condition.

2. **Holdout validation** — Outcomes are split 80/20 (train/holdout). The LLM only receives the training set. Proposed weight changes are validated against the holdout set: if the new weights would produce worse signal alignment on unseen data, the changes are rejected while insights and playbook rules are retained.

3. **Auto-revert monitoring** — Post-reflection performance is tracked. If the win rate drops by more than 15 percentage points over the next 5 trades, weights automatically revert to the pre-reflection snapshot. After 10 trades without degradation, the new weights are accepted as permanent.

#### 7.3.6 Failure Semantics

If the LLM is unavailable, returns malformed output, or the API key is exhausted:
- No changes are applied
- The agent continues with its last known good weights
- All existing playbook rules remain active
- The cycle counter resets, and reflection is reattempted next cycle

**Kill switch:** Setting `ACE_ENABLED=false` disables all SAGE operations. The agent reverts to default weights and no playbook rules are applied.

---

## 8. Accountability Infrastructure

### 8.1 Validation Artifacts

Every decision (executed or rejected) produces a JSON artifact containing:

| Field | Description |
|-------|-------------|
| `tradeDetails` | Direction, asset, size, entry, stop-loss, take-profit |
| `riskChecks` | 11 individual pass/fail results with reasons |
| `mandateEvidence` | Asset whitelist, protocol, capital limit compliance |
| `neuroSymbolicRules` | Which symbolic rules fired and their effect |
| `marketSnapshot` | 10 recent price candles, trend strength, regime |
| `confidenceInterval` | Best-case, worst-case, max loss projections |
| `aiReasoning` | Natural-language decision summary |
| `teeAttestation` | Code hash, git commit, OS fingerprint, nonce |
| `gateTrace` | Full pipeline state for every governance stage |

### 8.2 IPFS Storage

Artifacts are uploaded to IPFS via Pinata and are globally accessible via any IPFS gateway. Local copies are also stored in `./artifacts/` for re-pinning resilience.

### 8.3 TEE Attestation

Each artifact includes a software-based Trusted Execution Environment attestation that binds:
- Agent identity (Agent ID 18)
- Runtime environment (code hash, git commit SHA)
- OS fingerprint
- Cryptographic nonce

This provides evidence that the artifact was produced by the claimed agent running the claimed codebase.

---

## 9. ERC-8004 Integration

Actura aligns with the **ERC-8004 Trustless Agent Standard**, which introduces three lightweight registries:

### 9.1 Identity Registry

- Agent registration with metadata (name, description, services, endpoints)
- Spec-compliant registration JSON with `services` array, `x402Support`, `active`, `registrations`, and `supportedTrust` fields
- EIP-1271 signature verification (supports both EOA and smart-contract wallets)

### 9.2 Reputation Registry

- On-chain feedback submission after every trade
- Tagged scores (e.g., `tradingYield`, `riskCompliance`) with `int128` values and configurable decimals
- Optional `feedbackURI` pointing to IPFS artifact
- Self-review and cross-agent review support

### 9.3 Validation Registry

- Validation request hashes submitted pre-execution
- Validation response hashes submitted post-execution
- Keccak256 binding between request and artifact content

---

## 10. Interoperability: Model Context Protocol

Actura exposes a **Model Context Protocol (MCP)** surface on port 3001 for agent-to-agent interaction:

| Surface | Count | Examples |
|---------|-------|---------|
| **Tools** | 12 | `get_market_state`, `explain_trade`, `propose_trade`, `pause_agent` |
| **Resources** | 8 | `actura://state/trust`, `actura://state/market`, `actura://state/risk` |
| **Prompts** | 4 | `explain_current_trade`, `audit_readiness_report` |

Access is controlled by **visibility tiers** (public, restricted, operator). External agents can query Actura's state, propose trades through the governance pipeline, or audit decisions — but cannot bypass the runtime.

---

## 11. Deployment & Verification

### 11.1 Live System

Actura is deployed on Ethereum Sepolia with the following verifiable components:

| Component | Address / Link |
|-----------|---------------|
| Agent ID | 18 (Hackathon AgentRegistry) |
| ActuraRiskPolicy | `0x054773f36E142BDCD01aF13d6863f90681eF8009` |
| AgentRegistry | `0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3` |
| ReputationRegistry | `0x423a9904e39537a9997fbaF0f220d79D7d545763` |
| ValidationRegistry | `0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1` |
| Owner Wallet | `0xE8684cfbA08541C607898E55BAB58302204DdCD7` |
| Dashboard | `http://api.actura.nov-tia.com:3000` |
| MCP Endpoint | `http://api.actura.nov-tia.com:3001/mcp` |

### 11.2 Verification

Any observer can verify Actura's behavior:
- `getRiskState()` on the risk policy contract — returns capital, drawdown, circuit breaker status
- `checkTrade(asset, side, amount)` — simulates a risk check
- `/api/artifacts` — browse all decision artifacts with IPFS CIDs
- `/api/artifact/latest` — full JSON of the most recent decision
- Any artifact CID on IPFS — complete reasoning chain for that decision

---

## 12. Limitations & Future Work

### 12.1 Current Limitations

- **Single asset** — Currently trades ETH/USD only. Multi-asset support requires portfolio-level correlation management.
- **Paper trading** — Executes via Kraken paper orders. Real DEX execution is architecturally ready but requires mainnet deployment.
- **Win rate** — Current trading performance reflects the system's conservative governance gates and limited backtesting, not pure signal quality.
- **TEE attestation** — Software-based, not hardware TEE. Provides evidence but not cryptographic proof of execution environment.

### 12.2 Roadmap

| Phase | Timeline | Goal |
|-------|----------|------|
| 1. SAGE Maturation | Month 1 | Accumulate reflection data, validate SAGE weight optimization across multiple market regimes |
| 2. Backtesting Engine | Month 1–2 | Validate strategies against 2+ years of historical data |
| 3. Signal Improvement | Month 2 | Move from current win rate to 45%+ via ML features and multi-timeframe analysis |
| 4. Multi-Asset Portfolio | Month 3 | BTC, SOL, ARB pairs with correlation-aware sizing |
| 5. Mainnet + Vault | Month 4 | Base mainnet, ERC-4626 vault for delegated capital, real DEX execution |
| 6. Production Hardening | Month 5+ | Hardware TEE, institutional-grade monitoring, multi-region redundancy |

---

## 13. Conclusion

Actura demonstrates that autonomous trading agents can be simultaneously **capable and accountable**. The Governed Autonomous Capital Runtime provides:

- **Deterministic governance** — Every trade passes an 8-stage pipeline with immutable rules.
- **Dynamic trust** — The agent earns capital rights through demonstrated behavior, not static configuration.
- **Complete provenance** — Every decision produces a permanent, verifiable artifact.
- **Trustless enforcement** — Risk limits are enforced at the smart-contract level, beyond the agent's control.
- **Responsible self-improvement** — SAGE auto-tunes strategy weights using LLM reflection, bounded by immutable CAGE limits and protected by 3-layer overfitting defense.
- **Interoperability** — External agents and auditors can interact through MCP without bypassing governance.

The system is live on Ethereum Sepolia (Agent ID 18, 890+ cycles executed, 50+ closed trades with IPFS artifacts) and fully aligned with the ERC-8004 Trustless Agent standard.

The path to autonomous finance does not require choosing between AI capability and human trust. It requires building systems where trust is **earned, measured, enforced, and proven** — on every decision, every cycle, every trade.

---

## References

1. ERC-8004: Trustless Agent Standard — https://eips.ethereum.org/EIPS/eip-8004
2. EIP-712: Typed Structured Data Hashing and Signing — https://eips.ethereum.org/EIPS/eip-712
3. EIP-1271: Standard Signature Validation Method for Contracts — https://eips.ethereum.org/EIPS/eip-1271
4. Model Context Protocol — https://modelcontextprotocol.io
5. IPFS (InterPlanetary File System) — https://ipfs.tech
6. Base (Coinbase L2) — https://base.org

---

*Actura — "Not the smartest trader. The most accountable."*

**© 2026 Sovereign AI Lab — MIT License**
