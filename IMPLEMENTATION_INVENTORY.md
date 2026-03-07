# Actura Implementation Inventory

This file summarizes what is included in the latest consolidated package of **Actura / GACR** and what still depends on hackathon-provided infrastructure.

## 1. Core Runtime and Governance

### Included
- Market intelligence pipeline
- Structure / regime classification
- Signal generation
- Supervisory meta-agent
- Mandate engine
- Execution simulation engine
- Oracle integrity guard
- Trust scorecard
- Trust ladder / capital rights model
- Trust recovery mode
- Operator controls
  - pause
  - resume
  - emergency stop

## 2. Regime-Governance and Adaptive Learning

### Included
- `src/strategy/structure-regime.ts`
- `src/strategy/regime-governance.ts`
- deterministic profile selection
- hysteresis / cooldown behavior
- drawdown-sensitive defensive escalation
- profile switch artifacts
- bounded adaptive learning
- bounded context confidence bias
- `getContextConfidenceBias(...)`
- context statistics helpers

### Current behavior
- regime-governance influences:
  - confidence
  - sizing
  - stop-loss profile
  - threshold gating
- adaptive learning remains bounded and cannot self-expand beyond policy limits

## 3. ERC-8004 Integration

### Included
- Identity adapter
- Validation adapter
- Reputation adapter
- Agent registration JSON builder
- `agentRegistry` string generation
- `agentURI` data URI generation
- verified agent wallet flow
- signed TradeIntent helpers
- validation request hash helpers
- feedback helpers

### Adapter-ready but depends on hackathon values
- Identity Registry contract address
- Reputation Registry contract address
- Validation Registry contract address
- final Risk Router contract details
- Capital Vault contract details
- validator addresses / workflow

## 4. Dashboard / UI

### Included
- Market Intelligence panel
- Decision Engine table
- Artifact Drawer
- Trade Trust Proof (one-click explainability)
- Capital Rights Visualizer
- Trust + Capital Ladder
- Execution + Security panel
- Operator Controls
- Mandate + Supervisory panel
- ERC-8004 Protocol panel
- Pre-Trade Checks
- Watch Items / alerts

### ERC-8004 dashboard visibility
- agentId
- agentRegistry
- ownerWallet
- agentWallet
- tradeIntentHash
- validationRequestHash
- feedback tag
- readiness badges

## 5. Scripts and Bootstrap

### Included
- registration generator script
- ERC-8004 bootstrap script
- hackathon environment template
- hackathon checklist
- on-chain demo path script

## 6. Tests

### Included
- trust scorecard tests
- trust recovery tests
- supervisory meta-agent tests
- operator control tests
- reputation reviewer tests
- identity registration tests
- ERC-8004 adapter tests
- regime-governance tests

## 7. README / Documentation

### Included
- project overview
- architecture summary
- governance decision pipeline
- ERC-8004 integration section
- dashboard feature descriptions
- demo flow
- hackathon positioning

## 8. What Still Depends on the Hackathon

These items are **not missing in architecture**, but they require official hackathon values before live execution:

- `IDENTITY_REGISTRY_ADDRESS`
- `REPUTATION_REGISTRY_ADDRESS`
- `VALIDATION_REGISTRY_ADDRESS`
- `RISK_ROUTER_ADDRESS`
- `CAPITAL_VAULT_ADDRESS`
- final router ABI / field names
- final vault claim flow
- validator addresses / validation workflow

## 9. Recommended Source of Truth

Use the latest consolidated package as the single source of truth:

- `actura_final_consolidated_latest_full.zip`

Do not rely on earlier ZIPs except as checkpoints, because some older packages did not fully carry forward later dashboard or ERC-8004 improvements.

## 10. Final State Summary

### Implemented
- governed runtime
- trust-based capital control
- deterministic explainability
- ERC-8004 adapters
- dashboard control plane
- hackathon-ready bootstrap/config setup

### Awaiting hackathon infra details
- live registry addresses
- router integration details
- vault claim integration details
- validator addresses / external validation flow
