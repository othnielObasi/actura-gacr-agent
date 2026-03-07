export type CapitalTrustTier = 'probation' | 'limited' | 'standard' | 'elevated' | 'elite';
export type ReputationStatus = 'trusted' | 'watch' | 'restricted';

export interface TrustObservation {
  timestamp: string;
  agentId: number | null;
  trustScore: number;
  trustDelta: number;
  rawTrustTier: CapitalTrustTier;
  trustTier: CapitalTrustTier;
  capitalMultiplier: number;
  capitalLimitPct: number;
  status: ReputationStatus;
  recoveryMode: boolean;
  recoveryStreak: number;
  recoveryRequired: number;
}

interface TierDefinition {
  tier: CapitalTrustTier;
  minScore: number;
  capitalMultiplier: number;
  capitalLimitPct: number;
}

interface RecoveryState {
  active: boolean;
  streak: number;
  required: number;
  triggerScore: number;
}

const TRUST_LADDER: readonly TierDefinition[] = [
  { tier: 'elite', minScore: 95, capitalMultiplier: 1.0, capitalLimitPct: 0.12 },
  { tier: 'elevated', minScore: 90, capitalMultiplier: 1.0, capitalLimitPct: 0.10 },
  { tier: 'standard', minScore: 82, capitalMultiplier: 0.9, capitalLimitPct: 0.08 },
  { tier: 'limited', minScore: 72, capitalMultiplier: 0.7, capitalLimitPct: 0.06 },
  { tier: 'probation', minScore: 0, capitalMultiplier: 0.4, capitalLimitPct: 0.03 },
] as const;

const RECOVERY_REQUIRED_STREAK = 3;
const RECOVERY_TRIGGER_SCORE = 80;
const RECOVERY_EXIT_SCORE = 82;

const reputationHistory = new Map<number | 'anon', TrustObservation[]>();
const recoveryStates = new Map<number | 'anon', RecoveryState>();

export function resolveTrustTier(score: number | null): TierDefinition {
  const effective = score ?? 75;
  return TRUST_LADDER.find((entry) => effective >= entry.minScore) ?? TRUST_LADDER[TRUST_LADDER.length - 1];
}

export function getCapitalMultiplier(score: number | null): number {
  return resolveTrustTier(score).capitalMultiplier;
}

export function getCapitalLimitPct(score: number | null): number {
  return resolveTrustTier(score).capitalLimitPct;
}

export function deriveReputationStatus(score: number): ReputationStatus {
  if (score >= 85) return 'trusted';
  if (score >= 70) return 'watch';
  return 'restricted';
}

export function recordTrustObservation(args: {
  agentId: number | null;
  trustScore: number;
  previousScore: number | null;
  timestamp?: string;
}): TrustObservation {
  const key = args.agentId ?? 'anon';
  const rawTier = resolveTrustTier(args.trustScore);
  const trustDelta = round1(args.previousScore === null ? 0 : args.trustScore - args.previousScore);
  const recoveryState = updateRecoveryState(key, args.trustScore, trustDelta);
  const effectiveTier = applyRecoveryTierCap(rawTier.tier, recoveryState);
  const effectiveTierDefinition = tierByName(effectiveTier);

  const observation: TrustObservation = {
    timestamp: args.timestamp ?? new Date().toISOString(),
    agentId: args.agentId,
    trustScore: round1(args.trustScore),
    trustDelta,
    rawTrustTier: rawTier.tier,
    trustTier: effectiveTier,
    capitalMultiplier: effectiveTierDefinition.capitalMultiplier,
    capitalLimitPct: effectiveTierDefinition.capitalLimitPct,
    status: deriveReputationStatus(args.trustScore),
    recoveryMode: recoveryState.active,
    recoveryStreak: recoveryState.streak,
    recoveryRequired: recoveryState.required,
  };

  const history = reputationHistory.get(key) ?? [];
  history.push(observation);
  if (history.length > 500) history.shift();
  reputationHistory.set(key, history);
  return observation;
}

export function getReputationHistory(agentId: number | null, limit = 20): TrustObservation[] {
  const key = agentId ?? 'anon';
  return (reputationHistory.get(key) ?? []).slice(-limit);
}

export function getLatestObservation(agentId: number | null): TrustObservation | null {
  const history = getReputationHistory(agentId, 1);
  return history.length ? history[0] : null;
}

export function getRecoveryState(agentId: number | null): RecoveryState {
  const key = agentId ?? 'anon';
  return recoveryStates.get(key) ?? {
    active: false,
    streak: 0,
    required: RECOVERY_REQUIRED_STREAK,
    triggerScore: RECOVERY_TRIGGER_SCORE,
  };
}

export function resetReputationHistory(): void {
  reputationHistory.clear();
  recoveryStates.clear();
}

function updateRecoveryState(key: number | 'anon', trustScore: number, trustDelta: number): RecoveryState {
  const state = recoveryStates.get(key) ?? {
    active: false,
    streak: 0,
    required: RECOVERY_REQUIRED_STREAK,
    triggerScore: RECOVERY_TRIGGER_SCORE,
  };

  if (!state.active && trustScore < state.triggerScore) {
    state.active = true;
    state.streak = 0;
  }

  if (state.active) {
    if (trustScore >= RECOVERY_EXIT_SCORE && trustDelta >= 0) {
      state.streak += 1;
    } else if (trustScore < state.triggerScore || trustDelta < -2) {
      state.streak = 0;
    }

    if (state.streak >= state.required && trustScore >= RECOVERY_EXIT_SCORE) {
      state.active = false;
      state.streak = 0;
    }
  }

  recoveryStates.set(key, state);
  return { ...state };
}

function applyRecoveryTierCap(rawTier: CapitalTrustTier, recoveryState: RecoveryState): CapitalTrustTier {
  if (!recoveryState.active) return rawTier;
  return rawTier === 'probation' ? 'probation' : 'limited';
}

function tierByName(name: CapitalTrustTier): TierDefinition {
  return TRUST_LADDER.find((entry) => entry.tier === name) ?? TRUST_LADDER[TRUST_LADDER.length - 1];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
