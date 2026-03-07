# ACTURA — ERC-8004 Spec Alignment Audit
## Date: Feb 19, 2026 | Hackathon: March 9-22, 2026

---

## 1. CONTRACT ADDRESSES

### TWO Registry Deployments Exist:

**A) Official curated (erc-8004/erc-8004-contracts) — Jan 2026:**
- ETH Sepolia Identity: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ETH Sepolia Reputation: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- Base Sepolia: **NOT YET DEPLOYED** (listed as "to be deployed")
- **No Validation Registry** deployed in this set

**B) Reference Implementation (ChaosChain/trustless-agents-erc-ri) — deterministic on 5 testnets:**
- Identity: `0x7177a6867296406881E20d6647232314736Dd09A`
- Reputation: `0xB5048e3ef1DA4E04deB6f7d0423D06F63869e322`
- Validation: `0x662b40A526cb4017d947e71eAF6753BF3eeE66d8`
- Available on: ETH Sepolia, Base Sepolia, Optimism Sepolia, Mode Sepolia, 0G Testnet

### Decision: Use the **Reference Implementation** addresses on Base Sepolia
- They have ALL THREE registries including Validation
- They're already live on Base Sepolia
- They're 100% spec compliant (79/79 tests)
- When hackathon publishes their own, we just swap addresses in .env

### Action: Update our config.ts defaults

---

## 2. REGISTRATION JSON — SPEC vs OURS

### Spec requires:
```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Actura",
  "description": "...",
  "image": "...",
  "services": [
    { "name": "web", "endpoint": "https://..." },
    { "name": "MCP", "endpoint": "https://...", "version": "2025-06-18" },
    { "name": "A2A", "endpoint": "https://...", "version": "0.3.0" }
  ],
  "x402Support": false,
  "active": true,
  "registrations": [
    { "agentId": N, "agentRegistry": "eip155:84532:{identityRegistry}" }
  ],
  "supportedTrust": ["reputation", "crypto-economic"]
}
```

### Our current buildRegistrationJson() uses:
```json
{
  "name": "Actura",
  "description": "...",
  "image": "...",
  "endpoints": {
    "mcp": "...",
    "a2a": "...",
    "dashboard": "..."
  }
}
```

### Gaps:
1. Missing `"type"` field (MUST)
2. `endpoints` is wrong format — should be `"services"` array with `{name, endpoint, version}`
3. Missing `"x402Support"`
4. Missing `"active"`
5. Missing `"registrations"` array
6. Missing `"supportedTrust"`

---

## 3. REPUTATION — SPEC vs OURS

### Spec `giveFeedback()`:
```solidity
function giveFeedback(
  uint256 agentId,
  int128 value,          // NOT uint8! It's int128 with decimals
  uint8 valueDecimals,   // 0-18
  string tag1,           // e.g. "tradingYield"
  string tag2,           // e.g. "day" or "week"
  string endpoint,       // OPTIONAL
  string feedbackURI,    // OPTIONAL IPFS URI
  bytes32 feedbackHash   // OPTIONAL keccak256 of feedbackURI content
) external
```

### Our current `giveFeedback()`:
```solidity
function giveFeedback(
  uint256 agentId,
  uint8 score,           // WRONG TYPE — should be int128
  bytes32 tag,           // WRONG — should be string tag1
  string feedbackUri,    // OK but missing tag2, endpoint
  bytes32 feedbackHash,
  bytes feedbackAuth     // REMOVED in v1.0 spec!
) external
```

### Critical Gaps:
1. `score` is `uint8` — spec uses `int128 value` + `uint8 valueDecimals`
2. Single `tag` as bytes32 — spec uses TWO string tags (`tag1`, `tag2`)
3. Missing `endpoint` parameter
4. `feedbackAuth` was REMOVED in the v1.0 spec — feedback is now open (anyone can give it)
5. But spec says: "The feedback submitter MUST NOT be the agent owner" — self-feedback is blocked

### Our feedback-auth.ts is based on the OLD spec where agents pre-authorized clients.
The NEW spec does NOT require pre-authorization — anyone can call giveFeedback().
Self-feedback from the agent owner IS blocked by the contract.

