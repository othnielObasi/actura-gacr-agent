/**
 * AI Reasoning Engine
 * 
 * Provides intelligent, human-readable explanations for every trade
 * decision using a 3-tier LLM failover chain:
 *
 *   Claude (Anthropic) → Gemini (Google) → GPT-4o (OpenAI) → deterministic fallback
 *
 * The AI doesn't MAKE the trade decision — the risk engine does.
 * The AI EXPLAINS and ENRICHES the decision with context.
 *
 * This is Actura's differentiator: "Not the smartest trader.
 * The most accountable." — and the AI makes accountability *readable*.
 */

import { createLogger } from '../agent/logger.js';
import { retry } from '../agent/retry.js';
import type { StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision } from '../risk/engine.js';
import type { SentimentResult } from '../data/sentiment-feed.js';
import { getContextPrefix, getSAGEWeights, isSAGEEnabled } from './sage-engine.js';

const log = createLogger('AI-REASON');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';

interface AIReasoning {
  marketContext: string;       // What's happening in the market
  tradeRationale: string;     // Why this signal makes sense (or doesn't)
  riskNarrative: string;      // Plain English risk assessment
  confidenceFactors: string[];// What supports the confidence level
  watchItems: string[];       // What could invalidate this trade
  summary: string;            // One-sentence human-readable summary
}

const FALLBACK_REASONING: AIReasoning = {
  marketContext: 'Market analysis unavailable — using quantitative signals only.',
  tradeRationale: 'Decision based on SMA crossover and volatility-adjusted momentum.',
  riskNarrative: 'Risk checks performed per standard protocol.',
  confidenceFactors: ['SMA trend alignment', 'Volatility within normal range'],
  watchItems: ['Sudden volatility spike', 'Trend reversal'],
  summary: 'Quantitative signal-based decision with standard risk controls.',
};

/**
 * Generate AI reasoning for a trade decision.
 * Cascade: Claude → Gemini → OpenAI → deterministic fallback.
 */
export async function generateReasoning(
  strategyOutput: StrategyOutput,
  riskDecision: RiskDecision,
  recentPrices: number[],
  capitalUsd: number,
  openPositionCount: number,
  sentiment?: SentimentResult | null,
): Promise<AIReasoning> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Try Claude first (best structured JSON output)
  if (anthropicKey) {
    try {
      const result = await retry(
        () => callClaudeAPI(anthropicKey, strategyOutput, riskDecision, recentPrices, capitalUsd, openPositionCount, sentiment),
        { maxRetries: 1, baseDelayMs: 500, label: 'Claude reasoning' }
      );
      return result;
    } catch (error) {
      log.warn('Claude API failed — trying Gemini', { error: String(error) });
    }
  }

  // Try Gemini as second option (free tier, fast)
  if (geminiKey) {
    try {
      const result = await retry(
        () => callGeminiAPI(geminiKey, strategyOutput, riskDecision, recentPrices, capitalUsd, openPositionCount, sentiment),
        { maxRetries: 1, baseDelayMs: 500, label: 'Gemini reasoning' }
      );
      return result;
    } catch (error) {
      log.warn('Gemini API failed — trying OpenAI', { error: String(error) });
    }
  }

  // Try OpenAI as third option
  if (openaiKey) {
    try {
      const result = await retry(
        () => callOpenAIAPI(openaiKey, strategyOutput, riskDecision, recentPrices, capitalUsd, openPositionCount, sentiment),
        { maxRetries: 1, baseDelayMs: 500, label: 'OpenAI reasoning' }
      );
      return result;
    } catch (error) {
      log.warn('OpenAI API failed — using deterministic fallback', { error: String(error) });
    }
  }

  if (!anthropicKey && !geminiKey && !openaiKey) {
    log.debug('No LLM API keys set (ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY) — using deterministic fallback');
  }

  return buildFallbackReasoning(strategyOutput, riskDecision);
}

