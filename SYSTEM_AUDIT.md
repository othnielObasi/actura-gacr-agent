# ACTURA System Audit Report

**Date:** 2026-03-09
**Scope:** Full codebase audit — 34 source files reviewed
**Auditor:** Automated deep analysis of agent loop, risk engine, circuit breaker, supervisory agent, data feeds, trust/reputation, security, and dashboard layers.

---

## Executive Summary

This audit identified **11 issues** (4 critical, 4 high, 3 medium) across the Actura trading agent system. The **root cause** of the observed symptom — *system goes offline during profitable periods and returns with losses* — was a **3-bug deadlock** between the circuit breaker, supervisory meta-agent, and restart reconciliation logic. All 11 issues have been **fixed and verified** with passing tests.

---

## Root Cause: The Offline-Loss Deadlock

The user observed: "the system goes offline when it's about to make profit, then comes back with a loss."

**What was actually happening:**

```
1. Agent trading profitably
2. Network/crash → Agent goes offline
3. While offline: stop-losses breach, positions auto-close at loss
4. Agent restarts, reconciles offline stops → more realized losses
5. Realized losses trip daily loss limit → circuit breaker TRIPPED
6. Circuit breaker enters COOLING → extends cooldown forever (BUG #1)
7. Peak capital frozen during COOLING → drawdown looks worse (BUG #2)
8. Supervisory agent sees 6% drawdown → permanent pause (BUG #3)
9. Market recovers (the profitable move)
10. System CAN'T trade — locked out by all three layers
11. By the time system resumes, profit is gone → records a loss
```

---

## Issues Found & Fixes Applied

### CRITICAL-001: Circuit Breaker Infinite Cooldown Extension

| | |
|---|---|
| **File** | `src/risk/circuit-breaker.ts` |
| **Severity** | CRITICAL |
| **Status** | FIXED |

**Problem:** When the cooldown period expired but loss thresholds were still breached, the breaker set `cooldownCycles = 1` in an infinite loop. Since no trades can execute during COOLING, capital can never recover, so the condition never improves. This is a deadlock.

**Fix:** Added a `maxCooldownExtensions` counter (default: 3). After 3 extensions without improvement, the breaker force-rearms to allow recovery trades. This breaks the deadlock while still providing protection — the breaker can re-trip if losses continue.

**Impact:** Eliminates the deadlock that prevented the system from ever resuming trading after offline-induced losses.

---

### CRITICAL-002: Peak Capital Frozen During COOLING

| | |
|---|---|
| **File** | `src/risk/circuit-breaker.ts` |
| **Severity** | CRITICAL |
| **Status** | FIXED |

**Problem:** Peak capital only updated in ARMED state. During COOLING, even if the market recovered and effective capital increased, the drawdown calculation still used the old (higher) peak, making drawdown appear worse than reality.

**Fix:** Now updates peak capital in both ARMED and COOLING states. Still frozen during TRIPPED (which is correct — one cycle only).

**Impact:** Drawdown calculations now reflect actual market recovery, allowing the system to exit COOLING sooner when conditions genuinely improve.

---

### CRITICAL-003: Supervisory Agent Unrecoverable Pause

| | |
|---|---|
| **File** | `src/agent/supervisory-meta-agent.ts` |
| **Severity** | CRITICAL |
| **Status** | FIXED |

**Problem:** At 6% drawdown, supervisory set `canTrade = false` unconditionally. But when all positions are already closed (losses realized), the **only** way to reduce drawdown is to trade profitably. This created a deadlock: can't trade → can't recover → stays paused forever.

**Fix:** Now distinguishes between:
- **Open positions at risk** (6%+ drawdown): full pause (correct behavior — protect remaining capital)
- **All positions closed, losses realized** (6-8% drawdown): allow heavily throttled recovery trades (double-downgraded tier)
- **8%+ drawdown**: hard pause regardless (safety net)

**Impact:** System can now recover from realized losses through small, controlled recovery trades instead of being permanently locked.

---

### CRITICAL-004: Restart Reconciliation Cascades Into Daily Loss Limit

| | |
|---|---|
| **File** | `src/agent/index.ts` |
| **Severity** | CRITICAL |
| **Status** | FIXED |

**Problem:** After restart, the stop-loss reconciliation closed positions at loss prices. These realized losses immediately counted against the **new session's** daily loss limit, tripping the circuit breaker on cycle 1 before the agent had any chance to trade.