### Action: We CANNOT self-report reputation. We need external feedback OR a separate address.

---

## 4. VALIDATION — SPEC vs OURS

### Spec `validationRequest()`:
```solidity
function validationRequest(
  address validatorAddress,  // The validator contract
  uint256 agentId,
  string requestURI,         // IPFS URI to validation data
  bytes32 requestHash        // keccak256 of request payload
) external
```

### Spec `validationResponse()`:
```solidity
function validationResponse(
  bytes32 requestHash,
  uint8 response,            // 0-100 score (0=fail, 100=pass)
  string responseURI,        // OPTIONAL evidence URI
  bytes32 responseHash,      // OPTIONAL
  string tag                 // OPTIONAL categorization
) external
```

### Key insight: `validationResponse()` must be called by the `validatorAddress` specified in the request.
The Validation Registry "prevents agents from validating their own work" in the RI.

### Our approach: We need a SEPARATE validator address/contract.
Options:
1. Use a second wallet as our "validator" — signs off on trade artifacts
2. Deploy a simple ValidatorContract that auto-validates based on risk check results
3. Skip validation and focus on reputation + identity (validation is "still under active update")

### Recommendation: Option 1 — second wallet. Simple, compliant, demonstrates the flow.

---

## 5. IDENTITY — SPEC vs OURS

### Spec `register()`:
```solidity
// Three overloads:
function register(string agentURI) external returns (uint256 agentId)
function register(string agentURI, MetadataEntry[] metadata) external returns (uint256 agentId)
function register() external returns (uint256 agentId)
```

### Our identity.ts uses:
```typescript
register(tokenURI) — matches first overload ✅
```

### Metadata:
- `setMetadata(agentId, "agentName", bytes)` — OK ✅
- `setAgentWallet()` requires EIP-712 signature proof — we have this but format needs checking
- `agentWallet` is reserved key and auto-set to owner on registration

### Our implementation is close but needs:
1. Use `setAgentURI()` not `setTokenURI()` for updates
2. Our metadata key "wallet" should be custom — `agentWallet` is auto-set

---

## 6. HACKATHON-SPECIFIC INFRASTRUCTURE

The hackathon mentions:
- **Capital Vault** — claim sandbox sub-account
- **Risk Router** — submit TradeIntents, enforces limits
- **Leaderboard** — auto-published by LabLab

These are NOT standard ERC-8004 — they're hackathon-specific contracts.
We MUST wait for the hackathon to publish:
- Risk Router address and ABI
- Capital Vault address and ABI
- Exact TradeIntent schema they expect

Our executor.ts is structured correctly to integrate these when available.

---

## 7. PRIORITY FIXES

### Must fix before hackathon:

1. **Registration JSON format** — align with spec `services` array + required fields
2. **Contract addresses** — use RI addresses for Base Sepolia
3. **Reputation ABI** — update to v1.0 `giveFeedback(agentId, int128, uint8, string, string, string, string, bytes32)`
4. **Drop self-feedback** — use a second wallet address for validation/feedback
5. **Validation flow** — request with separate validator address, respond from that address
6. **Registration file** — add `type`, `services`, `registrations`, `supportedTrust`, `active`

### Nice to have:
7. Deploy a simple auto-validator contract
8. Subgraph/indexer for our own dashboard
9. TEE attestation integration (bonus prize track)

---

## 8. UPDATED CONTRACT ADDRESSES FOR .env

```
# Reference Implementation (live on Base Sepolia)
IDENTITY_REGISTRY=0x7177a6867296406881E20d6647232314736Dd09A
REPUTATION_REGISTRY=0xB5048e3ef1DA4E04deB6f7d0423D06F63869e322
VALIDATION_REGISTRY=0x662b40A526cb4017d947e71eAF6753BF3eeE66d8

# Chain
RPC_URL=https://sepolia.base.org
CHAIN_ID=84532

# Hackathon (TBD — wait for organizers)
RISK_ROUTER_ADDRESS=
CAPITAL_VAULT_ADDRESS=
```
