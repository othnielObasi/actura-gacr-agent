/**
 * DEX Router — Governed Best-Execution Routing
 * 
 * Compares execution quality across supported DEXes (Aerodrome, Uniswap)
 * and selects the best venue for each trade. Every routing decision is
 * recorded as an auditable artifact proving WHY one venue was chosen.
 *
 * Aerodrome (Base-native ve(3,3) AMM):
 *   - Volatile pools: ~30 bps base fee
 *   - Stable pools: ~1 bps base fee
 *   - Concentrated liquidity (slippage CL) available
 *   - Router2: 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43 (Base mainnet)
 *
 * Uniswap v3 (Base deployment):
 *   - Dynamic fee tiers: 1, 5, 30, 100 bps
 *   - Concentrated liquidity (tick ranges)
 *   - Router: 0x2626664c2603336E57B271c5C0b26F421741e481 (Base mainnet)
 */

import { createLogger } from '../agent/logger.js';

const log = createLogger('DEX-ROUTER');

// ── DEX Profiles ──

export type DexId = 'aerodrome' | 'uniswap';

export interface DexProfile {
  id: DexId;
  name: string;
  /** Base fee in bps for the relevant pool type */
  baseFeeBps: number;
  /** Additional gas cost estimate in USD */
  gasOverheadUsd: number;
  /** Liquidity depth multiplier (1.0 = baseline, >1 = deeper) */
  liquidityMultiplier: number;
  /** Router contract address (Base) */
  routerAddress: string;
  /** Whether this DEX is available on Base Sepolia testnet */
  testnetAvailable: boolean;
}

const DEX_PROFILES: Record<DexId, DexProfile> = {
  aerodrome: {
    id: 'aerodrome',
    name: 'Aerodrome Finance',
    baseFeeBps: 30,           // volatile pool default
    gasOverheadUsd: 0.15,     // Base L2 gas is cheap
    liquidityMultiplier: 1.2, // deepest liquidity on Base for major pairs
    routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
    testnetAvailable: false,
  },
  uniswap: {
    id: 'uniswap',
    name: 'Uniswap v3',
    baseFeeBps: 30,           // 0.30% tier (most common for ETH pairs)
    gasOverheadUsd: 0.20,
    liquidityMultiplier: 1.0, // baseline
    routerAddress: '0x2626664c2603336E57B271c5C0b26F421741e481',
    testnetAvailable: true,
  },
};

// ── Routing Decision ──

export interface DexQuote {
  dex: DexId;
  estimatedFeeBps: number;
  estimatedSlippageBps: number;
  estimatedTotalCostBps: number;
  estimatedGasUsd: number;
  liquidityScore: number;       // 0-1; higher = deeper liquidity for this size
  available: boolean;
  reason: string;
}

export interface RoutingDecision {
  selectedDex: DexId;
  quotes: DexQuote[];
  savingsBps: number;           // cost advantage over worst venue
  rationale: string[];
  timestamp: string;
  routingVersion: string;
}

export interface RoutingInput {
  asset: string;                // e.g. 'WETH/USDC'
  side: 'LONG' | 'SHORT';
  notionalUsd: number;
  volatility: number;           // current vol estimate
  isTestnet: boolean;           // Base Sepolia = true
  enabledDexes?: DexId[];       // override from config
}

// ── Quote Estimation ──

