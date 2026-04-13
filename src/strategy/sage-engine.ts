/**
 * SAGE — Self-Adapting Generative Engine
 *
 * An adaptive learning layer for responsible, self-improving AI agents.
 * Sits between the agent planner and signal generation, observing trade
 * outcomes and using LLM reflection to learn which signals work.
 *
 * Produces:
 *   - Reflection Insights (lessons learned from trade batches)
 *   - Playbook Rules (actionable filters: BLOCK / REDUCE / BOOST confidence)
 *   - Weight Recommendations (scorecard weight adjustments within CAGE)
 *   - Context Prefixes (accumulated wisdom injected into AI reasoning)
 *
 * Safety:
 *   - All weight changes bounded by WEIGHT_CAGE (immutable)
 *   - Max 30% change per parameter per reflection
 *   - Playbook rules only modify confidence — cannot bypass risk checks
 *   - LLM failure = no change (deterministic fallback)
 *   - Every change is an auditable artifact
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../agent/logger.js';

const log = createLogger('SAGE');

// ── Configuration ──

const SAGE_ENABLED = process.env.SAGE_ENABLED !== 'false';
const SAGE_MIN_OUTCOMES = parseInt(process.env.SAGE_MIN_OUTCOMES || '5');
const SAGE_MAX_RULES = parseInt(process.env.SAGE_MAX_RULES || '15');
const SAGE_REFLECTION_COOLDOWN = parseInt(process.env.SAGE_REFLECTION_COOLDOWN || '5');
const SAGE_RULE_TTL_MS = parseInt(process.env.SAGE_RULE_TTL_MS || String(48 * 60 * 60 * 1000)); // 48h time-based expiry
const SAGE_MAX_PENALTY_STACK = -0.3; // floor for cumulative REDUCE_CONFIDENCE
const SAGE_MIN_BLOCK_EVIDENCE = 3; // minimum trades to justify a BLOCK rule

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent';

// ── Weight CAGE (immutable bounds) ──

export const WEIGHT_CAGE = Object.freeze({
  trend:      { min: 0.0, max: 2.5, default: 1.2 },
  ret5:       { min: 0.0, max: 4.0, default: 1.0 },
  ret20:      { min: 0.0, max: 3.0, default: 1.1 },
  crossover:  { min: 0.0, max: 1.0, default: 0.40 },
  rsi:        { min: 0.0, max: 2.0, default: 0.6 },
  zscore:     { min: 0.0, max: 2.0, default: 0.5 },
  sentiment:  { min: 0.0, max: 0.5, default: 0.12 },
  maxChangePerCycle: 0.3,
});

export type WeightKey = 'trend' | 'ret5' | 'ret20' | 'crossover' | 'rsi' | 'zscore' | 'sentiment';

export interface ScorecardWeights {
  trend: number;
  ret5: number;
  ret20: number;
  crossover: number;
  rsi: number;
  zscore: number;
  sentiment: number;
}

// ── Types ──

export interface SAGEOutcome {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  stopHit: boolean;
  regime: 'low' | 'normal' | 'high' | 'extreme';
  confidence: number;
  // Feature vector for LLM analysis
  ret5?: number;
  ret20?: number;
  rsi?: number;
  adx?: number;
  zscore?: number;
  sentimentComposite?: number;
  alphaScore?: number;
  timestamp: string;
}

export interface PlaybookRule {
  id: string;
  rule: string;
  condition: {
    regime?: string;
    direction?: string;
    indicator?: string;
    threshold?: number;
    comparator?: 'gt' | 'lt' | 'eq';
  };
  action: 'BLOCK' | 'REDUCE_CONFIDENCE' | 'BOOST_CONFIDENCE';
  magnitude: number;  // 0-0.5
  evidence: string;
  createdAt: string;
  tradesAtCreation: number;
  expiresAfterTrades: number;
}

export interface WeightRecommendation {
  parameter: WeightKey;
  currentValue: number;
  recommendedValue: number;
  reasoning: string;
}

export interface SAGEReflection {
  type: 'sage_reflection';
  timestamp: string;
  cycleNumber: number;
  tradesAnalyzed: number;
  insights: string[];
  newRules: PlaybookRule[];
  weightChanges: Array<{ parameter: WeightKey; from: number; to: number; reasoning: string }>;
  contextPrefix: string;
}

// ── State ──

const STATE_DIR = join(process.cwd(), '.actura');
const PLAYBOOK_FILE = join(STATE_DIR, 'playbook.jsonl');
const WEIGHTS_FILE = join(STATE_DIR, 'sage-weights.json');
const REFLECTIONS_FILE = join(STATE_DIR, 'sage-reflections.jsonl');
const SEED_WEIGHTS_FILE = join(process.cwd(), 'data', 'sage-weights-seed.json');

let currentWeights: ScorecardWeights = { ...getDefaultWeights() };
let activeRules: PlaybookRule[] = [];
let reflectionHistory: SAGEReflection[] = [];
let pendingOutcomes: SAGEOutcome[] = [];
let totalOutcomesRecorded = 0;
let cyclesSinceReflection = 0;
let lastContextPrefix = '';
let preReflectionWinRate = 0;    // overfitting: track pre-reflection baseline
let postReflectionOutcomes: SAGEOutcome[] = []; // overfitting: monitor post-change perf
let previousWeights: ScorecardWeights | null = null; // overfitting: rollback snapshot

function getDefaultWeights(): ScorecardWeights {
  return {
    trend: WEIGHT_CAGE.trend.default,
    ret5: WEIGHT_CAGE.ret5.default,
    ret20: WEIGHT_CAGE.ret20.default,
    crossover: WEIGHT_CAGE.crossover.default,
    rsi: WEIGHT_CAGE.rsi.default,
    zscore: WEIGHT_CAGE.zscore.default,
    sentiment: WEIGHT_CAGE.sentiment.default,
  };
}

// ── Public API ──

export function isSAGEEnabled(): boolean {
  return SAGE_ENABLED;
}

export function getSAGEWeights(): Readonly<ScorecardWeights> {
  return SAGE_ENABLED ? { ...currentWeights } : { ...getDefaultWeights() };
}

export function getActivePlaybookRules(): readonly PlaybookRule[] {
  return SAGE_ENABLED ? [...activeRules] : [];
}

export function getContextPrefix(): string {
  return SAGE_ENABLED ? lastContextPrefix : '';
}

export function getSAGEStatus() {
  return {
    enabled: SAGE_ENABLED,
    weights: getSAGEWeights(),
    weightCage: WEIGHT_CAGE,
    activeRules: activeRules.length,
    maxRules: SAGE_MAX_RULES,
    pendingOutcomes: pendingOutcomes.length,
    totalOutcomes: totalOutcomesRecorded,
    reflectionCount: reflectionHistory.length,
    lastReflection: reflectionHistory[reflectionHistory.length - 1]?.timestamp ?? null,
    cyclesSinceReflection,
    contextPrefix: lastContextPrefix.slice(0, 200),
  };
}

/**
 * Record a trade outcome with its feature vector for SAGE analysis.
 * Call this alongside recordTradeOutcome() in the agent loop.
 */
