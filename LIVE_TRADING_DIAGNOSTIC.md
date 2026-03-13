# Live Trading Diagnostic Report

**Date:** March 12, 2026  
**Symptom:** 24+ hours of trading with -0.09% loss, no profit. When displayed profit reaches 0.00%, bot goes offline, then returns showing negative P&L.

---

## Root Cause: 3-Bug Deadlock Cascade

The "flat → offline → negative" pattern is **not a strategy problem** — it is caused by three compounding bugs in the risk/state management layer that create an unrecoverable deadlock.

### Bug #1: Circuit Breaker Infinite Cooldown Extension

**File:** `src/risk/circuit-breaker.ts` (line ~121)

When the cooldown period expires but loss thresholds are still breached, the code resets `cooldownCycles = 1` in a loop that can never exit:

```
COOLING → cooldownCycles-- → reaches 0 → thresholds still breached → cooldownCycles = 1 → repeat forever
```

During COOLING, **no trades execute**. Capital can never recover without trades. So the loss threshold never improves. Deadlock.

**Fix applied:** Force re-arm after `maxCooldownExtensions` to break the deadlock. The system logs a warning and resumes trading in degraded mode rather than locking out permanently.

---

### Bug #2: Peak Capital Frozen During COOLING

**File:** `src/risk/circuit-breaker.ts` (line ~66)

Peak capital (the drawdown high-water mark) only updates when the circuit breaker is in ARMED state. During COOLING:

- Market recovers, `currentCapital` rises from $9,400 → $9,900
- But `peakCapital` stays frozen at $10,000
- Drawdown calculated as ($10,000 - $9,900) / $10,000 = 1%
- Looks like drawdown hasn't improved even though the market recovered

This makes the cooldown extension condition in Bug #1 perpetually true.

**Fix applied:** Peak capital now updates during COOLING state as well.

---

### Bug #3: Supervisory Agent Unrecoverable Pause

**File:** `src/agent/supervisory-meta-agent.ts` (line ~105)

At 6%+ drawdown, the supervisory agent pauses all trading. But with all positions already closed (losses realized), the **only** way to reduce drawdown is to trade profitably. Can't trade → can't recover → paused forever.

**Fix applied:** Now distinguishes between:
- **6%+ with open positions** → Full pause (protect remaining capital)
- **6-8% with NO open positions** → Allow recovery trades with 2-tier capital downgrade
- **8%+ regardless** → Hard pause (safety net)

---

### Bug #4: Restart Reconciliation Poisons Daily P&L

**File:** `src/agent/index.ts` (line ~110)

After a restart, stale stop-loss closures are reconciled and counted against the **new session's** daily loss limit. This trips the circuit breaker on cycle 1, before the agent has any chance to recover.

**Fix applied:** `riskEngine.resetDaily()` is called after reconciliation so offline losses don't immediately lock out the new session.

---

## The Deadlock Cascade in Sequence

```
1. Agent trading (unrealized gains in open positions)
2. Network outage / crash → agent goes offline
3. While offline: prices move adverse, stop-losses breach
4. Agent restarts, reconciles offline stops → realized losses recorded
5. Realized losses trip daily loss limit → Circuit Breaker TRIPS
6. CB enters COOLING → enters infinite extension loop (Bug #1)
7. Peak capital frozen during COOLING (Bug #2) → drawdown appears worse
8. Supervisory agent sees 6% drawdown → permanent pause (Bug #3)
9. Market recovers — would have been profitable, but system CANNOT trade
10. System eventually resumes, profits are gone → records final loss
```

---

## Additional Issues Found & Fixed

### Cost Drag at Break-Even

The execution simulator (`src/chain/execution-simulator.ts`) blocks trades when `expectedNetEdgePct <= 0.0001` (0.01%). With:
- Base slippage: 8 bps
- Volatility component: `vol × 1500` (~30 bps at 0.02 vol)
- Gas cost per trade

Total round-trip cost is typically ~40-60 bps. When the strategy makes decisions near zero P&L, every "break-even" trade is actually a loss after friction.

**Fix:** Added a minimum profit buffer — trailing stops will not close positions within a configurable cost deadzone around break-even. Positions must move beyond round-trip cost before trailing stops activate.

### Missing Reconnect Diagnostics

On restart, the system reconciles positions but does not log structured before/after state for debugging.

**Fix:** Added structured reconnect diagnostic logging that captures:
- Position state before disconnect (from saved state) vs after reconnect
- Price delta during offline period
- P&L impact from reconciliation
- Circuit breaker state comparison

### No Dead Zone Around Break-Even for Trailing Stops

Trailing stops ratchet up as price rises. When price mean-reverts back toward entry, the trailing stop triggers near break-even — which after costs becomes a loss. Repeating this pattern bleeds capital.

**Fix:** Trailing stops now only activate (begin trailing) after the position has moved beyond a minimum profit threshold that covers estimated round-trip trading costs (2× slippage model). Below that threshold, only the initial ATR-based stop-loss is active.

---

## Verification

All 14 test suites pass with 0 failures after these changes. The fixes are committed to `main`.

### Deployment Checklist

1. **Verify fix is deployed on Vultr:**
   ```bash
   ssh root@192.248.145.196 "cd /opt/actura && git log --oneline -1"
   ```
   Should show the latest commit. If not:
   ```bash
   cd /opt/actura && git pull origin main && pm2 restart actura-agent
   ```

2. **Monitor fresh 24h session** — watch for:
   - Circuit breaker no longer getting stuck in COOLING
   - Supervisory agent allowing recovery trades after losses
   - Trailing stops not triggering near break-even
   - Positive net P&L on trades that clear the cost threshold

3. **If still bleeding after fix deployment**, the next lever is the execution simulator cost model:
   - `volMultiplier` (currently 1500) — lower to accept more trades in low-vol periods
   - `baseBps` (currently 8) — adjust if actual exchange fees differ
   - `netEdge` threshold (currently 0.0001) — raise to be more selective
