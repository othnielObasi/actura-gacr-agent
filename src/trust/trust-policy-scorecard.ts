import type { StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision, RiskCheck } from '../risk/engine.js';
import type { ValidationArtifact } from './artifact-emitter.js';
import { recordTrustObservation, getReputationHistory, resetReputationHistory, type MarketRegimeHint } from './reputation-evolution.js';

export type TrustStatus = 'trusted' | 'watch' | 'restricted';
export type TrustScoreStage = 'pre_execution' | 'post_execution' | 'daily_summary';

export interface TrustOutcomeContext {
  pnlUsd?: number;
  pnlPct?: number;
  slippageBps?: number;
  executionMatchedIntent?: boolean;
  abnormalLoss?: boolean;
}

export interface TrustDimensionScores {
  policyCompliance: number;
  riskDiscipline: number;
  validationCompleteness: number;
  outcomeQuality: number;
}

export interface TrustWeights {
  policyCompliance: number;
  riskDiscipline: number;
  validationCompleteness: number;
  outcomeQuality: number;
}

export interface TrustPolicyScorecard {
  version: string;
  stage: TrustScoreStage;
  actionId: string;
  agentId: number | null;
  timestamp: string;
  weights: TrustWeights;
  dimensions: TrustDimensionScores;
  trustScore: number;
  trustDelta: number;
  trustTier: string;
  capitalMultiplier: number;
  capitalLimitPct: number;
  status: TrustStatus;
  recoveryMode: boolean;
  recoveryStreak: number;
  recoveryRequired: number;
  rationale: string[];
}

export interface TrustScoreInput {
  agentId?: number | null;
  actionId: string;
  timestamp: string;
  strategyOutput?: StrategyOutput | null;
  riskDecision?: RiskDecision | null;
  artifact?: ValidationArtifact | null;
  outcome?: TrustOutcomeContext | null;
  stage?: TrustScoreStage;
  regime?: MarketRegimeHint;
}

const DEFAULT_WEIGHTS: TrustWeights = {
  policyCompliance: 0.3,
  riskDiscipline: 0.3,
  validationCompleteness: 0.2,
  outcomeQuality: 0.2,
};

const trustHistory = new Map<number | 'anon', TrustPolicyScorecard[]>();

/* ── Rolling outcome tracker ────────────────────────────────────────── */
const outcomeRollingScores = new Map<number | 'anon', number[]>();
const OUTCOME_WINDOW = 20; // last N scored outcomes to average

function recordOutcomeScore(agentId: number | null, score: number): void {
  const key = agentId ?? 'anon';
  const history = outcomeRollingScores.get(key) ?? [];
  history.push(score);
  if (history.length > OUTCOME_WINDOW) history.shift();
  outcomeRollingScores.set(key, history);
}

function getRollingOutcomeScore(agentId: number | null): number | null {
  const key = agentId ?? 'anon';
  const history = outcomeRollingScores.get(key);
  if (!history || history.length === 0) return null;
  return history.reduce((a, b) => a + b, 0) / history.length;
}