export function recordSAGEOutcome(outcome: SAGEOutcome): void {
  if (!SAGE_ENABLED) return;
  pendingOutcomes.push(outcome);
  postReflectionOutcomes.push(outcome);
  totalOutcomesRecorded++;
  log.info(`Recorded outcome: ${outcome.direction} ${outcome.pnlPct > 0 ? 'WIN' : 'LOSS'} ${(outcome.pnlPct * 100).toFixed(2)}% (pending: ${pendingOutcomes.length})`);

  // Overfitting guard: auto-revert if post-reflection performance degrades significantly
  checkPerformanceDegradation();
}

/**
 * Run SAGE reflection cycle. Call from the agent loop alongside runAdaptation().
 * Returns reflection artifact if one was generated.
 */
export async function runSAGEReflection(cycleNumber: number): Promise<SAGEReflection | null> {
  if (!SAGE_ENABLED) return null;

  cyclesSinceReflection++;

  if (cyclesSinceReflection < SAGE_REFLECTION_COOLDOWN) return null;
  if (pendingOutcomes.length < SAGE_MIN_OUTCOMES) return null;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    log.warn('No GEMINI_API_KEY — skipping SAGE reflection');
    return null;
  }

  log.info(`Starting SAGE reflection (${pendingOutcomes.length} new outcomes, cycle ${cycleNumber})`);

  try {
    // Overfitting guard 1: require minimum regime diversity (relaxed: allow single-regime after 5 trades)
    const regimes = new Set(pendingOutcomes.map(o => o.regime));
    if (regimes.size < 2 && pendingOutcomes.length < 3) {
      log.info(`SAGE skipping reflection: only ${regimes.size} regime(s) in ${pendingOutcomes.length} outcomes — need diversity or 3+ trades`);
      return null;
    }

    // Overfitting guard 2: holdout validation — split 80/20
    const shuffled = [...pendingOutcomes].sort(() => Math.random() - 0.5);
    const holdoutSize = Math.max(1, Math.floor(shuffled.length * 0.2));
    const trainSet = shuffled.slice(0, shuffled.length - holdoutSize);
    const holdoutSet = shuffled.slice(shuffled.length - holdoutSize);

    // Snapshot current state for potential rollback
    previousWeights = { ...currentWeights };
    preReflectionWinRate = pendingOutcomes.filter(o => o.pnlPct > 0).length / pendingOutcomes.length;
    postReflectionOutcomes = [];

    // Expire stale playbook rules
    expireStaleRules();

    // Call LLM with training set only (holdout not shown to LLM)
    const reflection = await callReflectionLLM(geminiKey, trainSet, cycleNumber);

    // Overfitting guard 3: validate weight changes against holdout set
    if (reflection.weightChanges.length > 0 && holdoutSet.length > 0) {
      const holdoutOk = validateAgainstHoldout(reflection.weightChanges, holdoutSet);
      if (!holdoutOk) {
        log.warn('SAGE holdout validation failed — discarding weight changes (keeping insights + rules)');
        reflection.weightChanges = [];
        reflection.insights.push('[OVERFITTING GUARD] Weight changes rejected by holdout validation');
      }
    }

    // Apply weight changes (bounded by CAGE)
    for (const wc of reflection.weightChanges) {
      applyWeightChange(wc.parameter, wc.to);
    }

    // Add new playbook rules (bounded by max)
    for (const rule of reflection.newRules) {
      addPlaybookRule(rule);
    }

    // Update context prefix
    lastContextPrefix = reflection.contextPrefix;

    // Persist everything
    persistWeights();
    persistPlaybook();
    appendReflection(reflection);

    reflectionHistory.push(reflection);
    pendingOutcomes = [];
    cyclesSinceReflection = 0;

    log.info(`SAGE reflection complete: ${reflection.insights.length} insights, ${reflection.newRules.length} new rules, ${reflection.weightChanges.length} weight changes`);
    return reflection;
  } catch (error) {
    log.error('SAGE reflection failed — no changes applied', { error: String(error) });
    return null;
  }
}

