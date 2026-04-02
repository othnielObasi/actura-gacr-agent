# ACE (Agentic Context Engineering) — Implementation Plan

## Rollback Reference

**Pre-ACE baseline commit**: `7fcaa55` (main, 2026-04-01)  
**Rollback command**: `git revert --no-commit HEAD..{ace-commit} && git commit -m "rollback ACE"`  
Or hard reset: `git reset --hard 7fcaa55` (destroys all ACE changes)

---

## Part 1: Existing System Baseline (What We Have Now)

### Signal Generation (`src/strategy/signals.ts`)

Multi-factor scorecard with **hardcoded weights**:

```
alphaScore = trendScore + momentumScore + sentimentScore + crossoverBoost - meanRevPenalty

Where:
  trendScore     = directionSign × 0.6 × trendStrength    (SMA20 vs SMA50 separation)
  momentumScore  = 1.8 × ret5 + 1.1 × ret20              (5 & 20-period returns)
  crossoverBoost = 0.15                                    (on SMA crossover)
  rsiPenalty     = 0.6 × rsiPenalty                        (RSI >70 or <30)
  zExtremePenalty= 0.5 × zExtremePenalty                   (|z| >= 3)
  sentimentScore = 0.12 × composite                        (Fear/Greed + news + funding)
```

**Confidence**: `sigmoid(|alphaScore| × 2.2) × volConfidence × structureRegime.confidenceMultiplier`

### Adaptive Learning (`src/strategy/adaptive-learning.ts`)

Adjusts 3 parameters using simple threshold rules:

| Parameter | CAGE Bounds | Rule |
|-----------|------------|------|
| Stop-loss ATR multiple | [1.0, 2.5] | If stop-hit rate > 60% → widen 5%; if < 20% → tighten 5% |
| Base position size | [1%, 4%] | If win rate > 55% → increase 2.5%; if < 35% → decrease 5% |
| Confidence threshold | [5%, 30%] | If false signal rate > 50% → raise +2%; if < 25% → lower -1% |

- Runs every 10 cycles
- Requires minimum 10 trade outcomes
- 5-cycle cooldown between adaptations
- Context bias: Beta(1,1) posterior by regime + direction (±12% max)

### Regime Governance (`src/strategy/regime-governance.ts`)

4 volatility profiles with hysteresis switching:

| Profile | SL (ATR×) | TP (ATR×) | Position % | Conf Threshold |
|---------|-----------|-----------|------------|----------------|
| LOW_VOL | 1.2 | 1.8 | 2.2% | 5% |
| NORMAL | 1.3 | 1.8 | 2.0% | 8% |
| HIGH_VOL | 1.5 | 2.0 | 1.6% | 14% |
| EXTREME | 1.8 | 2.5 | 1.2% | 22% |

### AI Reasoning (`src/strategy/ai-reasoning.ts`)

- 3-tier LLM failover: Claude → Gemini → OpenAI → deterministic fallback
- **Read-only**: explains decisions, does NOT influence them
- Produces: marketContext, tradeRationale, riskNarrative, confidenceFactors, watchItems, summary
- Called every cycle, output stored in trade artifacts

### Edge Filter (`src/strategy/edge-filter.ts`)

- Requires expected edge > 1.5× estimated cost (10bps default)
- Blocks trades where ATR-based expected move is too small relative to costs

### Current Live Performance (as of 2026-04-02)

| Metric | Value |
|--------|-------|
| Total trades | 20 |
| Win rate | 40% |
| Total PnL | -$5.32 |
| Sharpe | -0.161 |
| Sortino | -0.206 |
| Max drawdown | 0.09% |
| Profit factor | 0.64 |
| Avg win | +$1.18 |
| Avg loss | -$1.23 |
| Capital | $9,994.68 |
| Current regime | LOW_VOL |

### Key Problem

Signal weights are static. Adaptive learning adjusts execution parameters (SL/sizing/threshold) but has zero influence on **which signals are good**. The system cannot learn "SHORT signals in low-vol with positive ret5 consistently lose."

