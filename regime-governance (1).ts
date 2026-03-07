/**
 * Regime Governance Controller (Alternative Combination Implementation)
 * ------------------------------------------------------------------
 * Implements the combination as:
 *
 *   1) Market-state (volatility) selects a BASE profile deterministically (with hysteresis)
 *   2) A POLICY GATE decides whether switching is allowed (cooldown, min-hold, drawdown)
 *   3) Bayesian regime-aware memory (adaptive-learning.ts) ONLY adjusts confidence (bounded bias)
 *
 * This separation is governance-friendly:
 *   - Profile: "risk posture" (stops/size/threshold) derived from market volatility state
 *   - Memory: "signal trust" derived from empirical outcomes (Bayesian)
 *   - Policy: prevents thrashing and unsafe rapid switching
 *
 * Drop this file into: src/strategy/regime-governance.ts
 *
 * Usage sketch (in your main loop / signal finalization):
 *   import { RegimeGovernanceController } from './strategy/regime-governance.js';
 *   const gov = new RegimeGovernanceController();
 *
 *   // each cycle:
 *   const res = gov.step({
 *     cycleNumber,
 *     volatility: strategyOutput.indicators.volatility ?? 0.02,
 *     drawdownPct,
 *     direction: cognitive.adjustedSignal as 'LONG'|'SHORT',
 *     confidence: cognitive.adjustedConfidence,
 *     regime: mapVolToRegime(strategyOutput.indicators.volatility ?? 0.02),
 *   });
 *
 *   // apply:
 *   const profile = res.profile;
 *   finalConfidence = res.adjustedConfidence;
 *   // use profile.stopLossAtrMultiple / basePositionPct / confidenceThreshold downstream
 *
 * NOTE:
 * - This controller does NOT mutate global config.
 * - It returns the selected profile parameters for your risk/exec pipeline to use.
 */

import { createLogger } from '../agent/logger.js';
import { getContextConfidenceBias, type Outcome as LearningOutcome } from './adaptive-learning.js';

const log = createLogger('REGIME-GOV');

// ─────────────────────────────────────────────────────────────
// 1) Immutable, audited profiles
// ─────────────────────────────────────────────────────────────

export type RegimeProfileName = 'LOW_VOL' | 'NORMAL' | 'HIGH_VOL' | 'EXTREME_DEFENSIVE';

export interface RegimeProfile {
  name: RegimeProfileName;
  stopLossAtrMultiple: number;
  basePositionPct: number;
  confidenceThreshold: number;
}

export const PROFILES: Record<RegimeProfileName, RegimeProfile> = Object.freeze({
  LOW_VOL: {
    name: 'LOW_VOL',
    stopLossAtrMultiple: 1.35,
    basePositionPct: 0.022,
    confidenceThreshold: 0.085,
  },
  NORMAL: {
    name: 'NORMAL',
    stopLossAtrMultiple: 1.50,
    basePositionPct: 0.020,
    confidenceThreshold: 0.10,
  },
  HIGH_VOL: {
    name: 'HIGH_VOL',
    stopLossAtrMultiple: 1.75,
    basePositionPct: 0.016,
    confidenceThreshold: 0.12,
  },
  EXTREME_DEFENSIVE: {
    name: 'EXTREME_DEFENSIVE',
    stopLossAtrMultiple: 2.00,
    basePositionPct: 0.012,
    confidenceThreshold: 0.15,
  },
});

// ─────────────────────────────────────────────────────────────
// 2) Volatility → regime mapping + hysteresis thresholds
//    (Tune these to match your volatility scale.)
// ─────────────────────────────────────────────────────────────

export type VolRegime = LearningOutcome['regime'];

/** Simple mapping used to feed the Bayesian module (kept aligned with adaptive-learning.ts regimes). */
export function mapVolToRegime(vol: number): VolRegime {
  // These match the neuro-symbolic file's regime thresholds idea:
  // extreme > 0.04, high > 0.03, low < 0.01 else normal.
  if (vol > 0.04) return 'extreme';
  if (vol > 0.03) return 'high';
  if (vol < 0.01) return 'low';
  return 'normal';
}

// Hysteresis thresholds (enter != exit) to avoid flip-flopping near boundaries.
const VOL_THRESHOLDS = {
  LOW_ENTER: 0.010,
  LOW_EXIT: 0.013,

  HIGH_ENTER: 0.030,
  HIGH_EXIT: 0.026,

  EXTREME_ENTER: 0.040,
  EXTREME_EXIT: 0.035,
} as const;

/** Deterministic profile selection from volatility + current profile (hysteresis). */
export function defaultProfileForVol(vol: number, current: RegimeProfileName): RegimeProfileName {
  // Extreme gate
  if (current === 'EXTREME_DEFENSIVE') {
    if (vol <= VOL_THRESHOLDS.EXTREME_EXIT) return 'HIGH_VOL';
    return 'EXTREME_DEFENSIVE';
  }
  if (vol >= VOL_THRESHOLDS.EXTREME_ENTER) return 'EXTREME_DEFENSIVE';

  // High gate
  if (current === 'HIGH_VOL') {
    if (vol <= VOL_THRESHOLDS.HIGH_EXIT) return 'NORMAL';
    return 'HIGH_VOL';
  }
  if (vol >= VOL_THRESHOLDS.HIGH_ENTER) return 'HIGH_VOL';

  // Low gate
  if (current === 'LOW_VOL') {
    if (vol >= VOL_THRESHOLDS.LOW_EXIT) return 'NORMAL';
    return 'LOW_VOL';
  }
  if (vol <= VOL_THRESHOLDS.LOW_ENTER) return 'LOW_VOL';

  return 'NORMAL';
}