/**
 * Apply playbook rules to a signal. Returns confidence modifier.
 * Positive = boost, negative = reduce, -1.0 = BLOCK (force NEUTRAL).
 */
export function applyPlaybookRules(context: {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  regime: string;
  rsi?: number | null;
  ret5?: number | null;
  adx?: number | null;
  zscore?: number | null;
  sentimentComposite?: number | null;
  confidence: number;
}): { modifier: number; rulesApplied: string[] } {
  if (!SAGE_ENABLED || context.direction === 'NEUTRAL') {
    return { modifier: 0, rulesApplied: [] };
  }

  let modifier = 0;
  const rulesApplied: string[] = [];
  let reduceCount = 0;

  for (const rule of activeRules) {
    if (matchesRule(rule, context)) {
      if (rule.action === 'BLOCK') {
        rulesApplied.push(`BLOCK: ${rule.id}`);
        return { modifier: -1.0, rulesApplied };
      } else if (rule.action === 'REDUCE_CONFIDENCE') {
        reduceCount++;
        modifier -= rule.magnitude;
        rulesApplied.push(`REDUCE(${rule.magnitude}): ${rule.id}`);
      } else if (rule.action === 'BOOST_CONFIDENCE') {
        modifier += rule.magnitude;
        rulesApplied.push(`BOOST(${rule.magnitude}): ${rule.id}`);
      }
    }
  }

  // Cap stacking: prevent multiple REDUCE rules from killing every signal
  return { modifier: clamp(modifier, SAGE_MAX_PENALTY_STACK, 0.5), rulesApplied };
}