---

## Part 2: ACE Implementation Plan

### Architecture

```
Trade Outcomes ──────────────────────────────────────────►  ACE Observer
(already collected by recordTradeOutcome)                      │
                                                               │ (every 10 cycles,
                                                               │  min 5 new outcomes)
                                                               ▼
                                                     LLM Reflection (Gemini)
                                                               │
                                          ┌────────────────────┼────────────────────┐
                                          ▼                    ▼                    ▼
                                     Playbook Rules      Weight Adjustments    Context Prefix
                                     (.actura/            (bounded by           (injected into
                                      playbook.jsonl)      WEIGHT_CAGE)          ai-reasoning
                                          │                    │                  prompt)
                                          ▼                    ▼                    
                                     Applied as          Fed into Adaptive     
                                     signal filters      Learning layer        
                                     in generateSignal()                       
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/strategy/ace-engine.ts` | Core ACE: observation, LLM reflection, playbook management, weight recommendations |

### Files to Modify

| File | Change |
|------|--------|
| `src/strategy/adaptive-learning.ts` | Accept ACE weight recommendations; apply within extended CAGE bounds |
| `src/strategy/signals.ts` | Read ACE weight overrides instead of hardcoded values |
| `src/strategy/ai-reasoning.ts` | Inject playbook context prefix into LLM prompt |
| `src/agent/index.ts` | Wire ACE into the cycle (call after recordTradeOutcome) |
| `src/dashboard/server.ts` | Add `/api/ace/playbook` and `/api/ace/status` endpoints |

### ACE Engine Design (`src/strategy/ace-engine.ts`)

#### Data Structures

```typescript
interface ACEReflection {
  timestamp: string;
  cycleNumber: number;
  tradesAnalyzed: number;
  insights: string[];              // "SHORT in LOW_VOL lost 4/5 when ret5 > 0"
  playbookRules: PlaybookRule[];   // Extracted actionable rules
  weightRecommendations: WeightRec[];  // Bounded weight changes
  contextPrefix: string;           // Summary for AI reasoning prompt
}

interface PlaybookRule {
  id: string;                      // Unique rule ID
  rule: string;                    // Human-readable: "Avoid SHORT when ret5 > 1% and regime = LOW_VOL"
  condition: {                     // Machine-parseable condition
    regime?: string;
    direction?: string;
    indicator?: string;
    threshold?: number;
    comparator?: 'gt' | 'lt' | 'eq';
  };
  action: 'BLOCK' | 'REDUCE_CONFIDENCE' | 'BOOST_CONFIDENCE';
  magnitude: number;               // 0-0.5 (confidence modifier)
  evidence: string;                // "Based on 5 trades: 1W 4L"
  createdAt: string;
  expiresAfter: number;            // trades until re-evaluation
}

interface WeightRec {
  parameter: string;               // 'trend' | 'ret5' | 'ret20' | 'crossover' | 'rsi' | 'zscore' | 'sentiment'
  currentValue: number;
  recommendedValue: number;
  reasoning: string;
}
```

#### Weight CAGE (extends existing CAGE concept)

```typescript
const WEIGHT_CAGE = {
  trend:      { min: 0.0, max: 2.0, default: 0.6 },
  ret5:       { min: 0.0, max: 4.0, default: 1.8 },
  ret20:      { min: 0.0, max: 3.0, default: 1.1 },
  crossover:  { min: 0.0, max: 0.5, default: 0.15 },
  rsi:        { min: 0.0, max: 2.0, default: 0.6 },
  zscore:     { min: 0.0, max: 2.0, default: 0.5 },
  sentiment:  { min: 0.0, max: 0.5, default: 0.12 },
  // Max change per reflection cycle
  maxChangePerCycle: 0.3,  // max 30% change per parameter per cycle
} as const;
```

#### LLM Reflection Prompt (sent to Gemini)