function estimateQuote(
  profile: DexProfile,
  input: RoutingInput,
): DexQuote {
  // On testnet, only DEXes with testnet deployments are available
  if (input.isTestnet && !profile.testnetAvailable) {
    return {
      dex: profile.id,
      estimatedFeeBps: profile.baseFeeBps,
      estimatedSlippageBps: 0,
      estimatedTotalCostBps: 0,
      estimatedGasUsd: 0,
      liquidityScore: 0,
      available: false,
      reason: `${profile.name} integrated but not deployed on testnet — mainnet-ready (router: ${profile.routerAddress})`,
    };
  }

  // Base fee from the pool
  const feeBps = profile.baseFeeBps;

  // Slippage model: volatility-driven + size-based pressure
  // Deeper liquidity = lower slippage for the same trade size
  const baseLiquidityUsd = 50_000 * profile.liquidityMultiplier;
  const sizePressure = Math.min(1.5, input.notionalUsd / baseLiquidityUsd);
  const volComponent = input.volatility * 400; // calibrated for 4h candles
  const slippageBps = Math.round((4 + volComponent + sizePressure * 12) * 100) / 100;

  const totalCostBps = Math.round((feeBps + slippageBps) * 100) / 100;

  // Liquidity score: how much of the trade the pool can absorb cleanly
  const liquidityScore = Math.min(1.0, baseLiquidityUsd / Math.max(input.notionalUsd, 1));

  return {
    dex: profile.id,
    estimatedFeeBps: feeBps,
    estimatedSlippageBps: Math.round(slippageBps * 100) / 100,
    estimatedTotalCostBps: totalCostBps,
    estimatedGasUsd: profile.gasOverheadUsd,
    liquidityScore: Math.round(liquidityScore * 1000) / 1000,
    available: true,
    reason: 'quote_available',
  };
}

// ── Best Execution Router ──

export function routeTrade(input: RoutingInput): RoutingDecision {
  const enabledDexes = input.enabledDexes ?? (Object.keys(DEX_PROFILES) as DexId[]);

  // Get quotes from all enabled DEXes
  const quotes: DexQuote[] = enabledDexes
    .filter(id => DEX_PROFILES[id])
    .map(id => estimateQuote(DEX_PROFILES[id], input));

  // Filter to available quotes
  const available = quotes.filter(q => q.available);

  if (available.length === 0) {
    // Fallback: return first enabled DEX even if unavailable (let Risk Router handle)
    const fallback = enabledDexes[0] ?? 'uniswap';
    log.warn('No DEX quotes available — using fallback', { fallback });
    return {
      selectedDex: fallback,
      quotes,
      savingsBps: 0,
      rationale: [`No DEX available on ${input.isTestnet ? 'testnet' : 'mainnet'} — fallback to ${fallback}`],
      timestamp: new Date().toISOString(),
      routingVersion: '1.0',
    };
  }

  // Select best venue by total cost (fee + slippage + gas-adjusted)
  // Gas is normalized to bps for fair comparison
  const scored = available.map(q => {
    const gasBps = input.notionalUsd > 0 ? (q.estimatedGasUsd / input.notionalUsd) * 10000 : 0;
    return { quote: q, effectiveCostBps: q.estimatedTotalCostBps + gasBps };
  }).sort((a, b) => a.effectiveCostBps - b.effectiveCostBps);

  const best = scored[0];
  const worst = scored[scored.length - 1];
  const savingsBps = Math.round((worst.effectiveCostBps - best.effectiveCostBps) * 100) / 100;

  const rationale: string[] = [];
  rationale.push(`Best execution: ${DEX_PROFILES[best.quote.dex].name} (${best.effectiveCostBps.toFixed(1)} bps effective cost)`);

  if (scored.length > 1) {
    rationale.push(`vs ${DEX_PROFILES[worst.quote.dex].name} (${worst.effectiveCostBps.toFixed(1)} bps) — saving ${savingsBps.toFixed(1)} bps`);
  }

  if (best.quote.liquidityScore < 0.5) {
    rationale.push(`Warning: liquidity score ${best.quote.liquidityScore} — trade may experience higher slippage`);
  }

  log.info('Route selected', {
    dex: best.quote.dex,
    totalCostBps: best.effectiveCostBps.toFixed(1),
    savingsBps,
    notionalUsd: input.notionalUsd.toFixed(2),
  });

  return {
    selectedDex: best.quote.dex,
    quotes,
    savingsBps,
    rationale,
    timestamp: new Date().toISOString(),
    routingVersion: '1.0',
  };
}

// ── Helpers ──

export function getDexProfile(id: DexId): DexProfile | undefined {
  return DEX_PROFILES[id];
}

export function getAvailableDexes(isTestnet: boolean): DexId[] {
  return (Object.values(DEX_PROFILES) as DexProfile[])
    .filter(p => !isTestnet || p.testnetAvailable)
    .map(p => p.id);
}

export function getDexFeeBps(id: DexId): number {
  return DEX_PROFILES[id]?.baseFeeBps ?? 30;
}