// ─────────────────────────────────────────────────────────────
// 3) Policy gate (cooldown, min-hold, drawdown safety)
// ─────────────────────────────────────────────────────────────

const POLICY = {
  minHoldCycles: 12,      // must hold profile for at least N cycles
  switchCooldown: 8,      // after switching, wait N cycles
  drawdownLockPct: 0.06,  // if drawdown above this, freeze switches unless switching to more defensive
} as const;

function isMoreDefensive(a: RegimeProfileName, b: RegimeProfileName): boolean {
  const rank: Record<RegimeProfileName, number> = {
    LOW_VOL: 0,
    NORMAL: 1,
    HIGH_VOL: 2,
    EXTREME_DEFENSIVE: 3,
  };
  return rank[a] > rank[b];
}

export interface ProfileSwitchArtifact {
  type: 'profile_switch_artifact';
  timestamp: string;
  cycleNumber: number;
  from: RegimeProfileName;
  to: RegimeProfileName;
  reason: string;
  evidence: {
    volatility: number;
    volatilityRegime: VolRegime;
    drawdownPct: number;
    cyclesInProfile: number;
    cooldownRemaining: number;
  };
  profileParams: RegimeProfile;
}

// ─────────────────────────────────────────────────────────────
// 4) Controller: produces (profile params + confidence bias) each cycle
// ─────────────────────────────────────────────────────────────

export interface GovernanceStepInput {
  cycleNumber: number;
  volatility: number;            // strategyOutput.indicators.volatility (or equivalent)
  drawdownPct: number;
  direction: 'LONG' | 'SHORT';   // the post-symbolic direction
  confidence: number;            // the post-symbolic confidence in [0,1]
  regime?: VolRegime;            // optionally precomputed; else derived from volatility
}

export interface GovernanceStepOutput {
  profile: RegimeProfile;
  profileName: RegimeProfileName;

  // confidence after Bayesian bias and clamping
  adjustedConfidence: number;

  // helpful audit/telemetry
  bayesBias: number;
  baseProfileChoice: RegimeProfileName;
  switched: boolean;
  artifacts: Array<ProfileSwitchArtifact>;
}

export class RegimeGovernanceController {
  private currentProfile: RegimeProfileName = 'NORMAL';
  private cyclesInProfile = 0;
  private cooldown = 0;

  getCurrentProfile(): RegimeProfile {
    return PROFILES[this.currentProfile];
  }

  step(input: GovernanceStepInput): GovernanceStepOutput {
    const regime = input.regime ?? mapVolToRegime(input.volatility);

    this.cyclesInProfile += 1;
    this.cooldown = Math.max(0, this.cooldown - 1);

    // 1) Market-state selects the base profile (deterministic with hysteresis)
    const baseChoice = defaultProfileForVol(input.volatility, this.currentProfile);

    // 2) Policy gate decides whether switching to baseChoice is allowed
    const artifacts: ProfileSwitchArtifact[] = [];
    let switched = false;

    const holdBlocked = this.cyclesInProfile < POLICY.minHoldCycles;
    const cooldownBlocked = this.cooldown > 0;

    const drawdownLocked = input.drawdownPct >= POLICY.drawdownLockPct;
    const switchingToMoreDefensive = isMoreDefensive(baseChoice, this.currentProfile);

    const drawdownBlock = drawdownLocked && !switchingToMoreDefensive;

    const shouldSwitch = baseChoice !== this.currentProfile && !holdBlocked && !cooldownBlocked && !drawdownBlock;

    if (shouldSwitch) {
      const from = this.currentProfile;
      const to = baseChoice;
      this.currentProfile = to;
      this.cyclesInProfile = 0;
      this.cooldown = POLICY.switchCooldown;
      switched = true;

      const reason =
        switchingToMoreDefensive
          ? 'Volatility regime shift (defensive escalation)'
          : 'Volatility regime shift (hysteresis thresholds)';

      const artifact: ProfileSwitchArtifact = {
        type: 'profile_switch_artifact',
        timestamp: new Date().toISOString(),
        cycleNumber: input.cycleNumber,
        from,
        to,
        reason,
        evidence: {
          volatility: input.volatility,
          volatilityRegime: regime,
          drawdownPct: input.drawdownPct,
          cyclesInProfile: this.cyclesInProfile,
          cooldownRemaining: this.cooldown,
        },
        profileParams: PROFILES[to],
      };

      artifacts.push(artifact);

      log.info('Profile switched', artifact);
    } else if (baseChoice !== this.currentProfile) {
      // Optional: trace why a switch was blocked (useful for debugging)
      const reason = holdBlocked
        ? `Switch blocked by min-hold (${this.cyclesInProfile}/${POLICY.minHoldCycles})`
        : cooldownBlocked
          ? `Switch blocked by cooldown (${this.cooldown} remaining)`
          : drawdownBlock
            ? `Switch blocked by drawdown lock (dd=${(input.drawdownPct * 100).toFixed(1)}%)`
            : 'Switch not performed';

      log.debug(reason, {
        wanted: baseChoice,
        current: this.currentProfile,
        volatility: input.volatility,
      });
    }

    const profile = PROFILES[this.currentProfile];

    // 3) Bayesian layer ONLY adjusts confidence (bounded bias)
    const bayesBias = getContextConfidenceBias({
      regime,
      direction: input.direction,
      confidence: input.confidence,
    });

    const adjustedConfidence = clamp01(input.confidence + bayesBias);

    return {
      profile,
      profileName: this.currentProfile,
      adjustedConfidence,
      bayesBias,
      baseProfileChoice: baseChoice,
      switched,
      artifacts,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}