**Fix:** Added `riskEngine.resetDaily()` call after reconciliation completes. The new session starts with a clean daily P&L slate. The losses are still recorded in overall drawdown (which is correct), but don't lock out the daily loss limit on restart.

**Impact:** Agent can immediately begin recovery trading after restart instead of being locked out by stale daily P&L data.

---

### HIGH-001: Scheduler Signal Handler Stacking

| | |
|---|---|
| **File** | `src/agent/scheduler.ts` |
| **Severity** | HIGH |
| **Status** | FIXED |

**Problem:** Each call to `start()` registered new SIGINT/SIGTERM handlers without removing old ones. If the scheduler was restarted (e.g., after error cooldown), handlers stacked up, causing multiple simultaneous shutdown attempts and potential race conditions in state persistence.

**Fix:** Added a `signalHandlersRegistered` flag. Handlers are only registered on first `start()` call.

**Impact:** Prevents duplicate shutdown sequences that could corrupt persisted state or cause double-save of positions.

---

### HIGH-002: Trading on Stale Price Data

| | |
|---|---|
| **File** | `src/data/live-price-feed.ts`, `src/agent/index.ts` |
| **Severity** | HIGH |
| **Status** | FIXED |

**Problem:** When both CoinGecko and DeFiLlama failed 5+ consecutive times, `getLiveFeedStatus().healthy` became false, but the agent continued trading using the last known price with noise added. This could mean trading on data hours old.

**Fix:**
1. Added `shouldHaltTrading` flag to live feed status (true when `consecutiveFailures >= MAX_CONSECUTIVE_FAILURES`)
2. Added a pre-check at the start of `runCycle()` that skips the cycle entirely when live feed is stale
3. Added explicit error log when the threshold is hit

**Impact:** Agent no longer executes trades based on outdated price data. Cycles resume automatically when live feed recovers.

---

### HIGH-003: CORS Wildcard Allows Any Origin

| | |
|---|---|
| **File** | `src/dashboard/server.ts` |
| **Severity** | HIGH |
| **Status** | FIXED |

**Problem:** `Access-Control-Allow-Origin: *` allowed any website to call dashboard API endpoints from a browser. An attacker could create a page that, when visited by the operator, calls `/api/operator/pause` or `/api/operator/emergency-stop` or reads positions/capital data.

**Fix:** Replaced wildcard CORS with localhost-only origin matching: `^https?://(localhost|127\.0\.0\.1)(:\d+)?$`. Also added proper `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers`.

**Impact:** Dashboard API can no longer be exploited via cross-origin requests from malicious websites.

---

### HIGH-004: State Lost on Crash Between Position Open and Next Save

| | |
|---|---|
| **File** | `src/agent/index.ts` |
| **Severity** | HIGH |
| **Status** | FIXED |

**Problem:** After opening a position, state was only persisted every 10 cycles. If the agent crashed between opening a position and the next save, the position was lost from local tracking but could still be open on-chain.

**Fix:** Added `persistState()` call immediately after every position open.

**Impact:** Positions are always persisted to disk. On restart, reconciliation correctly sees all open positions, preventing "phantom" positions that exist on-chain but not in the agent's state.

---

### MEDIUM-001: NaN Confidence Propagation

| | |
|---|---|
| **File** | `src/strategy/signals.ts` |
| **Severity** | MEDIUM |
| **Status** | FIXED |

**Problem:** If indicator calculations produced NaN (e.g., from insufficient data or division by zero in SMA calculations), the NaN propagated through the sigmoid/clamp chain into confidence. Downstream checks like `confidence >= 0.12` silently return false for NaN, but the NaN value could leak into artifacts and dashboards.

**Fix:** Added a `Number.isFinite()` guard after confidence calculation. Returns a NEUTRAL signal with explicit `NAN_GUARD` name if NaN is detected.

**Impact:** Prevents silent signal corruption and makes debugging easier when indicator data is incomplete.

---

### MEDIUM-002: Recovery Streak Game-able via Zero-Delta Micro-Trades

| | |
|---|---|
| **File** | `src/trust/reputation-evolution.ts` |
| **Severity** | MEDIUM |
| **Status** | FIXED |