// ── Persistence ──

export function loadSAGEState(): void {
  if (!SAGE_ENABLED) return;

  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

    // Load weights — try learned state first, fall back to repo seed file
    let weightsLoaded = false;
    const weightsSource = existsSync(WEIGHTS_FILE) ? WEIGHTS_FILE
      : existsSync(SEED_WEIGHTS_FILE) ? SEED_WEIGHTS_FILE
      : null;

    if (weightsSource) {
      const data = JSON.parse(readFileSync(weightsSource, 'utf-8'));
      for (const key of Object.keys(currentWeights) as WeightKey[]) {
        if (typeof data[key] === 'number') {
          const cage = WEIGHT_CAGE[key];
          currentWeights[key] = clamp(data[key], cage.min, cage.max);
        }
      }
      weightsLoaded = true;
      const fromSeed = weightsSource === SEED_WEIGHTS_FILE;
      log.info(`Loaded SAGE weights from ${fromSeed ? 'seed file' : 'disk'}`, { weights: currentWeights });
      // If loaded from seed, persist to .actura/ so future loads use the runtime file
      if (fromSeed) {
        persistWeights();
        log.info('Persisted seed weights to runtime state directory');
      }
    }

    // Load playbook
    if (existsSync(PLAYBOOK_FILE)) {
      const lines = readFileSync(PLAYBOOK_FILE, 'utf-8').trim().split('\n').filter(Boolean);
      activeRules = [];
      for (const line of lines) {
        try {
          const rule = JSON.parse(line) as PlaybookRule;
          activeRules.push(rule);
        } catch { /* skip malformed lines */ }
      }
      // Only keep non-expired rules up to max
      expireStaleRules();
      log.info(`Loaded ${activeRules.length} playbook rules from disk`);
    }

    // Load reflections summary
    if (existsSync(REFLECTIONS_FILE)) {
      const lines = readFileSync(REFLECTIONS_FILE, 'utf-8').trim().split('\n').filter(Boolean);
      for (const line of lines.slice(-10)) { // Keep last 10 reflections in memory
        try {
          reflectionHistory.push(JSON.parse(line));
        } catch { /* skip */ }
      }
      // Restore context prefix from last reflection
      if (reflectionHistory.length > 0) {
        lastContextPrefix = reflectionHistory[reflectionHistory.length - 1].contextPrefix;
      }
      log.info(`Loaded ${reflectionHistory.length} reflection records`);
    }
  } catch (error) {
    log.error('Failed to load SAGE state — starting fresh', { error: String(error) });
  }
}

// ── Internal: LLM Reflection ──