async function callClaudeAPI(
  apiKey: string,
  strategy: StrategyOutput,
  risk: RiskDecision,
  prices: number[],
  capital: number,
  posCount: number,
  sentiment?: SentimentResult | null,
): Promise<AIReasoning> {
  const prompt = buildReasoningPrompt(strategy, risk, prices, capital, posCount, sentiment);

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => 'no body');
    throw new Error(`Claude API returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  const text = data.content
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text?: string }) => c.text || '')
    .join('');

  const cleaned = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned) as AIReasoning;

  log.info('AI reasoning generated [Claude]', { summary: parsed.summary.slice(0, 80) });
  return parsed;
}

/**
 * Build the shared prompt used by both Claude and Gemini.
 */
function buildReasoningPrompt(
  strategy: StrategyOutput,
  risk: RiskDecision,
  prices: number[],
  capital: number,
  posCount: number,
  sentiment?: SentimentResult | null,
): string {
  const last10 = prices.slice(-10);
  const priceChange = last10.length >= 2
    ? ((last10[last10.length - 1] - last10[0]) / last10[0] * 100).toFixed(2)
    : '0';

  // Build sentiment block if available
  let sentimentBlock = '';
  if (sentiment && sentiment.sources.length > 0) {
    const fgRaw = sentiment.fearGreed !== null ? Math.round((sentiment.fearGreed + 1) * 50) : null;
    const fgLabel = fgRaw !== null ? (fgRaw <= 20 ? 'Extreme Fear' : fgRaw <= 40 ? 'Fear' : fgRaw <= 60 ? 'Neutral' : fgRaw <= 80 ? 'Greed' : 'Extreme Greed') : 'N/A';
    sentimentBlock = `\n\nSENTIMENT (6 sources, weighted composite):
- Composite: ${sentiment.composite.toFixed(2)} (${sentiment.composite > 0.08 ? 'BULLISH' : sentiment.composite < -0.08 ? 'BEARISH' : 'NEUTRAL'})
- Fear & Greed Index: ${fgRaw ?? 'N/A'}/100 (${fgLabel})${fgRaw !== null && (fgRaw <= 20 || fgRaw >= 80) ? ' [CONTRARIAN ADJUSTED]' : ''}
- News sentiment: ${sentiment.newsSentiment?.toFixed(2) ?? 'N/A'} (PRISM sentiment API)
- Social sentiment: ${(sentiment as any).socialSentiment?.toFixed(2) ?? 'N/A'} (PRISM crowd data)
- Funding rate: ${sentiment.fundingRate?.toFixed(2) ?? 'N/A'} (PRISM aggregated / Kraken fallback)
- Open Interest: ${(sentiment as any).openInterest?.toFixed(2) ?? 'N/A'} (PRISM derivatives)
- Price Momentum: ${(sentiment as any).priceMomentum?.toFixed(2) ?? 'N/A'} (PRISM 24h change)
- Active sources: ${sentiment.sources.join(', ')}`;
  }

  // Build SAGE context block if available
  let sageBlock = '';
  if (isSAGEEnabled()) {
    const prefix = getContextPrefix();
    if (prefix) {
      const weights = getSAGEWeights();
      sageBlock = `\n\nSAGE LEARNED CONTEXT (from prior trade reflections):\n${prefix}\nCurrent learned weights: trend=${weights.trend.toFixed(2)}, ret5=${weights.ret5.toFixed(2)}, ret20=${weights.ret20.toFixed(2)}, sentiment=${weights.sentiment.toFixed(2)}`;
    }
  }

  return `You are the reasoning engine for Actura, an accountable autonomous trading agent. Analyze this trade decision and provide structured reasoning.

MARKET SNAPSHOT:
- Current price: $${strategy.currentPrice.toFixed(2)}
- Recent 10-period change: ${priceChange}%
- SMA(20): ${strategy.indicators.smaFast?.toFixed(2) ?? 'N/A'}
- SMA(50): ${strategy.indicators.smaSlow?.toFixed(2) ?? 'N/A'}
- Volatility: ${strategy.indicators.volatility?.toFixed(4) ?? 'N/A'} (regime: ${risk.volatility.regime})
- ATR: ${strategy.indicators.atr?.toFixed(2) ?? 'N/A'}${sentimentBlock}${sageBlock}

SIGNAL:
- Direction: ${strategy.signal.direction}
- Confidence: ${(strategy.signal.confidence * 100).toFixed(0)}%
- Reason: ${strategy.signal.reason}

RISK DECISION:
- Approved: ${risk.approved}
- Position size: ${risk.finalPositionSize.toFixed(4)} units ($${(risk.finalPositionSize * strategy.currentPrice).toFixed(2)})
- Stop loss: $${risk.stopLossPrice?.toFixed(2) ?? 'N/A'}
- Checks passed: ${risk.checks.filter(c => c.passed).length}/${risk.checks.length}
${risk.checks.filter(c => !c.passed).map(c => `- FAILED: ${c.name} — ${c.detail}`).join('\n')}

PORTFOLIO:
- Capital: $${capital.toFixed(2)}
- Open positions: ${posCount}
- Daily PnL: ${(risk.circuitBreaker.dailyPnlPct * 100).toFixed(2)}%
- Drawdown: ${(risk.circuitBreaker.drawdownPct * 100).toFixed(2)}%

Respond ONLY with valid JSON (no markdown, no backticks):
{"marketContext":"1-2 sentences on market conditions including sentiment","tradeRationale":"why this decision makes sense given technicals AND sentiment","riskNarrative":"plain English risk assessment","confidenceFactors":["factor1","factor2","factor3"],"watchItems":["risk1","risk2"],"summary":"one sentence summary referencing market sentiment"}`;
}

/**
 * Call Gemini API (failover when Claude is unavailable)
 */
async function callGeminiAPI(
  apiKey: string,
  strategy: StrategyOutput,
  risk: RiskDecision,
  prices: number[],
  capital: number,
  posCount: number,
  sentiment?: SentimentResult | null,
): Promise<AIReasoning> {
  const prompt = buildReasoningPrompt(strategy, risk, prices, capital, posCount, sentiment);

  const url = `${GEMINI_API_URL}?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 128 },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini API returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  // Gemini 2.5 Pro may return multiple parts (thinking + text) — find the JSON part
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('');
  // Extract JSON from markdown fences or raw text
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  const cleaned = jsonMatch ? jsonMatch[1].trim() : text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned) as AIReasoning;

  log.info('AI reasoning generated [Gemini]', { summary: parsed.summary.slice(0, 80) });
  return parsed;
}

