import { config } from '../agent/config.js';
import type { StrategyOutput } from '../strategy/momentum.js';
import type { RiskDecision, RiskCheck } from '../risk/engine.js';

export interface AgentMandate {
  agentName: string;
  capitalLimitUsd: number;
  maxTradeSizePct: number;
  maxDailyLossPct: number;
  allowedAssets: string[];
  allowedProtocols: string[];
  restrictedAssets: string[];
  restrictedProtocols: string[];
  requireHumanApprovalAboveUsd: number;
  mandateVersion: string;
}

export interface MandateCheck {
  name: string;
  passed: boolean;
  value: string;
  limit: string;
  detail: string;
}

export interface MandateDecision {
  approved: boolean;
  requiresHumanApproval: boolean;
  checks: MandateCheck[];
  reasons: string[];
  normalizedAsset: string;
  normalizedProtocol: string;
}

export function getDefaultMandate(capitalLimitUsd = 100000): AgentMandate {
  return {
    agentName: config.agentName,
    capitalLimitUsd,
    maxTradeSizePct: config.maxPositionPct,
    maxDailyLossPct: config.maxDailyLossPct,
    allowedAssets: config.allowedAssets,
    allowedProtocols: config.allowedProtocols,
    restrictedAssets: config.restrictedAssets,
    restrictedProtocols: config.restrictedProtocols,
    requireHumanApprovalAboveUsd: config.requireHumanApprovalAboveUsd,
    mandateVersion: '1.0',
  };
}

export function buildMandateMetadataJson(mandate: AgentMandate): object {
  return {
    mandateVersion: mandate.mandateVersion,
    agentName: mandate.agentName,
    capitalLimitUsd: mandate.capitalLimitUsd,
    maxTradeSizePct: mandate.maxTradeSizePct,
    maxDailyLossPct: mandate.maxDailyLossPct,
    allowedAssets: mandate.allowedAssets,
    allowedProtocols: mandate.allowedProtocols,
    restrictedAssets: mandate.restrictedAssets,
    restrictedProtocols: mandate.restrictedProtocols,
    requireHumanApprovalAboveUsd: mandate.requireHumanApprovalAboveUsd,
  };
}

export function buildMandateRiskChecks(decision: MandateDecision): RiskCheck[] {
  return decision.checks.map((c) => ({
    name: `mandate_${c.name}`,
    passed: c.passed,
    value: c.value,
    limit: c.limit,
    detail: c.detail,
  }));
}

export function evaluateMandate(params: {
  mandate?: AgentMandate;
  strategyOutput: StrategyOutput;
  capitalUsd: number;
  riskDecision?: RiskDecision | null;
  protocol?: string;
  asset?: string;
  dailyPnlPct?: number;
}): MandateDecision {
  const mandate = params.mandate ?? getDefaultMandate(Math.max(params.capitalUsd, 10000));
  const normalizedAsset = normalizeAsset(params.asset ?? config.tradingPair);
  const normalizedProtocol = normalizeProtocol(params.protocol ?? defaultProtocol());
  const proposedUsd = params.strategyOutput.positionSize * params.strategyOutput.currentPrice;
  const tradePct = params.capitalUsd > 0 ? proposedUsd / params.capitalUsd : 0;
  const dailyPnlPct = params.dailyPnlPct ?? params.riskDecision?.circuitBreaker.dailyPnlPct ?? 0;

  const checks: MandateCheck[] = [];

  checks.push({
    name: 'asset_allowed',
    passed: isAssetAllowed(normalizedAsset, mandate),
    value: normalizedAsset,
    limit: mandate.allowedAssets.join(', ') || 'any',
    detail: isAssetAllowed(normalizedAsset, mandate) ? 'Asset within mandate' : 'Asset not in allowed list or is restricted',
  });

  checks.push({
    name: 'protocol_allowed',
    passed: isProtocolAllowed(normalizedProtocol, mandate),
    value: normalizedProtocol,
    limit: mandate.allowedProtocols.join(', ') || 'any',
    detail: isProtocolAllowed(normalizedProtocol, mandate) ? 'Protocol within mandate' : 'Protocol not in allowed list or is restricted',
  });

  checks.push({
    name: 'trade_size_limit',
    passed: tradePct <= mandate.maxTradeSizePct + 1e-9,
    value: `${(tradePct * 100).toFixed(2)}%`,
    limit: `${(mandate.maxTradeSizePct * 100).toFixed(2)}%`,
    detail: proposedUsd > 0 ? `Proposed notional $${proposedUsd.toFixed(2)}` : 'No trade proposed',
  });

  checks.push({
    name: 'daily_loss_limit',
    passed: Math.abs(dailyPnlPct) <= mandate.maxDailyLossPct + 1e-9,
    value: `${(dailyPnlPct * 100).toFixed(2)}%`,
    limit: `${(mandate.maxDailyLossPct * 100).toFixed(2)}%`,
    detail: dailyPnlPct < 0 ? 'Current draw on daily PnL budget' : 'Daily PnL within mandate',
  });

  const requiresHumanApproval = proposedUsd >= mandate.requireHumanApprovalAboveUsd && proposedUsd > 0;
  checks.push({
    name: 'human_approval_threshold',
    passed: !requiresHumanApproval,
    value: `$${proposedUsd.toFixed(2)}`,
    limit: `$${mandate.requireHumanApprovalAboveUsd.toFixed(2)}`,
    detail: requiresHumanApproval ? 'Trade exceeds auto-approval limit' : 'Within autonomous approval band',
  });

  const reasons = checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);

  return {
    approved: checks.every((c) => c.passed || c.name === 'human_approval_threshold'),
    requiresHumanApproval,
    checks,
    reasons,
    normalizedAsset,
    normalizedProtocol,
  };
}

export function isAssetAllowed(asset: string, mandate: AgentMandate): boolean {
  const a = normalizeAsset(asset);
  if (mandate.restrictedAssets.map(normalizeAsset).includes(a)) return false;
  if (mandate.allowedAssets.length === 0) return true;
  return mandate.allowedAssets.map(normalizeAsset).includes(a);
}

export function isProtocolAllowed(protocol: string, mandate: AgentMandate): boolean {
  const p = normalizeProtocol(protocol);
  if (mandate.restrictedProtocols.map(normalizeProtocol).includes(p)) return false;
  if (mandate.allowedProtocols.length === 0) return true;
  return mandate.allowedProtocols.map(normalizeProtocol).includes(p);
}

export function normalizeAsset(asset: string): string {
  return asset.trim().toUpperCase();
}

export function normalizeProtocol(protocol: string): string {
  return protocol.trim().toLowerCase();
}

function defaultProtocol(): string {
  return config.allowedProtocols[0] ?? 'uniswap';
}