async function callReflectionLLM(
  apiKey: string,
  outcomes: SAGEOutcome[],
  cycleNumber: number,
): Promise<SAGEReflection> {
  const prompt = buildReflectionPrompt(outcomes);

  const url = `${GEMINI_API_URL}?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 256 },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini SAGE reflection returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('');
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  const cleaned = jsonMatch ? jsonMatch[1].trim() : text.replace(/```json|```/g, '').trim();

  let parsed: {
    insights: string[];
    playbookRules?: Array<{
      rule: string;
      condition: PlaybookRule['condition'];
      action: string;
      magnitude: number;
      evidence: string;
      expiresAfterTrades?: number;
    }>;
    weightRecommendations?: Array<{
      parameter: string;
      recommendedValue: number;
      reasoning: string;
    }>;
    contextSummary?: string;
  };

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    log.warn('Failed to parse LLM reflection JSON — using insights only');
    parsed = { insights: ['LLM returned unparseable response — no changes applied'] };
  }

  // Validate and build reflection
  const now = new Date().toISOString();
  const insights = Array.isArray(parsed.insights) ? parsed.insights.slice(0, 10) : [];

  // Process weight recommendations
  const weightChanges: SAGEReflection['weightChanges'] = [];
  if (Array.isArray(parsed.weightRecommendations)) {
    for (const rec of parsed.weightRecommendations) {
      const key = rec.parameter as WeightKey;
      if (key in WEIGHT_CAGE && key !== 'maxChangePerCycle' as any) {
        const cage = WEIGHT_CAGE[key as WeightKey];
        const current = currentWeights[key as WeightKey];
        let recommended = clamp(rec.recommendedValue, cage.min, cage.max);

        // Enforce max change per cycle
        const maxDelta = current * WEIGHT_CAGE.maxChangePerCycle;
        if (Math.abs(recommended - current) > maxDelta) {
          recommended = current + Math.sign(recommended - current) * maxDelta;
          recommended = clamp(recommended, cage.min, cage.max);
        }

        if (Math.abs(recommended - current) > 0.001) {
          weightChanges.push({
            parameter: key as WeightKey,
            from: Math.round(current * 1000) / 1000,
            to: Math.round(recommended * 1000) / 1000,
            reasoning: rec.reasoning || 'LLM recommendation',
          });
        }
      }
    }
  }

  // Process playbook rules
  const newRules: PlaybookRule[] = [];
  if (Array.isArray(parsed.playbookRules)) {
    for (const rawRule of parsed.playbookRules.slice(0, 5)) { // Max 5 new rules per reflection
      const action = rawRule.action as PlaybookRule['action'];
      if (!['BLOCK', 'REDUCE_CONFIDENCE', 'BOOST_CONFIDENCE'].includes(action)) continue;

      // Reject BLOCK rules without sufficient evidence
      if (action === 'BLOCK' && pendingOutcomes.length < SAGE_MIN_BLOCK_EVIDENCE) {
        log.info(`Rejecting BLOCK rule with insufficient evidence (${pendingOutcomes.length} < ${SAGE_MIN_BLOCK_EVIDENCE} trades): ${rawRule.rule}`);
        continue;
      }

      const rule: PlaybookRule = {
        id: `sage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        rule: String(rawRule.rule).slice(0, 200),
        condition: rawRule.condition || {},
        action,
        magnitude: clamp(rawRule.magnitude || 0.1, 0.05, action === 'BLOCK' ? 0.5 : 0.3),
        evidence: String(rawRule.evidence || '').slice(0, 200),
        createdAt: now,
        tradesAtCreation: totalOutcomesRecorded,
        expiresAfterTrades: rawRule.expiresAfterTrades || 20,
      };
      newRules.push(rule);
    }
  }

  const contextPrefix = typeof parsed.contextSummary === 'string'
    ? parsed.contextSummary.slice(0, 500)
    : insights.slice(0, 3).join(' ');

  return {
    type: 'sage_reflection',
    timestamp: now,
    cycleNumber,
    tradesAnalyzed: outcomes.length,
    insights,
    newRules,
    weightChanges,
    contextPrefix,
  };
}

