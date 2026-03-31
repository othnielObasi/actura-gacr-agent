# Actura — Issues & Fixes Log

**Agent ID:** 338  
**Hackathon:** AI Trading Agents (March 30 – April 12, 2026, $55K prize pool)  
**Track:** Combined (ERC-8004 + Kraken Challenge)  
**VPS:** Vultr 192.248.145.196  
**Pair:** WETH/USDC on Base Sepolia  

---

## Timeline Summary

| Date | Issue | Fix | Commit |
|------|-------|-----|--------|
| Mar 30 | SHORT-only signal bias | Removed directional bias from scorecard | `214c052` |
| Mar 30 | Validation Registry ABI mismatch | Fixed bytes32 tag encoding | `f7f6e6b` |
| Mar 30 | CryptoPanic sentiment empty/failing | Multiple endpoint & API fixes | `835d2cf`→`9a74aca`→`f1744da`→`56e3c9b` |
| Mar 30 | Gemini LLM 404 / truncated responses | Model swap + token limit fix | `707c545`, `a657d88` |
| Mar 30 | CryptoPanic 429 rate limiting | Increased cache TTL | `3482bcf` |
| Mar 31 | CryptoPanic still unreliable | Replaced with Alpha Vantage | `de4a96a` |
| Mar 31 | 0% win rate — TP unreachable | Dynamic ATR-based TP + tighter filters | `a91179f` |
| Mar 31 | Positions stuck, no profit locking | Breakeven stops + retroactive TP | `5af310f` |

---

## Issue 1: SHORT-Only Signal Bias

**Discovered:** March 30  
**Severity:** Critical  
**Commit:** `214c052`

### Problem
The signal scorecard had a built-in bias that favored SHORT signals. Every trade the agent opened was a SHORT, even when market conditions warranted LONG trades. This meant the agent could only profit when price dropped, missing all upside moves.

### Root Cause
Hardcoded directional weighting in the signal scorecard computation gave disproportionate weight to bearish indicators.

### Fix
Removed the SHORT-only bias from the signal scorecard so LONG and SHORT signals are evaluated symmetrically based on actual market data.

---

## Issue 2: Validation Registry ABI Mismatch

**Discovered:** March 30  
**Severity:** High  
**Commit:** `f7f6e6b`

### Problem
On-chain validation artifact submissions to the ERC-8004 Validation Registry were failing silently. The contract expected a `bytes32` tag parameter, but the agent was encoding it as a `string`.

### Root Cause
The Solidity ABI for the Validation Registry used `bytes32` for the tag field, but the TypeScript ethers.js call was passing a plain string without proper encoding.

### Fix
Updated the tag encoding to convert the string to a proper `bytes32` value using ethers `encodeBytes32String`, matching the on-chain contract interface.

---

## Issue 3: CryptoPanic Sentiment Feed Failures

**Discovered:** March 30  
**Severity:** High  
**Commits:** `835d2cf`, `f1744da`, `9a74aca`, `56e3c9b`, `3482bcf`

### Problem
The CryptoPanic news sentiment feed went through multiple failure modes:
1. **Wrong API endpoint** — initial integration used incorrect URL path
2. **Empty results** — `filter=hot` returned no articles; needed `kind=news`
3. **API version mismatch** — Developer v2 endpoint worked differently than v1
4. **429 Rate Limiting** — API calls exceeded CryptoPanic's rate limits, returning HTTP 429 errors

### Root Cause
CryptoPanic's API documentation was inconsistent, and the free tier had aggressive rate limits (~1 request/minute). Each fix uncovered the next problem.

### Fixes Applied (chronologically)
1. Added CryptoPanic API key for authentication (`835d2cf`)
2. Fixed v1 endpoint path and added debug logging (`f1744da`)
3. Switched to Developer v2 API endpoint (`9a74aca`)
4. Changed from `filter=hot` to `kind=news` for consistent results (`56e3c9b`)
5. Increased cache TTL to 15 minutes to stay within rate limits (`3482bcf`)

### Final Resolution
CryptoPanic was ultimately **replaced entirely** with Alpha Vantage (see Issue 5) due to ongoing reliability problems.

---

## Issue 4: Gemini LLM 404 / Truncated Responses

**Discovered:** March 30  
**Severity:** Medium  
**Commits:** `707c545`, `a657d88`

### Problem
The AI reasoning module (used for trade explanation generation) was failing in two ways:
1. `gemini-2.0-flash` model returned HTTP 404 — model endpoint didn't exist
2. When responses did come back, JSON arrays were truncated mid-parse, causing crashes