**Problem:** Recovery streak incremented when `trustDelta >= 0` (including exactly zero). An agent in recovery could accumulate streak points by simply not losing trust score, without genuinely improving. Micro-trades with near-zero impact counted as "recovery progress."

**Fix:** Changed condition from `trustDelta >= 0` to `trustDelta > 0`. Recovery streak now only increments on genuine positive trust score improvements.

**Impact:** Trust recovery mechanism now requires actual performance improvement, not just stasis.

---

### MEDIUM-003: Live Feed Stale Data Not Logged at Threshold

| | |
|---|---|
| **File** | `src/data/live-price-feed.ts` |
| **Severity** | MEDIUM |
| **Status** | FIXED |

**Problem:** When consecutive failures hit the MAX_CONSECUTIVE_FAILURES threshold (5), only the first 2 failures produced warnings. The critical threshold crossing was silent.

**Fix:** Added explicit `log.error()` when `consecutiveFailures === MAX_CONSECUTIVE_FAILURES`, clearly marking the stale-data condition in logs.

**Impact:** Operators can now immediately see in logs when the live feed has become unreliable.

---

## Known Pre-Existing Issues (Not Fixed — Out of Scope)

These were identified during the audit but are lower priority and not directly related to the reported symptom:

| # | Issue | File | Note |
|---|-------|------|------|
| 1 | MCP tools.ts type errors (5 TS errors) | `src/mcp/tools.ts` | Pre-existing, causes MCP surface test to fail |
| 2 | Global counter atomicity (checkpoint IDs, artifact IDs) | `src/trust/checkpoint.ts`, `src/trust/artifact-emitter.ts` | Low risk — Node.js is single-threaded and scheduler doesn't overlap cycles |
| 3 | Oracle integrity doesn't detect multi-candle flash crashes | `src/security/oracle-integrity.ts` | Each candle checked independently; a crash spread across 2 candles (e.g., 5% each) passes the 8% single-bar limit |
| 4 | Execution simulator edge threshold hard-coded | `src/chain/execution-simulator.ts` | 0.01 bps threshold not configurable via ENV |

---

## Test Results After Fixes

```
✅ Strategy & Indicators — PASSED
✅ Risk Engine — PASSED
✅ Validation Artifacts — PASSED
✅ Chain Integration — PASSED
✅ Agent Mandate Engine — PASSED
✅ Execution Simulator — PASSED
✅ Oracle Integrity Guard — PASSED
✅ Trust Policy Scorecard — PASSED
✅ Reputation Evolution — PASSED
✅ Trust Recovery Mode — PASSED
✅ Supervisory Meta-Agent — PASSED
✅ Operator Control — PASSED
✅ Regime Governance — PASSED
✅ Performance Metrics — PASSED

14/14 component tests PASSED
0 new TypeScript compilation errors introduced
```

---

## Files Modified

| File | Changes |
|------|---------|
| `src/risk/circuit-breaker.ts` | Max cooldown extensions, peak capital update in COOLING, extension counter reset |
| `src/agent/supervisory-meta-agent.ts` | Recovery-aware drawdown logic, 3-tier pause/throttle/hard-pause |
| `src/agent/index.ts` | Post-reconciliation daily reset, stale feed check, persist after position open |
| `src/agent/scheduler.ts` | Signal handler deduplication |
| `src/data/live-price-feed.ts` | `shouldHaltTrading` flag, threshold logging |
| `src/dashboard/server.ts` | CORS restricted to localhost |
| `src/strategy/signals.ts` | NaN confidence guard |
| `src/trust/reputation-evolution.ts` | Recovery streak requires positive delta |

---

## How These Fixes Improve the System

1. **Eliminates the offline-loss deadlock:** The three compounding bugs (infinite cooldown, frozen peak, unrecoverable pause) no longer block recovery. The agent can now trade its way back from realized losses.

2. **Better crash resilience:** Positions are persisted immediately after opening, and restart reconciliation no longer poisons the new session's daily P&L limits.

3. **No more trading on stale data:** If the live feed fails repeatedly, trading halts automatically instead of operating on outdated prices.

4. **Tighter security:** Dashboard API no longer exploitable via cross-origin requests from external websites.

5. **More accurate risk metrics:** Drawdown calculations update during recovery periods, giving the supervisory agent accurate data to make unblock decisions.

6. **Genuine trust recovery:** Agents must demonstrate real performance improvement to exit recovery mode, preventing gaming via micro-trades.