function buildReflectionPrompt(outcomes: SAGEOutcome[]): string {
  const wins = outcomes.filter(o => o.pnlPct > 0);
  const losses = outcomes.filter(o => o.pnlPct <= 0);
  const winRate = outcomes.length > 0 ? (wins.length / outcomes.length * 100).toFixed(0) : '0';

  const tradeTable = outcomes.map((o, i) => {
    const result = o.pnlPct > 0 ? 'WIN' : 'LOSS';
    return `${i + 1}. ${o.direction} in ${o.regime.toUpperCase()} regime | PnL: ${(o.pnlPct * 100).toFixed(2)}% (${result}) | conf: ${(o.confidence * 100).toFixed(0)}% | stopHit: ${o.stopHit} | ret5: ${((o.ret5 ?? 0) * 100).toFixed(2)}% | ret20: ${((o.ret20 ?? 0) * 100).toFixed(2)}% | RSI: ${o.rsi?.toFixed(0) ?? 'N/A'} | ADX: ${o.adx?.toFixed(0) ?? 'N/A'} | zscore: ${o.zscore?.toFixed(2) ?? 'N/A'} | sentiment: ${o.sentimentComposite?.toFixed(2) ?? 'N/A'} | alpha: ${o.alphaScore?.toFixed(3) ?? 'N/A'}`;
  }).join('\n');

  const rulesSection = activeRules.length > 0
    ? `\n\nCURRENT PLAYBOOK RULES (${activeRules.length}):\n${activeRules.map(r => `- ${r.rule} [${r.action} ${r.magnitude}] (${r.evidence})`).join('\n')}`
    : '\n\nNo existing playbook rules.';

  const weightsSection = Object.entries(currentWeights)
    .map(([k, v]) => {
      const cage = WEIGHT_CAGE[k as WeightKey];
      return `  ${k}: ${v.toFixed(3)} (range: ${cage.min}–${cage.max})`;
    }).join('\n');

  return `You are the SAGE (Self-Adapting Generative Engine) reflection engine for Actura, an autonomous crypto trading agent.

Analyze these recent trade outcomes and provide structured learning.

TRADE OUTCOMES (${outcomes.length} trades, ${winRate}% win rate):
${tradeTable}

CURRENT SCORECARD WEIGHTS:
${weightsSection}
${rulesSection}

ANALYSIS TASK:
1. Identify patterns: which conditions correlate with wins vs losses?
2. Recommend weight adjustments to improve signal quality
3. Propose playbook rules (max 5) to filter bad signals
4. Summarize key learnings for future context

CONSTRAINTS:
- Weight changes must be within the stated ranges
- Weight changes should be gradual (max 30% change from current value)
- Playbook rules can only: BLOCK (force NEUTRAL), REDUCE_CONFIDENCE (lower by magnitude), or BOOST_CONFIDENCE (raise by magnitude)
- Magnitude must be between 0.05 and 0.30 for REDUCE/BOOST, up to 0.50 for BLOCK
- BLOCK rules require at least 3 supporting trades — do NOT create BLOCK rules from 1-2 trades
- REDUCE_CONFIDENCE is preferred over BLOCK when evidence is limited
- Rules should be specific and evidence-based, not generic
- Avoid creating rules that overlap with or contradict existing rules
- If data is insufficient to draw conclusions, say so and make minimal changes
- Consider that multiple REDUCE rules can stack — keep individual magnitudes conservative

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "insights": ["insight1", "insight2", ...],
  "weightRecommendations": [
    {"parameter": "ret5", "recommendedValue": 1.5, "reasoning": "why"}
  ],
  "playbookRules": [
    {
      "rule": "human-readable rule description",
      "condition": {"regime": "low", "direction": "SHORT", "indicator": "ret5", "threshold": 0.01, "comparator": "gt"},
      "action": "REDUCE_CONFIDENCE",
      "magnitude": 0.15,
      "evidence": "Based on 3 trades: 0W 3L in this pattern",
      "expiresAfterTrades": 30
    }
  ],
  "contextSummary": "Brief summary of accumulated trading wisdom for this market regime"
}`;
}

// ── Internal: Rule matching ──