/**
 * Call OpenAI API (third failover)
 */
async function callOpenAIAPI(
  apiKey: string,
  strategy: StrategyOutput,
  risk: RiskDecision,
  prices: number[],
  capital: number,
  posCount: number,
  sentiment?: SentimentResult | null,
): Promise<AIReasoning> {
  const prompt = buildReasoningPrompt(strategy, risk, prices, capital, posCount, sentiment);

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 500,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API returned ${response.status}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data?.choices?.[0]?.message?.content || '';
  const cleaned = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned) as AIReasoning;

  log.info('AI reasoning generated [OpenAI]', { summary: parsed.summary.slice(0, 80) });
  return parsed;
}

/**
 * Intelligent fallback — generates reasoning without API call
 * Uses the quantitative data to produce structured explanations
 */
function buildFallbackReasoning(
  strategy: StrategyOutput,
  risk: RiskDecision,
): AIReasoning {
  const dir = strategy.signal.direction;
  const conf = strategy.signal.confidence;
  const vol = risk.volatility;
  const cb = risk.circuitBreaker;
  const price = strategy.currentPrice;

  // Market context
  let marketContext: string;
  if (vol.regime === 'extreme') {
    marketContext = `Market showing extreme volatility (${vol.ratio.toFixed(1)}x baseline). Risk-off conditions prevail.`;
  } else if (vol.regime === 'high') {
    marketContext = `Elevated volatility at ${vol.ratio.toFixed(1)}x baseline. Price at $${price.toFixed(2)} with increased uncertainty.`;
  } else if (vol.regime === 'low') {
    marketContext = `Low volatility environment (${vol.ratio.toFixed(1)}x baseline). Price consolidating around $${price.toFixed(2)}.`;
  } else {
    marketContext = `Normal market conditions. Price at $${price.toFixed(2)} with volatility at ${vol.ratio.toFixed(1)}x baseline.`;
  }

  // Trade rationale
  let tradeRationale: string;
  if (!risk.approved) {
    const failed = risk.checks.filter(c => !c.passed).map(c => c.name);
    if (cb.active) {
      tradeRationale = `Circuit breaker active — ${cb.reason}. All trading halted to protect capital.`;
    } else if (dir === 'NEUTRAL') {
      tradeRationale = 'No clear trend detected. SMA lines converging — waiting for decisive breakout.';
    } else {
      tradeRationale = `${dir} signal detected but blocked by: ${failed.join(', ')}. Protective measures preventing execution.`;
    }
  } else {
    const smaSpread = strategy.indicators.smaFast && strategy.indicators.smaSlow
      ? Math.abs(strategy.indicators.smaFast - strategy.indicators.smaSlow) / strategy.indicators.smaSlow * 100
      : 0;
    tradeRationale = `${dir} signal with ${(conf * 100).toFixed(0)}% confidence. SMA spread at ${smaSpread.toFixed(1)}%. Position sized to ${(risk.finalPositionSize * price / 10000 * 100).toFixed(1)}% of capital with ATR-based stop.`;
  }

  // Risk narrative
  let riskNarrative: string;
  const passCount = risk.checks.filter(c => c.passed).length;
  if (passCount === risk.checks.length) {
    riskNarrative = `All ${passCount} risk checks passed. Daily PnL at ${(cb.dailyPnlPct * 100).toFixed(2)}%, drawdown at ${(cb.drawdownPct * 100).toFixed(2)}% — well within limits.`;
  } else {
    riskNarrative = `${passCount}/${risk.checks.length} checks passed. ${risk.checks.filter(c => !c.passed).map(c => c.detail).join('. ')}`;
  }

  // Confidence factors
  const factors: string[] = [];
  if (conf > 0.7) factors.push('Strong SMA trend alignment');
  else if (conf > 0.3) factors.push('Moderate trend signal');
  else factors.push('Weak/ambiguous signal');

  if (vol.regime === 'normal' || vol.regime === 'low') factors.push('Stable volatility environment');
  if (cb.drawdownPct < 0.03) factors.push('Low drawdown — portfolio healthy');
  if (strategy.indicators.atr) factors.push(`ATR-based stop at ${strategy.indicators.atr.toFixed(2)}`);

  // Watch items
  const watchItems: string[] = [];
  if (vol.ratio > 1.3) watchItems.push('Volatility trending above baseline');
  if (cb.dailyPnlPct < -0.01) watchItems.push('Daily PnL turning negative');
  if (conf < 0.3) watchItems.push('Low confidence — trend may reverse');
  if (watchItems.length === 0) watchItems.push('Monitor for volatility regime change');

  // Summary
  const summary = risk.approved
    ? `Executing ${dir} ${risk.finalPositionSize.toFixed(4)} units at $${price.toFixed(2)} — ${passCount} checks passed, ${(conf * 100).toFixed(0)}% confidence.`
    : `${dir} signal rejected — ${risk.checks.filter(c => !c.passed).map(c => c.name).join(', ')}.`;

  return { marketContext, tradeRationale, riskNarrative, confidenceFactors: factors, watchItems, summary };
}

/**
 * Generate a portfolio-level AI analysis (for daily summaries)
 */
export async function generatePortfolioAnalysis(
  capital: number,
  initialCapital: number,
  totalTrades: number,
  openPositions: number,
  dailyPnl: number,
  drawdownPct: number,
): Promise<string> {
  const pnlPct = ((capital - initialCapital) / initialCapital * 100).toFixed(2);
  const health = drawdownPct < 0.03 ? 'healthy' : drawdownPct < 0.06 ? 'cautious' : 'stressed';

  return `Portfolio ${health}: $${capital.toFixed(0)} (${pnlPct}% total return). ` +
    `${totalTrades} trades executed, ${openPositions} positions open. ` +
    `Daily PnL: $${dailyPnl.toFixed(2)}, drawdown: ${(drawdownPct * 100).toFixed(2)}%.`;
}

export type { AIReasoning };