### Root Cause
- Google had not yet deployed `gemini-2.0-flash`; only `gemini-2.5-flash` was available
- The Gemini API's thinking/planning mode was consuming most of the token budget, leaving insufficient tokens for the actual response

### Fix
1. Switched to `gemini-2.5-flash` for headline classification
2. Increased Gemini token limit and disabled "thinking" mode to allocate full budget to output
3. Added graceful handling for truncated JSON arrays

---

## Issue 5: CryptoPanic Replaced with Alpha Vantage

**Discovered:** March 31  
**Severity:** High  
**Commit:** `de4a96a`

### Problem
Even after all the CryptoPanic fixes, the feed remained unreliable:
- Inconsistent article counts
- Rate limiting still triggered occasionally
- Free tier limitations made it unsuitable for production 5-minute cycle polling

### Fix
Completely replaced CryptoPanic with **Alpha Vantage News Sentiment API**:
- Pre-scored sentiment (relevance + sentiment scores per article)
- 50 articles per request, 31 crypto-relevant scores
- Reliable API with no rate limiting issues at our polling frequency
- Sentiment weights: Fear & Greed (0.40), Alpha Vantage news (0.35), Kraken funding (0.25)

### Verification
Production confirmed: 50 articles, 31 crypto scores, 22 bullish / 9 bearish — running stably since cycle 203+.

---

## Issue 6: 0% Win Rate — Take-Profit Unreachable

**Discovered:** March 31  
**Severity:** Critical  
**Commit:** `a91179f`

### Problem
After 24+ hours of live trading (200+ cycles, 12 trades opened, 8 closed), the system had a **0% win rate**. Every single closed trade was a loss, totaling -$9.22 (-0.09% on $10K starting capital).

### Detailed Analysis

**Trade Breakdown (all 8 closed trades):**
| # | Entry | Exit | P&L | Reason |
|---|-------|------|-----|--------|
| 1 | $2,069.03 | $2,075.68 | -$0.34 | stop_loss |
| 2 | $2,066.77 | $2,074.95 | -$0.40 | stop_loss |
| 3 | $2,034.70 | $2,061.16 | -$1.04 | reconciliation |
| 4 | $2,033.21 | $2,062.18 | -$1.14 | reconciliation |
| 5 | $2,014.31 | $2,063.89 | -$1.97 | reconciliation |
| 6 | $2,020.62 | $2,067.83 | -$4.20 | reconciliation |
| 7 | $2,021.44 | $2,023.00 | -$0.14 | stop_loss |
| 8 | $2,021.86 | $2,019.88 | -$0.004 | stop_loss |

**Key findings:**
- 90% of losses ($8.35 of $9.22) came from **reconciliation closes** — PM2 restarts during code deployments triggered the agent to close positions at stop price
- Take-profit (fixed 3%) **never hit** — in a low-volatility market with ATR ~$31, the TP target was ~$62 away, nearly unreachable
- The old 4-hour max hold was too short for low-vol markets
- Max-hold closures were mislabeled as `stop_loss`, skewing adaptive learning accuracy
- The edge filter (0.15% minimum) was too permissive, allowing thin-edge trades that became losses after costs
- Oracle staleness threshold (90 min) was too loose for production
- No multi-bar flash crash detection

### Root Cause
The **fixed 3% take-profit target** was the core issue. With ATR ~$31 and stop distance ~$46.5 (1.5× ATR), the take-profit distance was ~$62 — creating an approximately 1:1.3 risk/reward ratio where TP was nearly as far as the stop, virtually guaranteeing stops would be hit first in ranging/low-vol conditions.

### Fixes Applied (7 changes across 6 files)

**1. Dynamic ATR-Based Take-Profit** (`src/risk/engine.ts`)
- Replaced fixed 3% TP with per-position `takeProfitPrice` calculated at trade time
- TP = entry ± (regime_TP_multiplier × ATR)
- Position struct extended with `atr` and `takeProfitPrice` fields
- Fallback to 3% for legacy positions without the field

**2. Per-Regime TP Profiles** (`src/strategy/regime-governance.ts`)
- Added `takeProfitAtrMultiple` to `RegimeProfile` interface
- Initial values: LOW_VOL=1.5x, NORMAL=2.0x, HIGH_VOL=2.5x, EXTREME=3.0x
- (Later tightened in Issue 8 — see below)

**3. Multi-Bar Flash Crash Detection** (`src/security/oracle-integrity.ts`)
- Added 3-bar cumulative move check (10% threshold)
- Catches flash crashes spread across 2-3 bars that individually pass single-bar check
- >10% over 3 bars → blocker, >7% → watch

**4. Tighter Stale Data Threshold** (`src/security/oracle-integrity.ts`)
- Reduced from 90 minutes to 30 minutes
- Prevents trading on stale price data in production