function matchesRule(rule: PlaybookRule, context: {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  regime: string;
  rsi?: number | null;
  ret5?: number | null;
  adx?: number | null;
  zscore?: number | null;
  sentimentComposite?: number | null;
}): boolean {
  const c = rule.condition;

  // Direction match
  if (c.direction && c.direction.toUpperCase() !== context.direction) return false;

  // Regime match
  if (c.regime && c.regime.toLowerCase() !== context.regime.toLowerCase()) return false;

  // Indicator threshold match
  if (c.indicator && c.threshold !== undefined && c.comparator) {
    const indicatorMap: Record<string, number | null | undefined> = {
      rsi: context.rsi,
      ret5: context.ret5,
      ret20: undefined, // not in context — skip
      adx: context.adx,
      zscore: context.zscore,
      sentiment: context.sentimentComposite,
    };

    const val = indicatorMap[c.indicator];
    if (val === null || val === undefined) return false;

    switch (c.comparator) {
      case 'gt': if (!(val > c.threshold)) return false; break;
      case 'lt': if (!(val < c.threshold)) return false; break;
      case 'eq': if (Math.abs(val - c.threshold) > 0.001) return false; break;
    }
  }

  return true;
}

// ── Internal: Weight management ──

function applyWeightChange(key: WeightKey, newValue: number): void {
  const cage = WEIGHT_CAGE[key];
  const prev = currentWeights[key];
  currentWeights[key] = clamp(newValue, cage.min, cage.max);
  log.info(`SAGE weight ${key}: ${prev.toFixed(3)} → ${currentWeights[key].toFixed(3)}`);
}

// ── Internal: Playbook management ──

function addPlaybookRule(rule: PlaybookRule): void {
  // Check for duplicate conditions
  const isDuplicate = activeRules.some(r =>
    r.condition.direction === rule.condition.direction &&
    r.condition.regime === rule.condition.regime &&
    r.condition.indicator === rule.condition.indicator &&
    r.action === rule.action
  );
  if (isDuplicate) {
    log.debug(`Skipping duplicate playbook rule: ${rule.rule}`);
    return;
  }

  activeRules.push(rule);

  // Enforce max rules (remove oldest first)
  while (activeRules.length > SAGE_MAX_RULES) {
    const removed = activeRules.shift();
    if (removed) log.info(`Evicted oldest playbook rule: ${removed.id}`);
  }

  log.info(`Added playbook rule: ${rule.rule} [${rule.action} ${rule.magnitude}]`);
}

function expireStaleRules(): void {
  const before = activeRules.length;
  const now = Date.now();
  activeRules = activeRules.filter(rule => {
    const tradesSinceCreation = totalOutcomesRecorded - rule.tradesAtCreation;
    const ageMs = now - new Date(rule.createdAt).getTime();
    // Expire by trade count OR by wall-clock time (prevents rule deadlock when no trades execute)
    if (tradesSinceCreation >= rule.expiresAfterTrades) return false;
    if (ageMs >= SAGE_RULE_TTL_MS) return false;
    return true;
  });
  const expired = before - activeRules.length;
  if (expired > 0) log.info(`Expired ${expired} stale playbook rules (trade-count + time-based)`);
}

// ── Internal: Persistence ──

function persistWeights(): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(WEIGHTS_FILE, JSON.stringify(currentWeights, null, 2), 'utf-8');
    // Also update repo seed file as backup (survives rsync --delete)
    try {
      const seedDir = join(process.cwd(), 'data');
      if (existsSync(seedDir)) {
        const seed = {
          ...currentWeights,
          _meta: {
            learnedAt: new Date().toISOString(),
            totalOutcomes: totalOutcomesRecorded,
            note: 'Auto-updated by SAGE after reflection. Copy to .actura/sage-weights.json on fresh deploys.',
          },
        };
        writeFileSync(SEED_WEIGHTS_FILE, JSON.stringify(seed, null, 2) + '\n', 'utf-8');
      }
    } catch { /* seed backup is best-effort */ }
  } catch (error) {
    log.error('Failed to persist SAGE weights', { error: String(error) });
  }
}