The prompt will include:
1. Last N trade outcomes with full feature vectors (regime, direction, ret5, ret20, RSI, ADX, zscore, sentiment, confidence, PnL)
2. Current scorecard weights
3. Current playbook rules
4. Current win rate, profit factor, Sharpe

The LLM responds with structured JSON:
- `insights[]`: plain-language observations
- `playbookRules[]`: new or updated rules
- `weightRecommendations[]`: suggested weight changes with reasoning

#### Playbook Persistence

- Stored in `.actura/playbook.jsonl` (append-only, one JSON per line)
- Loaded on startup, survives restarts
- Rules have `expiresAfter` trade count — stale rules auto-expire
- Max 20 active rules at any time

#### Integration Points

1. **Signal generation** (`signals.ts`):
   - Read current weights from ACE instead of hardcoded constants
   - After computing signal, check playbook rules for BLOCK/REDUCE/BOOST actions
   - Apply confidence modifications from matching rules

2. **Adaptive learning** (`adaptive-learning.ts`):
   - ACE weight recommendations feed into a new `applyACEWeights()` function
   - Bounded by WEIGHT_CAGE (same pattern as existing CAGE)
   - Logged as adaptation artifacts

3. **AI reasoning** (`ai-reasoning.ts`):
   - Prepend playbook summary to the reasoning prompt
   - "The agent has learned these trading rules from past performance: ..."
   - Makes AI reasoning contextually smarter over time

4. **Agent loop** (`index.ts`):
   - After `runAdaptation()` (every 10 cycles), call `runACEReflection()` if enough new outcomes
   - Minimum 5 new outcomes since last reflection
   - Reflection is async (LLM call) but non-blocking to the cycle

### Dashboard Endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/ace/playbook` | Current active playbook rules + stats |
| `GET /api/ace/status` | ACE state: last reflection time, weight history, reflection count |

### Safety Guarantees

1. **CAGE bounds are immutable** — ACE cannot set weights outside WEIGHT_CAGE ranges
2. **Max 30% change per cycle** — prevents wild swings from single reflection
3. **Playbook rules only modify confidence** — they cannot bypass risk checks, circuit breaker, or mandate
4. **All changes are artifacts** — every weight change, every playbook rule is logged with reasoning
5. **LLM failure = no change** — if Gemini fails, weights stay as-is (same pattern as AI reasoning fallback)
6. **Rule expiration** — stale rules auto-expire after N trades to prevent lock-in on outdated patterns
7. **Max 20 active rules** — prevents rule accumulation from overwhelming signal generation

### Rollback Strategy

| Scenario | Action |
|----------|--------|
| ACE makes performance worse | Set `ACE_ENABLED=false` env var → falls back to hardcoded weights |
| Bad playbook rule | Delete `.actura/playbook.jsonl` → fresh start |
| Need full rollback | `git reset --hard 7fcaa55` → pre-ACE code |
| Partial rollback | Individual files revertable — ACE is additive, doesn't delete existing logic |

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ACE_ENABLED` | `true` | Master switch for ACE |
| `ACE_MIN_OUTCOMES` | `5` | Minimum new outcomes before triggering reflection |
| `ACE_MAX_RULES` | `20` | Maximum active playbook rules |
| `ACE_REFLECTION_COOLDOWN` | `10` | Minimum cycles between reflections |

### Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Win rate | 40% | >50% |
| Profit factor | 0.64 | >1.0 |
| Sharpe | -0.161 | >0 |
| Signal quality | Unknown | Measurable via playbook rule hit rate |

### Implementation Order

1. Create `ace-engine.ts` — core engine with LLM reflection + playbook
2. Modify `signals.ts` — read ACE weights + apply playbook rules
3. Modify `adaptive-learning.ts` — accept ACE weight recommendations
4. Modify `ai-reasoning.ts` — inject playbook context prefix
5. Modify `index.ts` — wire ACE into cycle loop
6. Modify `server.ts` — add dashboard endpoints
7. Build, test locally, deploy to VPS