export function buildTrustPolicyScorecard(input: TrustScoreInput): TrustPolicyScorecard {
  const stage = input.stage ?? (input.outcome ? 'post_execution' : 'pre_execution');
  const policy = scorePolicyCompliance(input.riskDecision?.checks ?? [], input.riskDecision?.approved ?? false);
  const risk = scoreRiskDiscipline(input.strategyOutput ?? null, input.riskDecision ?? null);
  const validation = scoreValidationCompleteness(input.artifact ?? null);
  const outcome = scoreOutcomeQuality(input.outcome ?? null, input.riskDecision?.approved ?? false, stage, input.agentId);

  const weighted =
    policy * DEFAULT_WEIGHTS.policyCompliance +
    risk * DEFAULT_WEIGHTS.riskDiscipline +
    validation * DEFAULT_WEIGHTS.validationCompleteness +
    outcome * DEFAULT_WEIGHTS.outcomeQuality;

  const trustScore = roundScore(weighted);
  const prev = getLastTrustScore(input.agentId ?? null);
  const observation = recordTrustObservation({
    agentId: input.agentId ?? null,
    trustScore,
    previousScore: prev,
    timestamp: input.timestamp,
    regime: input.regime,
  });
  const trustDelta = observation.trustDelta;
  const status = observation.status;

  const scorecard: TrustPolicyScorecard = {
    version: '1.0',
    stage,
    actionId: input.actionId,
    agentId: input.agentId ?? null,
    timestamp: input.timestamp,
    weights: DEFAULT_WEIGHTS,
    dimensions: {
      policyCompliance: policy,
      riskDiscipline: risk,
      validationCompleteness: validation,
      outcomeQuality: outcome,
    },
    trustScore,
    trustDelta,
    trustTier: observation.trustTier,
    capitalMultiplier: observation.capitalMultiplier,
    capitalLimitPct: observation.capitalLimitPct,
    status,
    recoveryMode: observation.recoveryMode,
    recoveryStreak: observation.recoveryStreak,
    recoveryRequired: observation.recoveryRequired,
    rationale: buildRationale({ policy, risk, validation, outcome, input, stage, status, observation }),
  };

  recordTrustScorecard(scorecard);
  return scorecard;
}

export function getTrustHistory(agentId: number | null, limit = 20): TrustPolicyScorecard[] {
  const key = agentId ?? 'anon';
  return (trustHistory.get(key) ?? []).slice(-limit);
}

export function getReputationTimeline(agentId: number | null, limit = 20) {
  return getReputationHistory(agentId, limit);
}

export function getLastTrustScore(agentId: number | null): number | null {
  const history = getTrustHistory(agentId, 1);
  return history.length ? history[0].trustScore : null;
}

export function resetTrustScorecards(): void {
  trustHistory.clear();
  outcomeRollingScores.clear();
  resetReputationHistory();
}

/**
 * Seed the rolling outcome tracker from historical trade PnL data.
 * Call at startup so the trust score reflects past performance immediately
 * instead of returning a static baseline until new trades execute.
 */
export function seedOutcomeHistory(agentId: number | null, trades: Array<{ pnlPct: number; slippageBps?: number }>): void {
  const recent = trades.slice(-OUTCOME_WINDOW);
  for (const t of recent) {
    const score = computeOutcomeScore({ pnlPct: t.pnlPct / 100, slippageBps: t.slippageBps });
    recordOutcomeScore(agentId, score);
  }
}

function recordTrustScorecard(scorecard: TrustPolicyScorecard): void {
  const key = scorecard.agentId ?? 'anon';
  const history = trustHistory.get(key) ?? [];
  history.push(scorecard);
  if (history.length > 500) history.shift();
  trustHistory.set(key, history);
}

function scorePolicyCompliance(checks: RiskCheck[], approved: boolean): number {
  if (checks.length === 0) return approved ? 95 : 92;
  // signal_quality failing on NEUTRAL is correct behavior, not a policy violation
  const safetyChecks = checks.filter((c) => c.name !== 'signal_quality');
  if (safetyChecks.length === 0) return 95;
  const passed = safetyChecks.filter((c) => c.passed).length;
  const base = (passed / safetyChecks.length) * 100;
  const blockers = safetyChecks.filter((c) => !c.passed && ['circuit_breaker', 'max_position_size', 'total_exposure', 'volatility_regime'].includes(c.name)).length;
  const penalty = blockers * 8;
  return boundedScore(base - penalty);
}

function scoreRiskDiscipline(strategyOutput: StrategyOutput | null, riskDecision: RiskDecision | null): number {
  let score = 94;
  if (!strategyOutput || !riskDecision) return 92;

  const confidence = strategyOutput.signal.confidence;
  const isNeutral = strategyOutput.signal.direction === 'NEUTRAL';
  if (confidence < 0.15 && !isNeutral) score -= 12;
  if (riskDecision.circuitBreaker.active) score -= 25;
  if (riskDecision.volatility.regime === 'high') score -= 6;
  if (riskDecision.volatility.regime === 'extreme') score -= 18;
  if (riskDecision.finalPositionSize === 0 && strategyOutput.signal.direction !== 'NEUTRAL') score -= 8;
  if ((strategyOutput.signal as any).oracleIntegrityStatus === 'blocked') score -= 15;
  if ((strategyOutput.signal as any).mandateApproved === false) score -= 12;

  const positionRaw = strategyOutput.positionSizeRaw;
  const positionFinal = riskDecision.finalPositionSize;
  if (positionFinal > 0 && positionFinal < positionRaw * 0.5) score -= 5;
  if (strategyOutput.stopLossPrice === null && strategyOutput.signal.direction !== 'NEUTRAL') score -= 10;

  return boundedScore(score);
}