function persistPlaybook(): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    const data = activeRules.map(r => JSON.stringify(r)).join('\n');
    writeFileSync(PLAYBOOK_FILE, data + '\n', 'utf-8');
  } catch (error) {
    log.error('Failed to persist playbook', { error: String(error) });
  }
}

function appendReflection(reflection: SAGEReflection): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(REFLECTIONS_FILE, JSON.stringify(reflection) + '\n', 'utf-8');
  } catch (error) {
    log.error('Failed to append reflection', { error: String(error) });
  }
}

// ── Overfitting Protection ──

/**
 * Holdout validation: check if proposed weight changes would have improved
 * signal quality on the holdout set (trades the LLM didn't see).
 */
function validateAgainstHoldout(
  weightChanges: SAGEReflection['weightChanges'],
  holdout: SAGEOutcome[],
): boolean {
  if (holdout.length === 0) return true;

  // Build proposed weights
  const proposed = { ...currentWeights };
  for (const wc of weightChanges) {
    proposed[wc.parameter] = wc.to;
  }

  // Simple directional check: do proposed weights align better with holdout outcomes?
  let currentAligned = 0;
  let proposedAligned = 0;

  for (const o of holdout) {
    const isWin = o.pnlPct > 0;
    // Rough signal score: higher absolute score should correlate with wins
    const curScore = Math.abs(
      (o.ret5 ?? 0) * currentWeights.ret5 +
      (o.ret20 ?? 0) * currentWeights.ret20 +
      (o.rsi !== undefined && o.rsi !== null ? (o.rsi > 70 ? -1 : o.rsi < 30 ? 1 : 0) : 0) * currentWeights.rsi
    );
    const propScore = Math.abs(
      (o.ret5 ?? 0) * proposed.ret5 +
      (o.ret20 ?? 0) * proposed.ret20 +
      (o.rsi !== undefined && o.rsi !== null ? (o.rsi > 70 ? -1 : o.rsi < 30 ? 1 : 0) : 0) * proposed.rsi
    );

    // Winners should have higher scores, losers lower
    if (isWin) {
      if (curScore > 0.01) currentAligned++;
      if (propScore > 0.01) proposedAligned++;
    } else {
      // For losses, lower score = better (we want to avoid these)
      if (curScore < 0.01) currentAligned++;
      if (propScore < 0.01) proposedAligned++;
    }
  }

  // Proposed must not be worse than current
  const pass = proposedAligned >= currentAligned;
  log.info(`Holdout validation: current=${currentAligned}/${holdout.length}, proposed=${proposedAligned}/${holdout.length} → ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

/**
 * Auto-revert weights if post-reflection performance degrades significantly.
 * Requires 5+ trades after a reflection to evaluate.
 */
function checkPerformanceDegradation(): void {
  if (!previousWeights || postReflectionOutcomes.length < 5) return;

  const postWinRate = postReflectionOutcomes.filter(o => o.pnlPct > 0).length / postReflectionOutcomes.length;

  // Only revert if win rate dropped by >15 percentage points
  if (preReflectionWinRate - postWinRate > 0.15) {
    log.warn(`SAGE OVERFITTING REVERT: post-reflection win rate ${(postWinRate * 100).toFixed(0)}% vs pre ${(preReflectionWinRate * 100).toFixed(0)}% — reverting weights`);
    currentWeights = { ...previousWeights };
    persistWeights();
    previousWeights = null;
    postReflectionOutcomes = [];
  } else if (postReflectionOutcomes.length >= 10) {
    // After 10 trades, stop monitoring — weights are accepted
    log.info(`SAGE weights accepted: post-reflection win rate ${(postWinRate * 100).toFixed(0)}% (baseline ${(preReflectionWinRate * 100).toFixed(0)}%)`);
    previousWeights = null;
    postReflectionOutcomes = [];
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