**5. Stricter Edge Filter** (`src/chain/execution-simulator.ts`)
- Minimum net edge: 0.15% → 0.25%
- Minimum edge multiple: 1.5× cost → 2.0× cost
- Prevents thin-edge trades that become losses after costs

**6. Extended Max Hold** (`src/risk/engine.ts`)
- Increased from 4 hours to 12 hours (later reduced to 6h — see Issue 8)
- Gives positions more time to reach TP in low-vol markets

**7. Proper Max-Hold Close Reason** (`src/risk/engine.ts`, `src/agent/trade-log.ts`)
- Max-hold closures now report `max_hold` instead of `stop_loss`
- Added `max_hold` to the `ClosedTrade` reason union type
- Enables accurate tracking in adaptive learning metrics

---

## Issue 7: Claude API Credits Exhausted

**Discovered:** March 31  
**Severity:** Low (gracefully handled)

### Problem
Anthropic Claude API returned 400 errors: "Your credit balance is too low to access the Anthropic API."

### Impact
Every cycle logged 2 Claude retry failures before falling back to Gemini. No functional impact — the LLM fallback chain (Claude → Gemini → OpenAI) worked as designed.

### Status
Claude is skipped after 2 retries. Gemini 2.5 Pro handles all AI reasoning successfully. Not a blocker but adds ~2 seconds latency per cycle from failed retry attempts.

---

## Issue 8: Positions Stuck — No Profit Locking

**Discovered:** March 31  
**Severity:** Critical  
**Commit:** `5af310f`

### Problem
After deploying Issue 6 fixes, the 2 existing SHORT positions (opened at $2,053 and $2,052) were:
- **In profit** (~$25-29 unrealized, price at ~$2,024)
- **But their TP targets were unreachable** — even with "dynamic" TP, the 2.0× ATR multiplier put targets at ~$1,991 (same as old 3% = $62 away)
- **Trailing stops were ABOVE entry** — stop at $2,084-$2,087 would lock in a LOSS, not profit
- **Blocking both trade slots** (Pos: 2/2), preventing any new trades

The trailing stop mechanism had a fundamental flaw: even when the position moved into profit, the stop never tightened to protect those gains. The trailing distance was fixed at the full ATR-based width (~$46).

### Root Cause (Three Issues)
1. **TP multipliers too wide**: 2.0× ATR for NORMAL regime = ~$62, identical to the old 3% target — still unreachable
2. **No breakeven stop mechanism**: Trailing stop distance stayed at full ATR width regardless of how far price moved in our favor
3. **Legacy positions had no TP target**: Old positions opened before dynamic TP was implemented had `takeProfitPrice: null`, falling back to unreachable 3%

### Fixes Applied (3 files)

**1. Profit-Locking Trailing Stop Tiers** (`src/risk/engine.ts`)
As unrealized profit grows, the trailing stop distance progressively tightens:
- **>0.5% profit**: Breakeven stop — trail tightens to 95% of distance-to-entry
- **>0.8% profit**: Trail at 50% of original distance
- **>1.5% profit**: Trail at 30% of original distance (aggressive lock)
- Added guard: stops only ratchet tighter, never widen back

**2. Tighter TP Multipliers** (`src/strategy/regime-governance.ts`)
Original values were too wide (1.5×–3.0× ATR). Reduced to create achievable targets:
| Regime | Stop (ATR×) | Old TP (ATR×) | New TP (ATR×) | R:R Ratio |
|--------|-------------|---------------|---------------|-----------|
| LOW_VOL | 1.35× | 1.5× | **1.0×** | 0.74:1 |
| NORMAL | 1.50× | 2.0× | **1.2×** | 0.80:1 |
| HIGH_VOL | 1.75× | 2.5× | **1.5×** | 0.86:1 |
| EXTREME | 2.00× | 3.0× | **2.0×** | 1.00:1 |

With ATR ~$31 and NORMAL profile: TP distance = 1.2 × $31 = **$37.97** (vs old $62).

**3. Retroactive TP Assignment** (`src/agent/index.ts`)
- On startup, legacy positions without `takeProfitPrice` get one computed from current ATR
- Import `atr` from indicators, compute at startup using live market data
- Assigns `takeProfitPrice` and `atr` to legacy positions automatically
- Uses `regimeGovernance.getCurrentProfile().takeProfitAtrMultiple` for the multiplier

**4. Max Hold Reduced** (`src/risk/engine.ts`)
- Reduced from 12h to 6h — positions shouldn't sit indefinitely even with tighter TP

### Result — First Profitable Trade
Immediately after deployment, **Position #1 hit take-profit**:

