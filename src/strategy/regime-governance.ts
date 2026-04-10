import { createLogger } from '../agent/logger.js';
import { getContextConfidenceBias, type Outcome as LearningOutcome } from './adaptive-learning.js';

const log = createLogger('REGIME-GOV');

export type RegimeProfileName = 'LOW_VOL' | 'NORMAL' | 'HIGH_VOL' | 'EXTREME_DEFENSIVE';

export interface RegimeProfile {
  name: RegimeProfileName;
  stopLossAtrMultiple: number;
  takeProfitAtrMultiple: number;
  basePositionPct: number;
  confidenceThreshold: number;
}

export const PROFILES: Record<RegimeProfileName, RegimeProfile> = Object.freeze({
  LOW_VOL: { name: 'LOW_VOL', stopLossAtrMultiple: 0.5, takeProfitAtrMultiple: 0.8, basePositionPct: 0.04, confidenceThreshold: 0.03 },
  NORMAL: { name: 'NORMAL', stopLossAtrMultiple: 0.5, takeProfitAtrMultiple: 1.0, basePositionPct: 0.04, confidenceThreshold: 0.02 },
  HIGH_VOL: { name: 'HIGH_VOL', stopLossAtrMultiple: 0.6, takeProfitAtrMultiple: 1.2, basePositionPct: 0.03, confidenceThreshold: 0.03 },
  EXTREME_DEFENSIVE: { name: 'EXTREME_DEFENSIVE', stopLossAtrMultiple: 0.75, takeProfitAtrMultiple: 1.0, basePositionPct: 0.02, confidenceThreshold: 0.05 },
});

export type VolRegime = LearningOutcome['regime'];

export function mapVolToRegime(vol: number): VolRegime {
  if (vol > 0.04) return 'extreme';
  if (vol > 0.03) return 'high';
  if (vol < 0.01) return 'low';
  return 'normal';
}

const VOL_THRESHOLDS = {
  LOW_ENTER: 0.010,
  LOW_EXIT: 0.013,
  HIGH_ENTER: 0.030,
  HIGH_EXIT: 0.026,
  EXTREME_ENTER: 0.040,
  EXTREME_EXIT: 0.035,
} as const;

export function defaultProfileForVol(vol: number, current: RegimeProfileName): RegimeProfileName {
  if (current === 'EXTREME_DEFENSIVE') {
    if (vol <= VOL_THRESHOLDS.EXTREME_EXIT) return 'HIGH_VOL';
    return 'EXTREME_DEFENSIVE';
  }
  if (vol >= VOL_THRESHOLDS.EXTREME_ENTER) return 'EXTREME_DEFENSIVE';

  if (current === 'HIGH_VOL') {
    if (vol <= VOL_THRESHOLDS.HIGH_EXIT) return 'NORMAL';
    return 'HIGH_VOL';
  }
  if (vol >= VOL_THRESHOLDS.HIGH_ENTER) return 'HIGH_VOL';

  if (current === 'LOW_VOL') {
    if (vol >= VOL_THRESHOLDS.LOW_EXIT) return 'NORMAL';
    return 'LOW_VOL';
  }
  if (vol <= VOL_THRESHOLDS.LOW_ENTER) return 'LOW_VOL';

  return 'NORMAL';
}

const POLICY = {
  minHoldCycles: 12,
  switchCooldown: 8,
  drawdownLockPct: 0.06,
} as const;

function isMoreDefensive(a: RegimeProfileName, b: RegimeProfileName): boolean {
  const rank: Record<RegimeProfileName, number> = { LOW_VOL: 0, NORMAL: 1, HIGH_VOL: 2, EXTREME_DEFENSIVE: 3 };
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

export interface GovernanceStepInput {
  cycleNumber: number;
  volatility: number;
  drawdownPct: number;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  regime?: VolRegime;
}

export interface GovernanceStepOutput {
  profile: RegimeProfile;
  profileName: RegimeProfileName;
  adjustedConfidence: number;
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

  reset(): void {
    this.currentProfile = 'NORMAL';
    this.cyclesInProfile = 0;
    this.cooldown = 0;
  }

  step(input: GovernanceStepInput): GovernanceStepOutput {
    const regime = input.regime ?? mapVolToRegime(input.volatility);

    this.cyclesInProfile += 1;
    this.cooldown = Math.max(0, this.cooldown - 1);

    const baseChoice = defaultProfileForVol(input.volatility, this.currentProfile);
    const artifacts: ProfileSwitchArtifact[] = [];
    let switched = false;

    const holdBlocked = this.cyclesInProfile < POLICY.minHoldCycles;
    const cooldownBlocked = this.cooldown > 0;
    const drawdownLocked = input.drawdownPct >= POLICY.drawdownLockPct;
    const switchingToMoreDefensive = isMoreDefensive(baseChoice, this.currentProfile);
    const drawdownBlock = drawdownLocked && !switchingToMoreDefensive;

    const defensiveEscalation = baseChoice !== this.currentProfile && switchingToMoreDefensive;
    const shouldSwitch = baseChoice !== this.currentProfile && (defensiveEscalation || (!holdBlocked && !cooldownBlocked && !drawdownBlock));

    if (shouldSwitch) {
      const from = this.currentProfile;
      const to = baseChoice;
      this.currentProfile = to;
      this.cyclesInProfile = 0;
      this.cooldown = POLICY.switchCooldown;
      switched = true;

      const reason = switchingToMoreDefensive
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
    }

    const profile = PROFILES[this.currentProfile];
    const bayesBias = getContextConfidenceBias({ regime, direction: input.direction, confidence: input.confidence });
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

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}
