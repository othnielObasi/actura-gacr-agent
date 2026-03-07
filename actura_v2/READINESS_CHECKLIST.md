# Readiness Checklist

Use the statuses below:

- **Implemented**
- **Adapter-ready**
- **Waiting on hackathon infra**

| Requirement | Status | Notes |
|---|---|---|
| Agent registration JSON | **Implemented** | Registration builder and `agentURI` generation are included. |
| ERC-8004 Identity integration | **Adapter-ready** | Final live registration needs official Identity Registry address. |
| EIP-712 TradeIntent signing | **Implemented** | Signed intent path is in place. |
| EIP-1271 wallet support path | **Adapter-ready** | Flow is prepared but final wallet choice still matters. |
| Validation artifacts | **Implemented** | Trade Trust Proof, hashes, checkpoints, artifact drawer are included. |
| Validation Registry integration | **Adapter-ready** | Final live calls need official registry address / validator workflow. |
| Reputation logic | **Adapter-ready** | Internal trust and feedback helpers are implemented; live registry posting needs official address. |
| Risk Router execution path | **Adapter-ready** | Final live submission depends on official router details. |
| Capital Vault claim flow | **Waiting on hackathon infra** | Requires official hackathon vault details. |
| Trust-governed runtime | **Implemented** | Mandate engine, supervisory agent, trust ladder, recovery mode are present. |
| Regime-governance | **Implemented** | Included in latest consolidated package. |
| Adaptive learning | **Implemented** | Bounded adaptive layer included. |
| Operator controls | **Implemented** | Pause, resume, emergency stop are included. |
| Dashboard control plane | **Implemented** | Includes explainability, capital rights, protocol visibility. |

## What Still Depends on Official Hackathon Infra

These items are not missing in architecture, but they do require official event values before final live execution:

- `IDENTITY_REGISTRY_ADDRESS`
- `REPUTATION_REGISTRY_ADDRESS`
- `VALIDATION_REGISTRY_ADDRESS`
- `RISK_ROUTER_ADDRESS`
- `CAPITAL_VAULT_ADDRESS`
- final router ABI / field names
- final vault claim flow
- validator addresses / workflow