```
Take-profit hit: position #1 {
  side: SHORT, entry: 2053.16, exit: 2014.77,
  tpTarget: 2015.2, unrealizedPct: 1.87%, pnl: +2.48
}
```

- **Trade #9**: First ever winning trade — **+$2.48** (+1.77%)
- Retroactive TP set target at $2,015.20 (entry $2,053 - 1.2 × $31.64 ATR)
- Kraken order placed, on-chain close recorded (tx: `0xd4ee...`)

Position #2's trailing stop ratcheted from $2,084 (loss territory) down to **$2,028** (profit territory), locking in ~$24 of gains if triggered.

---

## Current Production State (as of March 31, ~10:10 UTC)

| Metric | Value |
|--------|-------|
| Capital | $9,993.25 |
| Starting Capital | $10,000.00 |
| Total P&L | -$6.75 |
| Total Trades | 9 (8 closed + 1 open) |
| Win Rate | 11.1% (1/9) — was 0% before fixes |
| Wins | 1 (take_profit: +$2.48) |
| Losses | 8 (3 stop_loss, 4 reconciliation, 1 near-zero stop) |
| Open Positions | 1 SHORT @ $2,051.56, TP target $2,013.59 |
| Open Position Stop | $2,027.86 (locks in ~$23 profit if hit) |
| Cycle | 214+ |

### Trade Log (All 9 Trades)

| # | Side | Entry | Exit | P&L | Reason | Duration |
|---|------|-------|------|-----|--------|----------|
| 1 | SHORT | $2,069.03 | $2,075.68 | -$0.34 | stop_loss | 4h |
| 2 | SHORT | $2,066.77 | $2,074.95 | -$0.40 | stop_loss | 4h |
| 3 | SHORT | $2,034.70 | $2,061.16 | -$1.04 | reconciliation | 1.1h |
| 4 | SHORT | $2,033.21 | $2,062.18 | -$1.14 | reconciliation | 1.1h |
| 5 | SHORT | $2,014.31 | $2,063.89 | -$1.97 | reconciliation | 0.2h |
| 6 | SHORT | $2,020.62 | $2,067.83 | -$4.20 | reconciliation | 0.2h |
| 7 | SHORT | $2,021.44 | $2,023.00 | -$0.14 | stop_loss | 4h |
| 8 | SHORT | $2,021.86 | $2,019.88 | -$0.004 | stop_loss | 4h |
| 9 | SHORT | $2,053.16 | $2,014.77 | **+$2.48** | **take_profit** | 1.8h |

---

## Architecture & System Overview

```
Agent Loop (5-min cycles)
  ├── Price Feed: CoinGecko live OHLC → Kraken cross-validation
  ├── Sentiment: Fear & Greed (0.40) + Alpha Vantage (0.35) + Kraken Funding (0.25)
  ├── Strategy: SMA20/50 crossover + neuro-symbolic rules + regime governance
  ├── Risk Engine: 6-layer defense + circuit breaker + trailing stops + dynamic TP
  ├── Execution: Edge filter → DEX router → Kraken paper bridge → on-chain record
  ├── AI Reasoning: Claude → Gemini → OpenAI fallback chain
  └── Trust: ERC-8004 artifacts → IPFS → Base Sepolia Validation Registry
```

### Key Configuration
- **Starting Capital:** $10,000
- **Max Daily Loss:** 2%
- **Max Drawdown:** 8%
- **Max Positions:** 2
- **Cycle Interval:** 5 minutes
- **Min Edge:** 0.25% (raised from 0.15%)
- **Max Hold:** 6 hours
- **Stale Data Threshold:** 30 minutes
- **TP Multiplier (NORMAL):** 1.2× ATR

---

## Lessons Learned

1. **Fixed take-profit percentages are dangerous in low-vol markets.** ATR-based targets that adapt to actual volatility are essential.

2. **Trailing stops need profit-locking tiers.** A fixed-width trail never protects gains — it just delays the inevitable stop-loss hit.

3. **Most "trading losses" were actually deployment artifacts.** 90% of our losses came from PM2 restarts during code deploys triggering reconciliation closes, not from bad trade decisions.

4. **Third-party API reliability varies wildly.** CryptoPanic required 5 separate fixes before being replaced entirely. Always have a fallback.

5. **LLM fallback chains work.** Claude credits ran out, but Gemini 2.5 Pro seamlessly took over with no functional degradation.

6. **Legacy positions need migration paths.** When changing position data structures, old positions must be retroactively updated or they'll use fallback behavior that may not be suitable.

7. **Tighter is better for edge filters.** A 0.15% minimum edge allowed too many marginal trades. Raising to 0.25% with 2× cost multiple eliminated thin-edge losers.