function scoreValidationCompleteness(artifact: ValidationArtifact | null): number {
  if (!artifact) return 88;
  let score = 75;
  if (artifact.strategy?.signal) score += 10;
  if (artifact.riskChecks?.length) score += 10;
  if (artifact.decision?.explanation) score += 10;
  if (artifact.aiReasoning) score += 5;
  if (artifact.marketSnapshot) score += 5;
  if (artifact.confidenceInterval) score += 5;
  if (artifact.trade || artifact.type === 'daily_summary') score += 5;
  if (artifact.supervisory) score += 5;
  if (artifact.mandate) score += 5;
  if (artifact.oracleIntegrity) score += 5;
  if (artifact.executionSimulation) score += 5;
  if (artifact.operatorControl) score += 5;
  return boundedScore(score);
}

function scoreOutcomeQuality(outcome: TrustOutcomeContext | null, approved: boolean, stage: TrustScoreStage, agentId?: number | null): number {
  // If we have a real outcome (post_execution or daily_summary with data), score it live
  if (outcome && (typeof outcome.pnlPct === 'number' || typeof outcome.pnlUsd === 'number')) {
    const score = computeOutcomeScore(outcome);
    recordOutcomeScore(agentId ?? null, score);
    return score;
  }

  // No immediate outcome — use rolling average from recent trade results
  const rolling = getRollingOutcomeScore(agentId ?? null);
  if (rolling !== null) return boundedScore(rolling);

  // No history yet — use baseline
  return approved ? 93 : 88;
}

function computeOutcomeScore(outcome: TrustOutcomeContext): number {
  let score = 88;
  if (typeof outcome.pnlPct === 'number') {
    if (outcome.pnlPct > 0.01) score += 12;
    else if (outcome.pnlPct > 0) score += 8;
    else if (outcome.pnlPct < -0.05) score -= 16;
    else if (outcome.pnlPct < -0.02) score -= 10;
    else if (outcome.pnlPct < 0) score -= 5;
  }
  if (typeof outcome.slippageBps === 'number') {
    if (outcome.slippageBps <= 10) score += 8;
    else if (outcome.slippageBps > 30) score -= 12;
  }
  if (outcome.executionMatchedIntent === false) score -= 15;
  if (outcome.abnormalLoss) score -= 20;
  return boundedScore(score);
}

function boundedScore(value: number): number {
  return roundScore(Math.max(0, Math.min(100, value)));
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildRationale(args: {
  policy: number;
  risk: number;
  validation: number;
  outcome: number;
  input: TrustScoreInput;
  stage: TrustScoreStage;
  status: TrustStatus;
  observation: { recoveryMode: boolean; recoveryStreak: number; recoveryRequired: number; trustTier: string };
}): string[] {
  const lines = [
    `Policy compliance scored ${args.policy}/100 from ${args.input.riskDecision?.checks.length ?? 0} governed checks.`,
    `Risk discipline scored ${args.risk}/100 using confidence, volatility regime, stop policy, and final sizing behaviour.`,
    `Validation completeness scored ${args.validation}/100 from artifact richness and reasoning traces.`,
    `Outcome quality scored ${args.outcome}/100 at stage ${args.stage}.`,
    `Overall status: ${args.status}.`,
    args.observation.recoveryMode
      ? `Recovery mode active: ${args.observation.recoveryStreak}/${args.observation.recoveryRequired} compliant actions completed before full capital rights are restored.`
      : `Trust tier active: ${args.observation.trustTier}.`,
  ];
  return lines;
}
