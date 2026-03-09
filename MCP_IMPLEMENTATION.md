
# MCP Implementation for Actura

This document describes the current MCP implementation inside Actura, what is already available, and what is planned next.

## Goal

The MCP layer provides a **controlled interoperability surface** for Actura. External clients, agents, dashboards, and auditors can interact with Actura through tools, resources, and prompts **without bypassing the governance runtime**.

The internal model remains:

Market Intelligence → Governance → Execution Safety → Trust Evaluation → Supervisory Runtime → ERC-8004 adapters

MCP is the interface, not the decision-maker.

---

## What is implemented now

## 1. MCP Server
Implemented:
- HTTP endpoints for listing and calling tools
- HTTP endpoints for listing and reading resources
- HTTP endpoints for listing and retrieving prompts
- JSON-RPC endpoint at `/mcp`
- health/info endpoints
- support for public, restricted, and operator surfaces

### Discovery endpoints
- `GET /mcp/tools`
- `GET /mcp/resources`
- `GET /mcp/prompts`
- `GET /mcp/info`
- `GET /health`

### JSON-RPC methods
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`

---

## 2. Public MCP Tools
Implemented public tools:
- `get_market_state`
- `get_trust_state`
- `get_capital_rights`
- `get_mandate_state`
- `get_positions`
- `get_performance_metrics`
- `explain_trade`
- `get_validation_status`
- `get_reputation_summary`

These provide:
- market visibility
- capital-rights state
- deterministic explainability
- runtime positions/exposure
- local validation and reputation summaries
- risk-adjusted return metrics

---

## 3. Restricted MCP Tools
Implemented restricted tools:
- `propose_trade`
- `execute_trade`

### Current behavior
`propose_trade`
- creates a governed trade proposal
- applies capital-rights and mandate logic
- returns a decision package without bypassing the runtime

`execute_trade`
- builds a router-compatible TradeIntent
- can sign the TradeIntent when wallet and router configuration are available
- does not bypass runtime governance

---

## 4. Operator / Private MCP Tools
Implemented operator-only tools:
- `pause_agent`
- `resume_agent`
- `emergency_stop`

These map directly to Actura’s operator-control layer and produce operator receipts.

---

## 5. MCP Resources
Implemented resources:
- `actura://state/trust`
- `actura://state/market`
- `actura://state/mandate`
- `actura://state/positions`
- `actura://state/operator`
- `actura://state/performance`
- `actura://state/erc8004`
- `actura://state/artifacts`

These provide structured, read-only state for:
- dashboards
- auditors
- external agents
- operator consoles

---

## 6. MCP Prompts
Implemented prompts:
- `explain_current_trade`
- `summarize_risk_state`
- `prepare_operator_incident_report`
- `summarize_trust_evolution`

These are useful for:
- demos
- operator workflows
- audit/reporting
- human-readable explanations

---

## 7. Public vs Private Surface

## Public
Designed for external read/query access:
- market state
- trust state
- capital rights
- explainability
- validation summary
- performance metrics
- artifacts
- trust/reputation summary

## Restricted
Designed for trusted application callers:
- `propose_trade`
- `execute_trade`

## Private / Operator
Designed for tightly controlled supervision:
- `pause_agent`
- `resume_agent`
- `emergency_stop`
- operator state resource
- incident-report prompt

---

## 8. What has been tested
Implemented:
- MCP surface test covering:
  - tool count
  - resource count
  - prompt count
  - market tool
  - capital-rights tool
  - explainability tool
  - operator action tool
  - prompt execution
  - ERC-8004 resource

---

## Future implementation

## Public future improvements
Planned public improvements:
- full MCP SDK compliance using `@modelcontextprotocol/sdk`
- streaming responses
- richer trade explanation payloads
- historical trade query filters
- richer validation-resource browsing
- live reputation summary from on-chain registry
- live Validation Registry reads by request hash
- live ERC-8004 agent registration view from chain

## Restricted future improvements
Planned restricted improvements:
- full Risk Router submission
- capital-vault interaction
- signed execution workflow with live router ABIs
- stronger request-level auth for restricted tool calls
- audit logging for all trade proposals and execution requests

## Private / operator future improvements
Planned private improvements:
- role-based auth
- signed operator sessions
- incident workflow templates
- approval gates for high-notional trades
- separation of owner vs runtime wallet controls
- private supervisory workflow prompts

---

## Relationship to ERC-8004

The MCP layer is complementary to ERC-8004.

- **ERC-8004** provides identity, reputation, and validation registries.
- **MCP** provides the interaction surface through which external systems can discover capabilities and request governed actions.

Together, they make Actura:
- discoverable
- explainable
- governable
- interoperable

---

## Current status summary

### Implemented
- MCP server
- tool surface
- resource surface
- prompt surface
- public / restricted / operator separation
- integration with trust, governance, performance, and operator modules

### Adapter-ready
- live router submission path
- live validation registry reads/writes
- live reputation registry reads/writes
- full ERC-8004 registration visibility

### Waiting on official infra
- final Risk Router details
- Capital Vault details
- validator addresses/workflow
- final registry addresses if changed by hackathon
