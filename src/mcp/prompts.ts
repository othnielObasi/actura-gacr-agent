
/**
 * MCP Prompts
 * Guided prompts for explanations, operator workflows, and audit reporting.
 */

import { getLastCheckpoint, getCheckpoint } from '../trust/checkpoint.js';
import { getLastTrustScore } from '../trust/trust-policy-scorecard.js';
import { getOperatorControlState, getLatestOperatorAction } from '../agent/operator-control.js';
import { getAgentState } from '../agent/index.js';

export type McpVisibility = 'public' | 'restricted' | 'operator';

export interface McpPrompt {
  name: string;
  description: string;
  visibility: McpVisibility;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
  handler: (args: Record<string, unknown>) => Promise<{ text: string }> | { text: string };
}

const explainCurrentTrade: McpPrompt = {
  name: 'explain_current_trade',
  description: 'Generate a concise human explanation of the latest or selected trade decision.',
  visibility: 'public',
  arguments: [{ name: 'trade_id', description: 'Optional checkpoint/trade id', required: false }],
  handler: (args) => {
    const cp = typeof args.trade_id === 'number' ? getCheckpoint(args.trade_id) : getLastCheckpoint();
    if (!cp) {
      return { text: 'No trade checkpoint is available yet. Ask again after the runtime has evaluated at least one cycle.' };
    }
    const trustScore = getLastTrustScore(getAgentState()?.agentId ?? null);
    return {
      text: [
        `Trade ${cp.id} was ${cp.riskDecision.approved ? 'approved' : 'blocked'}.`,
        `Signal direction: ${cp.strategyOutput?.signal?.direction ?? 'unknown'}.`,
        `Confidence: ${cp.strategyOutput?.signal?.confidence ?? 'n/a'}.`,
        `Reason: ${cp.riskDecision.explanation}.`,
        `Trust score at decision time: ${trustScore ?? 'n/a'}.`,
        `Receipt: ${cp.ipfs?.uri || 'not pinned yet'}.`,
      ].join(' '),
    };
  },
};

const summarizeRiskState: McpPrompt = {
  name: 'summarize_risk_state',
  description: 'Summarize the current risk, operator, and trust posture of the runtime.',
  visibility: 'public',
  arguments: [],
  handler: () => {
    const state = getAgentState();
    const operator = getOperatorControlState();
    const trustScore = getLastTrustScore(state?.agentId ?? null);
    return {
      text: [
        `Actura is currently ${state?.running ? 'running' : 'not running'}.`,
        `Operator mode is ${operator.mode}.`,
        `Current trust score is ${trustScore ?? 'not available'}.`,
        `Open positions: ${state?.risk?.openPositions?.length ?? 0}.`,
        `Total trades: ${state?.risk?.totalTrades ?? 0}.`,
      ].join(' '),
    };
  },
};

const prepareOperatorIncidentReport: McpPrompt = {
  name: 'prepare_operator_incident_report',
  description: 'Prepare an incident report after a pause or emergency stop.',
  visibility: 'operator',
  arguments: [{ name: 'incident_context', description: 'Optional operator context', required: false }],
  handler: (args) => {
    const latest = getLatestOperatorAction();
    const state = getAgentState();
    return {
      text: [
        '# Actura Incident Report',
        '',
        `Operator mode: ${getOperatorControlState().mode}`,
        `Latest action: ${latest?.action ?? 'none'}`,
        `Reason: ${latest?.reason ?? String(args.incident_context || 'not provided')}`,
        `Affected cycles: ${state?.cycleCount ?? 0}`,
        `Open positions at report time: ${state?.risk?.openPositions?.length ?? 0}`,
        `Capital at report time: ${state?.risk?.capital ?? 0}`,
      ].join('\n'),
    };
  },
};

const summarizeTrustEvolution: McpPrompt = {
  name: 'summarize_trust_evolution',
  description: 'Summarize how trust has recently evolved and what it means for capital rights.',
  visibility: 'public',
  arguments: [],
  handler: () => {
    const state = getAgentState();
    const trustScore = getLastTrustScore(state?.agentId ?? null);
    return {
      text: [
        `Latest trust score: ${trustScore ?? 'n/a'}.`,
        `This score influences whether the runtime is blocked, probationary, limited, standard, or expanded in its capital rights.`,
        `Use the capital-rights visualizer and trust ladder to inspect the active tier and multiplier.`,
      ].join(' '),
    };
  },
};

export const ALL_PROMPTS: McpPrompt[] = [
  explainCurrentTrade,
  summarizeRiskState,
  prepareOperatorIncidentReport,
  summarizeTrustEvolution,
];
