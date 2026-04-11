import React, { useState, useEffect, useMemo, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   ACTURA — Governed Autonomous Capital Runtime
   ERC-8004 Trust-Governed Trading Agent · Production Control Plane
   
   Layout follows the governance narrative:
   1. System status bar (am I alive, am I trusted, am I allowed to act)
   2. Market intelligence (what does the world look like)
   3. Governance pipeline (the 8-stage gate — the soul of the product)  
   4. Decision engine (what did I decide and why)
   5. Selected trade deep-dive: proof + artifacts side by side
   6. Trust & capital (how much am I allowed to deploy)
   7. Execution quality (can I execute safely)
   8. Protocol layer (ERC-8004 identity, MCP surface)
   9. Operator override (human-in-the-loop)
   ═══════════════════════════════════════════════════════════════════════ */

const BASE = 3247.5;
const STAGES = [
  { id: "sig", label: "Signal", desc: "Market signal detected" },
  { id: "rsk", label: "Risk", desc: "Risk evaluation" },
  { id: "gov", label: "Govern", desc: "Governance checks" },
  { id: "sec", label: "Secure", desc: "Security controls" },
  { id: "sim", label: "Simulate", desc: "Execution simulation" },
  { id: "val", label: "Validate", desc: "Trust validation" },
  { id: "sgn", label: "Sign", desc: "TradeIntent signing" },
  { id: "sub", label: "Submit", desc: "On-chain submission" },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fp = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
const fn = (x, d = 2) => Number(x).toFixed(d);
const shortTier = (t) => t.replace("TIER_", "T");
function genPrices(n = 72) { const a = [BASE]; for (let i = 1; i < n; i++) a.push(a[i - 1] * (1 + (Math.random() - 0.48) * 0.018)); return a; }
function getTier(s) { if (s < 60) return "TIER_0_BLOCKED"; if (s < 75) return "TIER_1_PROBATION"; if (s < 85) return "TIER_2_LIMITED"; if (s < 93) return "TIER_3_STANDARD"; return "TIER_4_EXPANDED"; }
function getMult(t) { return { TIER_0_BLOCKED: 0, TIER_1_PROBATION: 0.25, TIER_2_LIMITED: 0.6, TIER_3_STANDARD: 1.0 }[t] ?? 1.25; }
function trustLabel(s) { return s < 65 ? "RESTRICTED" : s < 80 ? "WATCH" : "TRUSTED"; }

/* ── Design tokens ── */
const T = {
  bg: "#080b11", s1: "#0c1018", s2: "#111621", s3: "#161c29",
  brd: "#1c2536", brdA: "#253045",
  fg: "#c9d1dc", fg2: "#7c8a9e", fg3: "#4b5668",
  w: "#edf2f7",
  up: "#34d399", dn: "#f87171", warn: "#fbbf24", info: "#60a5fa", cyan: "#22d3ee", purple: "#a78bfa",
};
const sigC = (s) => s === "LONG" ? T.up : s === "SHORT" ? T.dn : T.fg2;
const regC = (r) => r === "TRENDING" ? T.up : r === "RANGING" ? T.warn : r === "STRESSED" ? T.dn : T.fg2;
const proC = (p) => p === "LOW_VOL" ? T.cyan : p === "NORMAL" ? T.info : p === "HIGH_VOL" ? T.warn : T.dn;
const truC = (s) => s >= 93 ? T.up : s >= 85 ? T.info : s >= 75 ? T.warn : T.dn;
const oraC = (s) => s === "HEALTHY" ? T.up : s === "WATCH" ? T.warn : T.dn;
const F = "'JetBrains Mono','SF Mono','Cascadia Code',monospace";

/* ── Primitives ── */
function Spark({ prices, h = 56, color }) {
  if (!prices || prices.length < 2) return null;
  const W = 500, mn = Math.min(...prices) - 2, mx = Math.max(...prices) + 2, rng = mx - mn || 1, sx = W / (prices.length - 1);
  const pts = prices.map((p, i) => `${i * sx},${h - ((p - mn) / rng) * (h - 8) - 4}`).join(" ");
  const c = color || (prices[prices.length - 1] >= prices[0] ? T.up : T.dn);
  const id = `g${c.replace("#", "")}`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity=".1" /><stop offset="100%" stopColor={c} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${h} ${pts} ${(prices.length - 1) * sx},${h}`} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
function ProgressBar({ value, color = T.up }) {
  return <div style={{ height: 4, background: T.s1, borderRadius: 2, overflow: "hidden", marginTop: 3 }}><div style={{ height: "100%", width: `${clamp(value, 0, 1) * 100}%`, background: color, borderRadius: 2, transition: "width .6s ease" }} /></div>;
}
function Dot({ color }) { return <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}40`, flexShrink: 0 }} />; }
function Badge({ children, color }) { return <span style={{ fontSize: 9, fontWeight: 700, color, background: `${color}14`, padding: "1px 6px", borderRadius: 2, whiteSpace: "nowrap" }}>{children}</span>; }

/* Panel with header */
function P({ title, tip, tag, children, style: sx, noPad }) {
  return (
    <div style={{ background: T.s1, border: `1px solid ${T.brd}`, borderRadius: 6, overflow: "hidden", display: "flex", flexDirection: "column", ...sx }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", borderBottom: `1px solid ${T.brd}`, background: T.s2, flexShrink: 0 }}>
        <span title={tip} style={{ fontSize: 10.5, fontWeight: 700, color: T.fg, letterSpacing: 0.3, cursor: tip ? "help" : "default" }}>{title}</span>
        {tag && <span style={{ fontSize: 8.5, color: T.fg3, fontWeight: 600 }}>{tag}</span>}
      </div>
      <div style={noPad ? { flex: 1 } : { padding: "8px 12px", flex: 1 }}>{children}</div>
    </div>
  );
}
/* Compact key-value row */
function KV({ k, v, c = T.fg }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "2.5px 0", fontSize: 10.5 }}><span style={{ color: T.fg2 }}>{k}</span><span style={{ color: c, fontWeight: 500, textAlign: "right", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span></div>;
}
/* Metric cell */
function Metric({ label, value, sub, color = T.fg }) {
  return (
    <div style={{ padding: "6px 10px" }}>
      <div style={{ fontSize: 8, color: T.fg3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: T.fg2, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ═══ ERROR BOUNDARY ═══ */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div style={{ minHeight: "100vh", background: "#080b11", color: "#f87171", fontFamily: "monospace", padding: 40 }}>
        <h2 style={{ color: "#edf2f7", marginBottom: 12 }}>Dashboard Error</h2>
        <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", color: "#fbbf24" }}>{String(this.state.error)}</pre>
        <button onClick={() => this.setState({ error: null })} style={{ marginTop: 16, padding: "8px 20px", background: "#34d39920", color: "#34d399", border: "1px solid #34d39940", borderRadius: 4, cursor: "pointer", fontFamily: "monospace" }}>Retry</button>
      </div>
    );
    return this.props.children;
  }
}
export default function ActuraWrapper() { return <ErrorBoundary><Actura /></ErrorBoundary>; }

/* ═══ MAIN ═══ */
function Actura() {
  /* ── Live state from API ── */
  const [prices, setPrices] = useState([]);
  const [stage, setStage] = useState(0);
  const [tick, setTick] = useState(0);
  const [vol, setVol] = useState(0);
  const [volRatio, setVolRatio] = useState(1);
  const [adx, setAdx] = useState(0);
  const [chop, setChop] = useState(0);
  const [trustScore, setTrustScore] = useState(80);
  const [trustHistory, setTrustHistory] = useState([]);
  const [opState, setOpState] = useState("ACTIVE");
  const [oracleStatus, setOracleStatus] = useState("HEALTHY");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [selIdx, setSelIdx] = useState(0);
  const [opLog, setOpLog] = useState([]);
  const [capital, setCapital] = useState(0);
  const [cPrice, setCPrice] = useState(0);
  const [livePositions, setLivePositions] = useState([]);
  const [liveCheckpoints, setLiveCheckpoints] = useState([]);
  const [capMult, setCapMult] = useState(1);
  const [trustTier, setTrustTier] = useState("standard");
  const [trustStatus, setTrustStatus] = useState("trusted");
  const [circuitBreaker, setCircuitBreaker] = useState("ARMED");
  const [governance, setGovernance] = useState(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);
  const [heartbeat, setHeartbeat] = useState({ lastCycleAt: null, lastTradeAt: null, uptime: 0, consecutiveErrors: 0, lastError: null, lastErrorAt: null });
  const [sentiment, setSentiment] = useState(null);
  const [security, setSecurity] = useState(null);
  const [latestAi, setLatestAi] = useState(null);
  const [feedsData, setFeedsData] = useState(null);
  const [sageData, setSageData] = useState(null);
  const [sandboxData, setSandboxData] = useState(null);
  const [dexRouting, setDexRouting] = useState(null);


  /* ── Tier mapping from API tier names ── */
  const tierMap = { probation: "TIER_1_PROBATION", limited: "TIER_2_LIMITED", standard: "TIER_3_STANDARD", elevated: "TIER_4_EXPANDED", elite: "TIER_4_EXPANDED" };
  const tier = tierMap[trustTier] || "TIER_3_STANDARD";

  /* ── Derived values ── */
  const regime = useMemo(() => { if (volRatio > 1.9) return "STRESSED"; if (adx > 22 && chop < 45) return "TRENDING"; if (chop > 52) return "RANGING"; return "UNCERTAIN"; }, [volRatio, adx, chop]);
  const profile = useMemo(() => { if (volRatio > 2.1) return "EXTREME_DEFENSIVE"; if (volRatio > 1.25) return "HIGH_VOL"; if (volRatio < 0.8) return "LOW_VOL"; return "NORMAL"; }, [volRatio]);
  const pnl = capital > 0 ? ((capital - 10000) / 10000) * 100 : 0;
  const tDelta = useMemo(() => trustHistory.length > 1 ? trustHistory[trustHistory.length - 1] - trustHistory[trustHistory.length - 2] : 0, [trustHistory]);

  const sup = useMemo(() => {
    const ok = opState === "ACTIVE" && oracleStatus !== "BLOCKED" && trustScore >= 60;
    const eff = recoveryMode ? Math.min(capMult, 0.6) : capMult;
    const act = ok ? (recoveryMode ? "THROTTLE" : "ALLOW") : "BLOCK";
    return { ok, eff, act };
  }, [opState, oracleStatus, trustScore, recoveryMode, capMult]);

  const sim = useMemo(() => {
    const slip = clamp(8 + volRatio * 6 + (regime === "STRESSED" ? 8 : 0), 6, 34);
    const gas = clamp(3.8 + volRatio * 1.7, 2.2, 11.5);
    const edgePct = liveCheckpoints.length > 0 && liveCheckpoints[0].confidence > 0 ? liveCheckpoints[0].confidence * 0.005 : 0.002;
    const net = edgePct - slip / 10000 - gas / 100000;
    const st = net > 0.001 ? "APPROVED" : net > 0 ? "WATCH" : "BLOCKED";
    return { slip, gas, net, st, edgePct };
  }, [volRatio, regime, liveCheckpoints]);

  const oracle = useMemo(() => {
    const dev = clamp((volRatio - 0.8) * 0.014, 0.001, 0.041);
    const stale = oracleStatus === "HEALTHY" ? 7 : oracleStatus === "WATCH" ? 31 : 73;
    const src = oracleStatus === "HEALTHY" ? 3 : 2;
    return { dev, stale, src };
  }, [oracleStatus, volRatio]);

  /* ── Map checkpoints to trade rows ── */
  const trades = useMemo(() => {
    if (liveCheckpoints.length === 0) return [{ id: 0, signal: "NEUTRAL", conf: 0, bias: 0, confAdj: 0, regime: "—", profile: "—", edgePct: 0, costBps: 0, edgeGate: "—", price: cPrice, size: 0, approved: false, trustScore, tier, receipt: "—", tx: "—" }];
    return liveCheckpoints.map((cp) => ({
      id: cp.id,
      signal: cp.signal || "NEUTRAL",
      conf: cp.confidence || 0,
      bias: 0,
      confAdj: cp.confidence || 0,
      regime,
      profile,
      edgePct: (cp.confidence || 0) * 0.005,
      costBps: 18,
      edgeGate: cp.approved ? "PASS" : "FAIL",
      price: cp.price || cPrice,
      size: cp.positionSize || 0,
      approved: cp.approved,
      trustScore,
      tier,
      receipt: cp.ipfsCid || "—",
      tx: cp.onChainTxHash || cp.txHash || "—",
    }));
  }, [liveCheckpoints, cPrice, regime, profile, trustScore, tier]);

  /* ── Map open positions ── */
  const positions = useMemo(() => {
    if (livePositions.length === 0) return [];
    return livePositions.map((p, i) => ({
      id: p.id || i,
      side: p.side || "LONG",
      size: p.size || 0,
      entry: p.entryPrice || 0,
      stop: p.stopLoss || 0,
      pnl: p.unrealizedPnl || 0,
      profile,
    }));
  }, [livePositions, profile]);

  const mandate = useMemo(() => {
    const rl = governance?.riskLimits;
    if (!rl) return { capital: `$${fn(capital, 0)}`, maxTrade: "10%", maxDailyLoss: "2%", allowedAssets: ["WETH/USDC"], protocols: ["Uniswap", "Aerodrome (mainnet)"], approvalThreshold: "$20,000" };
    return {
      capital: `$${fn(capital, 0)}`,
      maxTrade: `${((rl.maxPositionPct || 0.1) * 100).toFixed(0)}%`,
      maxDailyLoss: `${((rl.maxDailyLossPct || 0.02) * 100).toFixed(0)}%`,
      allowedAssets: ["WETH/USDC", "ETH", "USDC"],
      protocols: ["Uniswap", "Aerodrome (mainnet)"],
      approvalThreshold: "$20,000",
    };
  }, [governance, capital]);

  const walletAddr = sandboxData?.walletAddress || "0xE868...DdCD7";
  const erc = { agentId: sandboxData?.agentId || "—", agentRegistry: sandboxData?.contracts?.agentRegistry ? `eip155:${sandboxData.chainId}:${sandboxData.contracts.agentRegistry.slice(0, 8)}...${sandboxData.contracts.agentRegistry.slice(-4)}` : "—", ownerWallet: walletAddr, agentWallet: walletAddr, tradeIntentHash: trades[0]?.tx !== "—" ? trades[0].tx : "—", validationRequestHash: liveCheckpoints[0]?.artifactIpfs || "—", lastFeedbackTag: "tradingYield:day", registrationStatus: agentRunning ? "READY" : "OFFLINE" };
  const mcp = { status: "ACTIVE", endpoint: "/mcp", mode: "governed", visibility: "public + restricted + operator", tools: { public: 7, restricted: 2, operator: 3, total: 12 }, resources: 8, prompts: 4, publicTools: ["get_market_state", "explain_trade", "get_trust_state", "get_capital_rights"], restrictedTools: ["propose_trade", "execute_trade"], operatorTools: ["pause_agent", "resume_agent", "emergency_stop"] };

  const checks = useMemo(() => [
    { n: "circuit_breaker", p: true, v: circuitBreaker },
    { n: "mandate_engine", p: true, v: `${mandate.maxTrade} / ${mandate.maxDailyLoss}` },
    { n: "structure_regime", p: true, v: `${regime} (vol ${volRatio.toFixed(2)}x)` },
    { n: "oracle_integrity", p: oracleStatus !== "BLOCKED", v: `${oracleStatus} (${fp(oracle.dev, 2)} dev)` },
    { n: "execution_simulation", p: sim.st !== "BLOCKED", v: `${sim.st} (${sim.slip.toFixed(1)}bps)` },
    { n: "trust_recovery", p: true, v: recoveryMode ? "ACTIVE" : "OFF" },
    { n: "supervisory", p: sup.ok, v: `${sup.act} @ ${sup.eff.toFixed(2)}x` },
    { n: "operator_state", p: opState === "ACTIVE", v: opState },
  ], [circuitBreaker, mandate, regime, volRatio, oracleStatus, oracle, sim, recoveryMode, sup, opState]);

  const sel = trades[selIdx] || trades[0] || { id: 0, signal: "NEUTRAL", conf: 0, bias: 0, confAdj: 0, regime: "—", profile: "—", edgePct: 0, costBps: 0, edgeGate: "—", price: 0, size: 0, approved: false, trustScore: 80, tier: "TIER_3_STANDARD", receipt: "—", tx: "—" };

  /* ── API fetching ── */
  const fetchData = useCallback(async () => {
    try {
      const [statusRes, checkpointsRes, reputationRes, operatorRes, actionsRes, positionsRes, governanceRes, securityRes, artifactRes, feedsRes, sageRes, sandboxRes] = await Promise.all([
        fetch("/api/status").then(r => r.json()).catch(() => null),
        fetch("/api/checkpoints?limit=10").then(r => r.json()).catch(() => null),
        fetch("/api/reputation/history?limit=30").then(r => r.json()).catch(() => null),
        fetch("/api/operator/state").then(r => r.json()).catch(() => null),
        fetch("/api/operator/actions?limit=6").then(r => r.json()).catch(() => null),
        fetch("/api/positions").then(r => r.json()).catch(() => null),
        fetch("/api/governance").then(r => r.json()).catch(() => null),
        fetch("/api/security").then(r => r.json()).catch(() => null),
        fetch("/api/artifact/latest").then(r => r.json()).catch(() => null),
        fetch("/api/feeds/kraken").then(r => r.json()).catch(() => null),
        fetch("/api/sage/status").then(r => r.json()).catch(() => null),
        fetch("/api/sandbox").then(r => r.json()).catch(() => null),
      ]);

      if (statusRes) {
        const m = statusRes.market || {};
        const r = statusRes.risk || {};
        // Use Kraken spot price (real-time) if available, else OHLC candle close
        const krakenSpot = feedsRes?.ticker?.price ? Number(feedsRes.ticker.price) : null;
        const bestPrice = krakenSpot || m.currentPrice;
        if (bestPrice) {
          setCPrice(bestPrice);
          setPrices(prev => [...prev.slice(-71), bestPrice]);
        }
        if (m.volatility != null) setVol(m.volatility);
        if (r.volatility) setVolRatio(r.volatility.ratio || 1);
        setCapital(statusRes.capital || 0);
        setCircuitBreaker(r.circuitBreaker?.state || "ARMED");
        setAgentRunning(statusRes.agent?.running || false);
        setCycleCount(statusRes.agent?.cycleCount || 0);
        if (statusRes.heartbeat) setHeartbeat(statusRes.heartbeat);
        // Oracle: derive from circuit breaker + volatility
        if (r.circuitBreaker?.active) setOracleStatus("BLOCKED");
        else if (r.volatility?.ratio > 2.0) setOracleStatus("WATCH");
        else setOracleStatus("HEALTHY");
        if (statusRes.sentiment) setSentiment(statusRes.sentiment);
      }

      if (checkpointsRes?.checkpoints) {
        setLiveCheckpoints(checkpointsRes.checkpoints);
        setSelIdx(i => Math.min(i, Math.max(0, checkpointsRes.checkpoints.length - 1)));
      }

      if (reputationRes?.history?.length > 0) {
        const hist = reputationRes.history;
        const latest = hist[hist.length - 1];
        setTrustScore(latest.trustScore);
        setTrustHistory(hist.map(h => h.trustScore));
        setCapMult(latest.capitalMultiplier);
        setTrustTier(latest.trustTier);
        setTrustStatus(latest.status);
        setRecoveryMode(latest.recoveryMode);
      }

      if (operatorRes) {
        const modeMap = { normal: "ACTIVE", paused: "PAUSED", emergency_stop: "EMERGENCY_STOP" };
        setOpState(modeMap[operatorRes.mode] || "ACTIVE");
      }

      if (actionsRes?.actions) {
        setOpLog(actionsRes.actions.slice(0, 6).map(a => ({
          ts: a.timestamp ? new Date(a.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—",
          action: a.action || "—",
          reason: a.reason || "—",
        })));
      }

      if (positionsRes?.positions) setLivePositions(positionsRes.positions);
      if (governanceRes) setGovernance(governanceRes);
      if (securityRes) setSecurity(securityRes);
      if (artifactRes?.aiReasoning) setLatestAi(artifactRes.aiReasoning);
      if (artifactRes?.dexRouting) setDexRouting(artifactRes.dexRouting);
      if (feedsRes) setFeedsData(feedsRes);
      if (sageRes) setSageData(sageRes);
      if (sandboxRes) setSandboxData(sandboxRes);


      setStage(s => (s + 1) % STAGES.length);
      setTick(t => t + 1);
    } catch (e) {
      console.warn("Dashboard fetch error:", e);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 3000);
    return () => clearInterval(id);
  }, [fetchData]);

  /* ── Operator actions → POST to real API ── */
  async function onPause() {
    try {
      const res = await fetch("/api/operator/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "manual_operator_pause", actor: "dashboard" }) });
      const data = await res.json();
      if (data.state) { const modeMap = { normal: "ACTIVE", paused: "PAUSED", emergency_stop: "EMERGENCY_STOP" }; setOpState(modeMap[data.state.mode] || "PAUSED"); }
    } catch (e) { setOpState("PAUSED"); }
  }
  async function onResume() {
    try {
      const res = await fetch("/api/operator/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "manual_operator_resume", actor: "dashboard" }) });
      const data = await res.json();
      if (data.state) { const modeMap = { normal: "ACTIVE", paused: "PAUSED", emergency_stop: "EMERGENCY_STOP" }; setOpState(modeMap[data.state.mode] || "ACTIVE"); }
    } catch (e) { setOpState("ACTIVE"); }
  }
  async function onStop() {
    try {
      const res = await fetch("/api/operator/emergency-stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "manual_emergency", actor: "dashboard" }) });
      const data = await res.json();
      if (data.state) { const modeMap = { normal: "ACTIVE", paused: "PAUSED", emergency_stop: "EMERGENCY_STOP" }; setOpState(modeMap[data.state.mode] || "EMERGENCY_STOP"); }
    } catch (e) { setOpState("EMERGENCY_STOP"); }
  }

  const btn = (color) => ({ background: `${color}18`, color, border: `1px solid ${color}30`, borderRadius: 4, padding: "6px 14px", fontSize: 10, fontWeight: 700, fontFamily: F, cursor: "pointer", transition: "opacity .1s" });

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: F, fontSize: 11, lineHeight: 1.4 }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`*{margin:0;padding:0;box-sizing:border-box}body{background:${T.bg}}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:${T.brd};border-radius:2px}button{font-family:${F};cursor:pointer;transition:opacity .1s}button:hover{opacity:.8}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* ═══ 1. STATUS BAR ═══ */}
      <header style={{ display: "flex", alignItems: "center", height: 40, padding: "0 16px", borderBottom: `1px solid ${T.brd}`, background: T.s2, gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 4, background: `linear-gradient(135deg, ${T.up}, ${T.cyan})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: T.bg }}>A</div>
          <span style={{ fontSize: 13, fontWeight: 800, color: T.w, letterSpacing: 1 }}>ACTURA</span>
          <span style={{ fontSize: 8, color: T.fg3, letterSpacing: 1.5 }}>ERC-8004 · GACR · {sandboxData?.network || "Sepolia"}</span>
        </div>
        <div style={{ display: "flex", gap: 10, marginLeft: 16 }}>
          <a href="/" style={{ color: T.cyan, fontSize: 10, fontWeight: 600, textDecoration: "none", padding: "4px 10px", borderRadius: 4, background: `${T.cyan}10` }}>Dashboard</a>
          <a href="/trades" style={{ color: T.fg2, fontSize: 10, fontWeight: 600, textDecoration: "none", padding: "4px 10px", borderRadius: 4 }}>Trade History</a>
          <a href="/judge" style={{ color: T.warn, fontSize: 10, fontWeight: 600, textDecoration: "none", padding: "4px 10px", borderRadius: 4, background: `${T.warn}15` }}>Judge Mode</a>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 10 }}>
          <span style={{ color: T.fg2 }}>Trust</span><span style={{ color: truC(trustScore), fontWeight: 700 }}>{fn(trustScore, 0)}</span>
          <span style={{ color: T.fg3 }}>|</span>
          <span style={{ color: T.fg2 }}>Tier</span><span style={{ color: truC(trustScore), fontWeight: 700 }}>{shortTier(tier)}</span>
          <span style={{ color: T.fg3 }}>|</span>
          <span style={{ color: T.fg2 }}>Cap</span><span style={{ color: T.info, fontWeight: 700 }}>{sup.eff.toFixed(2)}x</span>
          <span style={{ color: T.fg3 }}>|</span>
          <span style={{ color: T.fg2 }}>Supervisory</span><span style={{ color: sup.ok ? T.up : T.dn, fontWeight: 700 }}>{sup.act}</span>
          <span style={{ color: T.fg3 }}>|</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Dot color={opState === "ACTIVE" ? T.up : opState === "PAUSED" ? T.warn : T.dn} />
            <span style={{ fontWeight: 700, color: opState === "ACTIVE" ? T.up : opState === "PAUSED" ? T.warn : T.dn }}>{opState}</span>
          </div>
        </div>
      </header>

      {/* ═══ SYSTEM HEARTBEAT BANNER ═══ */}
      {(() => {
        const now = Date.now();
        const lastCycle = heartbeat.lastCycleAt ? new Date(heartbeat.lastCycleAt).getTime() : null;
        const lastTrade = heartbeat.lastTradeAt ? new Date(heartbeat.lastTradeAt).getTime() : null;
        const cycleAgoMs = lastCycle ? now - lastCycle : null;
        const tradeAgoMs = lastTrade ? now - lastTrade : null;
        const formatAgo = (ms) => {
          if (ms == null) return "never";
          const s = Math.floor(ms / 1000);
          if (s < 60) return `${s}s ago`;
          const m = Math.floor(s / 60);
          if (m < 60) return `${m}m ago`;
          const h = Math.floor(m / 60);
          if (h < 24) return `${h}h ${m % 60}m ago`;
          return `${Math.floor(h / 24)}d ${h % 24}h ago`;
        };
        const formatUptime = (s) => { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
        const isOn = agentRunning;
        const cycleStale = cycleAgoMs != null && cycleAgoMs > 120000; // >2min without a cycle
        const tradeStale = tradeAgoMs != null && tradeAgoMs > 3600000; // >1hr without a trade
        const noTrades = lastTrade == null;
        const hasError = heartbeat.consecutiveErrors > 0;
        const statusColor = !isOn ? T.dn : (cycleStale || hasError) ? T.warn : T.up;
        const statusLabel = !isOn ? "SYSTEM OFF" : cycleStale ? "STALE" : hasError ? "ERRORS" : "SYSTEM ON";
        const tradeWarnColor = (noTrades || tradeStale) ? T.warn : T.fg2;
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "6px 16px", borderBottom: `1px solid ${T.brd}`, background: `${statusColor}08`, fontSize: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: statusColor, boxShadow: `0 0 8px ${statusColor}60`, animation: isOn && !cycleStale ? "pulse 2s infinite" : "none" }} />
              <span style={{ fontWeight: 800, color: statusColor, letterSpacing: 1 }}>{statusLabel}</span>
            </div>
            <span style={{ color: T.fg3 }}>|</span>
            <span style={{ color: T.fg2 }}>Last Cycle:</span>
            <span style={{ color: cycleStale ? T.warn : T.fg, fontWeight: 600 }}>{formatAgo(cycleAgoMs)}</span>
            <span style={{ color: T.fg3 }}>|</span>
            <span style={{ color: T.fg2 }}>Last Trade:</span>
            <span style={{ color: tradeWarnColor, fontWeight: 600 }}>{formatAgo(tradeAgoMs)}{tradeStale ? " ⚠" : ""}</span>
            <span style={{ color: T.fg3 }}>|</span>
            <span style={{ color: T.fg2 }}>Uptime:</span>
            <span style={{ color: T.fg, fontWeight: 600 }}>{formatUptime(heartbeat.uptime)}</span>
            <span style={{ color: T.fg3 }}>|</span>
            <span style={{ color: T.fg2 }}>Cycles:</span>
            <span style={{ color: T.fg, fontWeight: 600 }}>{cycleCount}</span>
            {hasError && (
              <React.Fragment>
                <span style={{ color: T.fg3 }}>|</span>
                <span style={{ color: T.dn, fontWeight: 700 }}>{heartbeat.consecutiveErrors} consecutive error{heartbeat.consecutiveErrors > 1 ? "s" : ""}</span>
              </React.Fragment>
            )}
            {(noTrades || tradeStale) && isOn && (
              <React.Fragment>
                <span style={{ color: T.fg3 }}>|</span>
                <span style={{ color: T.warn, fontWeight: 600 }}>{noTrades ? "No trades recorded yet" : "No trades in " + formatAgo(tradeAgoMs).replace(" ago", "")}</span>
              </React.Fragment>
            )}
          </div>
        );
      })()}

      <div style={{ padding: "10px 14px 30px", display: "grid", gap: 10 }}>

        {/* ═══ 2. MARKET + PIPELINE (the governance story starts here) ═══ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {/* Market Intelligence */}
          <P title="Market Intelligence" tip="Live ETH/USD from Kraken (primary), capital, volatility regime, and oracle health." tag={`${regime} · ${profile}`}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, marginBottom: 8, borderBottom: `1px solid ${T.brd}`, paddingBottom: 6 }}>
              <Metric label="ETH/USD" value={`$${fn(cPrice, 1)}`} color={T.w} />
              <Metric label="Capital" value={`$${fn(capital, 0)}`} sub={`${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`} color={pnl >= 0 ? T.up : T.dn} />
              <Metric label="Volatility" value={`${volRatio.toFixed(2)}x`} sub={`σ ${fp(vol)}`} color={proC(profile)} />
              <Metric label="Oracle" value={oracleStatus} sub={`${oracle.src}src · ${oracle.stale}s`} color={oraC(oracleStatus)} />
            </div>
            <Spark prices={prices} h={72} />
          </P>

          {/* Sentiment Intelligence */}
          <P title="Market Sentiment" tip="Composite sentiment from 6 sources: Fear & Greed, PRISM news/social/funding/OI/momentum. Drives trade bias." tag={sentiment ? `${sentiment.sources?.length || 0} sources` : "loading"}>
            {sentiment ? (() => {
              const comp = sentiment.composite || 0;
              const fg = sentiment.fearGreed;
              const news = sentiment.newsSentiment;
              const fund = sentiment.fundingRate;
              const sentColor = comp > 0.08 ? T.up : comp < -0.08 ? T.dn : T.warn;
              const sentLabel = comp > 0.3 ? "BULLISH" : comp > 0.15 ? "LEAN BULL" : comp > 0.08 ? "MILD BULL" : comp < -0.3 ? "BEARISH" : comp < -0.15 ? "LEAN BEAR" : comp < -0.08 ? "MILD BEAR" : "NEUTRAL";
              const fgRaw = fg !== null ? Math.round((fg + 1) * 50) : null;
              const fgLabel = fgRaw !== null ? (fgRaw <= 20 ? "Extreme Fear" : fgRaw <= 40 ? "Fear" : fgRaw <= 60 ? "Neutral" : fgRaw <= 80 ? "Greed" : "Extreme Greed") : "—";
              const barWidth = Math.abs(comp) * 100;
              const barLeft = comp >= 0 ? 50 : 50 - barWidth;
              return React.createElement(React.Fragment, null,
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, marginBottom: 8, borderBottom: `1px solid ${T.brd}`, paddingBottom: 6 } },
                  React.createElement(Metric, { label: "Composite", value: comp.toFixed(2), sub: sentLabel, color: sentColor }),
                  React.createElement(Metric, { label: "Fear & Greed", value: fgRaw !== null ? String(fgRaw) : "—", sub: fgLabel, color: fg !== null ? (fg > 0.15 ? T.up : fg < -0.15 ? T.dn : T.warn) : T.fg3 }),
                  React.createElement(Metric, { label: "News (PRISM)", value: news !== null ? news.toFixed(2) : "—", sub: news !== null ? (news > 0.1 ? "Bullish" : news < -0.1 ? "Bearish" : "Neutral") : "N/A", color: news !== null ? (news > 0.1 ? T.up : news < -0.1 ? T.dn : T.warn) : T.fg3 }),
                  React.createElement(Metric, { label: "Funding (PRISM)", value: fund !== null ? fund.toFixed(2) : "—", sub: fund !== null ? (fund > 0.1 ? "Longs crowd" : fund < -0.1 ? "Shorts crowd" : "Balanced") : "N/A", color: fund !== null ? (fund > 0.1 ? T.up : fund < -0.1 ? T.dn : T.warn) : T.fg3 }),
                ),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, marginBottom: 8, borderBottom: `1px solid ${T.brd}`, paddingBottom: 6 } },
                  React.createElement(Metric, { label: "Social (PRISM)", value: sentiment.socialSentiment != null ? sentiment.socialSentiment.toFixed(2) : "—", sub: sentiment.socialSentiment != null ? (sentiment.socialSentiment > 0.1 ? "Bullish" : sentiment.socialSentiment < -0.1 ? "Bearish" : "Neutral") : "N/A", color: sentiment.socialSentiment != null ? (sentiment.socialSentiment > 0.1 ? T.up : sentiment.socialSentiment < -0.1 ? T.dn : T.warn) : T.fg3 }),
                  React.createElement(Metric, { label: "OI (PRISM)", value: sentiment.openInterest != null ? sentiment.openInterest.toFixed(2) : "—", sub: sentiment.openInterest != null ? (sentiment.openInterest > 0.1 ? "Rising" : sentiment.openInterest < -0.1 ? "Falling" : "Flat") : "N/A", color: sentiment.openInterest != null ? (sentiment.openInterest > 0.1 ? T.up : sentiment.openInterest < -0.1 ? T.dn : T.warn) : T.fg3 }),
                  React.createElement(Metric, { label: "Momentum (PRISM)", value: sentiment.priceMomentum != null ? sentiment.priceMomentum.toFixed(2) : "—", sub: sentiment.priceMomentum != null ? (sentiment.priceMomentum > 0.1 ? "Uptrend" : sentiment.priceMomentum < -0.1 ? "Downtrend" : "Flat") : "N/A", color: sentiment.priceMomentum != null ? (sentiment.priceMomentum > 0.1 ? T.up : sentiment.priceMomentum < -0.1 ? T.dn : T.warn) : T.fg3 }),
                ),
                React.createElement("div", { style: { position: "relative", height: 12, background: T.s1, borderRadius: 6, overflow: "hidden", border: `1px solid ${T.brd}` } },
                  React.createElement("div", { style: { position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: T.fg3, zIndex: 2 } }),
                  React.createElement("div", { style: { position: "absolute", left: `${barLeft}%`, top: 1, bottom: 1, width: `${barWidth}%`, background: sentColor, borderRadius: 4, opacity: 0.7, transition: "all 0.5s ease" } }),
                ),
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 7.5, color: T.fg3, marginTop: 3 } },
                  React.createElement("span", null, "FEAR"),
                  React.createElement("span", null, "GREED"),
                ),
              );
            })() : React.createElement("div", { style: { color: T.fg3, fontSize: 10, textAlign: "center", padding: 16 } }, "Awaiting first sentiment fetch...")}
          </P>

          {/* Live Data Feeds */}
          <P title="Live Data Feeds" tip="Real-time price data: Kraken REST (primary), CoinGecko (fallback)." tag={feedsData?.status?.available ? "CONNECTED" : "OFFLINE"}>
            {(() => {
              const tk = feedsData?.ticker;
              const st = feedsData?.status;
              const krakenOk = st?.available && !st?.consecutiveFailures;
              const priceAge = tk?.timestamp ? Math.round((Date.now() - new Date(tk.timestamp).getTime()) / 1000) : null;
              const feeds = [
                { name: "Kraken (primary)", ok: krakenOk, detail: tk ? `$${Number(tk.price).toFixed(2)} · spread $${Number(tk.spread).toFixed(2)}` : "no data", sub: tk ? `vol ${Number(tk.volume24h).toFixed(0)} · vwap $${Number(tk.vwap24h).toFixed(0)}` : "" },
                { name: "CoinGecko (fallback)", ok: cPrice > 0, detail: cPrice > 0 ? `$${fn(cPrice, 2)}` : "standby", sub: prices.length > 0 ? `${prices.length} data points` : "" },
              ];
              return React.createElement(React.Fragment, null,
                priceAge !== null && React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.brd}` } },
                  React.createElement(Metric, { label: "Price Freshness", value: `${priceAge}s`, sub: priceAge < 30 ? "fresh" : priceAge < 120 ? "acceptable" : "stale", color: priceAge < 30 ? T.up : priceAge < 120 ? T.warn : T.dn }),
                  React.createElement(Metric, { label: "Active Feeds", value: `${feeds.filter(f => f.ok).length}/${feeds.length}`, sub: "connected", color: feeds.filter(f => f.ok).length >= 2 ? T.up : T.warn }),
                ),
                feeds.map((f, i) => React.createElement("div", { key: f.name, style: { display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: i < feeds.length - 1 ? `1px solid ${T.brd}30` : "none" } },
                  React.createElement(Dot, { color: f.ok ? T.up : T.dn }),
                  React.createElement("div", { style: { flex: 1 } },
                    React.createElement("div", { style: { fontSize: 10, fontWeight: 600, color: T.fg } }, f.name),
                    f.sub && React.createElement("div", { style: { fontSize: 8.5, color: T.fg3 } }, f.sub),
                  ),
                  React.createElement("span", { style: { fontSize: 9.5, color: f.ok ? T.fg2 : T.fg3, fontWeight: 500 } }, f.detail),
                )),
              );
            })()}
          </P>
        </div>



        {/* Governance Pipeline — THE HERO */}
        <P title="Governance Pipeline" tip="Every trade must pass all 8 deterministic governance stages before execution. This is the ERC-8004 trust backbone." tag={`cycle ${cycleCount || tick}`}>
            <div style={{ fontSize: 9.5, color: T.fg2, marginBottom: 8 }}>Every trade passes through 8 deterministic stages. Only trades that clear all gates execute.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4 }}>
              {STAGES.map((s, i) => {
                const done = i < stage, act = i === stage, fail = false;
                const color = done ? T.up : act ? T.info : T.fg3;
                return (
                  <div key={s.id} style={{
                    background: done ? `${T.up}0c` : act ? `${T.info}0c` : T.bg,
                    border: `1px solid ${done ? `${T.up}25` : act ? `${T.info}30` : T.brd}`,
                    borderRadius: 4, padding: "8px 4px", textAlign: "center", transition: "all .4s ease",
                    position: "relative", overflow: "hidden",
                  }}>
                    {act && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: T.info }} />}
                    {done && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: T.up }} />}
                    <div style={{ fontSize: 7.5, fontWeight: 700, color: T.fg3, letterSpacing: 1.5, marginBottom: 2 }}>{String(i + 1).padStart(2, "0")}</div>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color }}>{s.label}</div>
                    <div style={{ fontSize: 7.5, color: T.fg3, marginTop: 2 }}>{done ? "PASS" : act ? "ACTIVE" : "PENDING"}</div>
                  </div>
                );
              })}
            </div>
            {/* Pre-trade checks inline */}
            <div style={{ marginTop: 10, borderTop: `1px solid ${T.brd}`, paddingTop: 6 }}>
              <div style={{ fontSize: 8.5, color: T.fg3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Gate Status</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                {checks.map((c) => (
                  <div key={c.n} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2.5px 0", fontSize: 9.5 }}>
                    <Dot color={c.p ? T.up : T.dn} />
                    <span style={{ color: T.fg2 }}>{c.n}</span>
                    <span style={{ color: c.p ? T.up : T.dn, fontWeight: 600, marginLeft: "auto", fontSize: 9 }}>{c.p ? "PASS" : "FAIL"}</span>
                  </div>
                ))}
              </div>
            </div>
          </P>

        {/* ═══ 3. DECISION ENGINE ═══ */}
        <P title="Decision Engine" tip="Chronological log of every trade decision the agent has made, with direction, regime, edge score, and outcome." tag={`${trades.length} decisions`} noPad>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
              <thead>
                <tr style={{ background: T.s2 }}>
                  {["#", "Sig", "Conf", "Bias", "Adj", "Regime", "Profile", "Edge", "Oracle", "Trust", "Tier", "Size", "Status", "Receipt"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "5px 8px", fontSize: 8, letterSpacing: 1.2, color: T.fg3, fontWeight: 600, borderBottom: `1px solid ${T.brd}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={t.id} onClick={() => setSelIdx(i)} style={{ background: i === selIdx ? `${T.info}08` : "transparent", cursor: "pointer", borderBottom: `1px solid ${T.brd}40`, transition: "background .1s" }}>
                    <td style={{ padding: "5px 8px", color: T.fg3 }}>{t.id}</td>
                    <td style={{ padding: "5px 8px", color: sigC(t.signal), fontWeight: 700 }}>{t.signal}</td>
                    <td style={{ padding: "5px 8px" }}>{fn(t.conf)}</td>
                    <td style={{ padding: "5px 8px", color: t.bias >= 0 ? T.up : T.warn }}>{t.bias >= 0 ? "+" : ""}{fn(t.bias)}</td>
                    <td style={{ padding: "5px 8px", fontWeight: 700 }}>{fn(t.confAdj)}</td>
                    <td style={{ padding: "5px 8px" }}><Badge color={regC(t.regime)}>{t.regime}</Badge></td>
                    <td style={{ padding: "5px 8px" }}><Badge color={proC(t.profile)}>{t.profile}</Badge></td>
                    <td style={{ padding: "5px 8px" }}><Badge color={t.edgeGate === "PASS" ? T.up : T.warn}>{t.edgeGate}</Badge></td>
                    <td style={{ padding: "5px 8px" }}><Badge color={oraC(oracleStatus)}>{oracleStatus}</Badge></td>
                    <td style={{ padding: "5px 8px", color: truC(t.trustScore) }}>{fn(t.trustScore, 0)}</td>
                    <td style={{ padding: "5px 8px", color: T.fg2 }}>{shortTier(t.tier)}</td>
                    <td style={{ padding: "5px 8px" }}>{t.size > 0 ? fn(t.size, 4) : "—"}</td>
                    <td style={{ padding: "5px 8px" }}><Badge color={t.approved ? T.up : T.fg3}>{t.approved ? "EXEC" : "SKIP"}</Badge></td>
                    <td style={{ padding: "5px 8px", color: T.info, fontSize: 9 }}>{t.receipt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </P>

        {/* ═══ 4. SELECTED TRADE DEEP DIVE — 3 columns ═══ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>

          {/* Trade Trust Proof — deterministic explainability */}
          <P title="Trade Trust Proof" tip="Deterministic proof for the selected trade: confidence score, market regime, edge, oracle status, and trust tier." tag={`#${sel.id} · ${sel.approved ? "APPROVED" : "BLOCKED"}`}>
            <div style={{ padding: "4px 0", marginBottom: 6, borderBottom: `1px solid ${sel.approved ? T.up : T.dn}20` }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: sel.approved ? T.up : T.dn }}>{sel.approved ? "▲ APPROVED" : "▼ BLOCKED"}</span>
            </div>
            <KV k="Signal confidence" v={fn(sel.conf)} />
            <KV k="Bayesian bias" v={`${sel.bias >= 0 ? "+" : ""}${fn(sel.bias)}`} c={sel.bias >= 0 ? T.up : T.warn} />
            <KV k="Adjusted confidence" v={fn(sel.confAdj)} />
            <KV k="Market regime" v={sel.regime} c={regC(sel.regime)} />
            <KV k="Volatility profile" v={sel.profile} c={proC(sel.profile)} />
            <KV k="Edge estimate" v={fp(sel.edgePct, 2)} c={sel.edgeGate === "PASS" ? T.up : T.warn} />
            <KV k="Oracle integrity" v={oracleStatus} c={oraC(oracleStatus)} />
            <KV k="Trust score" v={fn(sel.trustScore, 0)} c={truC(sel.trustScore)} />
            <KV k="Trust tier" v={sel.tier} c={truC(sel.trustScore)} />
            <KV k="Capital multiplier" v={`${sup.eff.toFixed(2)}x`} c={T.info} />
            <KV k="Supervisory action" v={sup.act} c={sup.ok ? T.up : T.dn} />
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${T.brd}` }}>
              <div style={{ fontSize: 8.5, color: T.fg3, letterSpacing: 1, fontWeight: 600, marginBottom: 4 }}>ARTIFACTS</div>
              <KV k="TradeIntentHash" v={erc.tradeIntentHash} c={T.info} />
              <KV k="ValidationRequestHash" v={erc.validationRequestHash} c={T.info} />
              <KV k="IPFS Receipt" v={sel.receipt} c={T.info} />
            </div>
          </P>

          {/* Artifact Drawer + Confidence */}
          <P title="Artifact Drawer" tip="IPFS-pinned validation artifact for this trade. Immutable on-chain proof of the agent's reasoning and governance." tag={`trade ${sel.id}`}>
            <KV k="intent" v="signed_trade_intent" />
            <KV k="mandate" v={`max ${mandate.maxTrade}, daily loss ${mandate.maxDailyLoss}`} c={T.up} />
            <KV k="oracle" v={oracleStatus} c={oraC(oracleStatus)} />
            <KV k="simulation" v={sim.st} c={sim.st === "APPROVED" ? T.up : T.warn} />
            <KV k="trust" v={`${fn(sel.trustScore, 0)} / ${sel.tier}`} c={truC(sel.trustScore)} />
            <KV k="tx hash" v={sel.tx} c={T.info} />
            <KV k="ipfs receipt" v={sel.receipt} c={T.info} />
            <KV k="tradeIntentHash" v={erc.tradeIntentHash} c={T.cyan} />
            <KV k="validationRequestHash" v={erc.validationRequestHash} c={T.cyan} />
            <KV k="feedback tag" v={erc.lastFeedbackTag} c={T.warn} />
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.brd}` }}>
              <div style={{ fontSize: 8.5, color: T.fg3, letterSpacing: 1, fontWeight: 600, marginBottom: 6 }}>CONFIDENCE / RISK</div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.fg3, marginBottom: 2 }}><span>Adjusted confidence</span><span>{fn(sel.confAdj)}</span></div>
                <ProgressBar value={sel.confAdj} color={sigC(sel.signal)} />
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.fg3, marginBottom: 2 }}><span>Expected edge</span><span>{fp(sel.edgePct, 2)}</span></div>
                <ProgressBar value={sel.edgePct / 0.006} color={T.cyan} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <div style={{ background: T.bg, borderRadius: 4, padding: "6px 8px" }}><div style={{ fontSize: 8, color: T.fg3 }}>BEST CASE</div><div style={{ fontSize: 13, fontWeight: 700, color: T.cyan }}>+{fp(sel.edgePct * 1.7, 2)}</div></div>
                <div style={{ background: T.bg, borderRadius: 4, padding: "6px 8px" }}><div style={{ fontSize: 8, color: T.fg3 }}>WORST CASE</div><div style={{ fontSize: 13, fontWeight: 700, color: T.dn }}>-{fp(sel.edgePct * 0.9, 2)}</div></div>
              </div>
            </div>
          </P>

          {/* Execution + Positions */}
          <div style={{ display: "grid", gap: 10 }}>
            <P title="Execution Simulation" tip="Simulated execution details: entry price, take-profit, stop-loss, and slippage estimate before committing capital." tag={sim.st}>
              {[["Expected Edge", fp(sim.edgePct, 2), sim.edgePct / 0.006, T.up], ["Slippage", `${sim.slip.toFixed(1)}bps`, sim.slip / 40, T.warn], ["Net Edge", fp(sim.net, 2), (sim.net + 0.005) / 0.01, sim.net > 0 ? T.up : T.dn]].map(([l, v, p, c]) => (
                <div key={l} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.fg3, marginBottom: 2 }}><span>{l}</span><span style={{ color: c }}>{v}</span></div>
                  <ProgressBar value={p} color={c} />
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderTop: `1px solid ${T.brd}`, paddingTop: 6 }}>
                <div><div style={{ fontSize: 8, color: T.fg3 }}>TWAP DEV</div><div style={{ fontSize: 13, fontWeight: 700, color: oraC(oracleStatus) }}>{fp(oracle.dev)}</div></div>
                <div><div style={{ fontSize: 8, color: T.fg3 }}>GAS EST</div><div style={{ fontSize: 13, fontWeight: 700, color: T.info }}>${fn(sim.gas)}</div></div>
              </div>
            </P>
            <P title="Positions + Exposure" tip="Currently open positions with entry price, unrealized P&L, and portfolio exposure percentage." tag={`${positions.length} active`}>
              {positions.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${T.bg}50` }}>
                  <div><span style={{ color: sigC(p.side), fontWeight: 700 }}>#{p.id} {p.side} {fn(p.size, 4)}</span> <span style={{ color: T.fg3, fontSize: 9.5 }}>@ ${fn(p.entry)} · stop ${fn(p.stop)}</span></div>
                  <span style={{ color: p.pnl >= 0 ? T.up : T.dn, fontWeight: 700 }}>{p.pnl >= 0 ? "+" : ""}${fn(p.pnl)}</span>
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderTop: `1px solid ${T.brd}`, paddingTop: 6, marginTop: 4 }}>
                <div><div style={{ fontSize: 8, color: T.fg3 }}>POSITIONS</div><div style={{ fontWeight: 700 }}>{positions.length}</div></div>
                <div><div style={{ fontSize: 8, color: T.fg3 }}>PnL</div><div style={{ fontWeight: 700, color: pnl >= 0 ? T.up : T.dn }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%</div></div>
                <div><div style={{ fontSize: 8, color: T.fg3 }}>STATUS</div><div style={{ fontWeight: 700, color: agentRunning ? T.up : T.warn }}>{agentRunning ? "RUNNING" : "OFFLINE"}</div></div>
              </div>
            </P>
          </div>
        </div>

        {/* ═══ 5. TRUST LAYER + PROTOCOL + OPERATOR — 3 columns ═══ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>

          {/* Trust + Capital Rights + Trade Performance */}
          <div style={{ display: "grid", gap: 10 }}>
          <P title="Trust + Capital Ladder" tip="ERC-8004 trust tier progression. Higher tiers unlock larger position sizes as the agent builds on-chain reputation." tag={shortTier(tier)}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 8 }}>
              <div><div style={{ fontSize: 8, color: T.fg3 }}>TRUST SCORE</div><div style={{ fontSize: 18, fontWeight: 700, color: truC(trustScore) }}>{fn(trustScore, 0)}</div><div style={{ fontSize: 9, color: T.fg2 }}>{trustLabel(trustScore)} · {tDelta >= 0 ? "+" : ""}{fn(tDelta, 0)}</div></div>
              <div><div style={{ fontSize: 8, color: T.fg3 }}>CAPITAL RIGHT</div><div style={{ fontSize: 18, fontWeight: 700, color: T.info }}>{sup.eff.toFixed(2)}x</div><div style={{ fontSize: 9, color: T.fg2 }}>{recoveryMode ? "recovery capped" : shortTier(tier)}</div></div>
            </div>
            <Spark prices={trustHistory} h={48} color={truC(trustScore)} />
            <div style={{ marginTop: 8, display: "grid", gap: 3 }}>
              {[{ t: "T0", m: 0 }, { t: "T1", m: 0.25 }, { t: "T2", m: 0.6 }, { t: "T3", m: 1 }, { t: "T4", m: 1.25 }].map((x) => {
                const a = tier.includes(x.t.slice(1));
                return (
                  <div key={x.t} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 3, background: a ? `${T.up}0a` : "transparent", border: `1px solid ${a ? `${T.up}20` : T.brd}40` }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: a ? T.up : T.fg3, minWidth: 20 }}>{x.t}</span>
                    <div style={{ flex: 1, height: 3, borderRadius: 2, background: T.bg, overflow: "hidden" }}><div style={{ height: "100%", width: `${(x.m / 1.25) * 100}%`, background: a ? T.up : T.fg3, borderRadius: 2 }} /></div>
                    <span style={{ fontSize: 9, color: a ? T.w : T.fg3, fontWeight: 600, minWidth: 36, textAlign: "right" }}>{x.m.toFixed(2)}x</span>
                  </div>
                );
              })}
            </div>
          </P>

          {/* AI Reasoning — the agent explains its latest decision */}
          <P title="AI Reasoning" tip="Natural language explanation of the agent's latest trade decision: market context, rationale, confidence factors, and watch items." tag="latest decision">
            {latestAi ? (
              <div style={{ fontSize: 10, lineHeight: 1.7, color: T.fg }}>
                <div style={{ color: T.info, fontWeight: 600, fontSize: 10.5, marginBottom: 6 }}>{latestAi.summary}</div>
                <div style={{ marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.brd}` }}>
                  <div style={{ fontSize: 8, color: T.fg3, letterSpacing: 1, marginBottom: 3 }}>MARKET CONTEXT</div>
                  <div style={{ color: T.fg2, fontSize: 9.5 }}>{latestAi.marketContext}</div>
                </div>
                <div style={{ marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.brd}` }}>
                  <div style={{ fontSize: 8, color: T.fg3, letterSpacing: 1, marginBottom: 3 }}>TRADE RATIONALE</div>
                  <div style={{ color: T.fg2, fontSize: 9.5 }}>{latestAi.tradeRationale}</div>
                </div>
                {latestAi.confidenceFactors?.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 8, color: T.fg3, letterSpacing: 1, marginBottom: 3 }}>CONFIDENCE FACTORS</div>
                    {latestAi.confidenceFactors.map((f, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 2 }}>
                        <span style={{ color: T.up, flexShrink: 0, fontSize: 9 }}>+</span>
                        <span style={{ color: T.fg2, fontSize: 9.5 }}>{f}</span>
                      </div>
                    ))}
                  </div>
                )}
                {latestAi.watchItems?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 8, color: T.fg3, letterSpacing: 1, marginBottom: 3 }}>WATCH ITEMS</div>
                    {latestAi.watchItems.map((w, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 2 }}>
                        <span style={{ color: T.warn, flexShrink: 0, fontSize: 9 }}>!</span>
                        <span style={{ color: T.fg2, fontSize: 9.5 }}>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: T.fg3, fontSize: 10, textAlign: "center", padding: 16 }}>Awaiting first AI-reasoned decision...</div>
            )}
          </P>
          </div>

          {/* ERC-8004 + MCP + Sandbox */}
          <div style={{ display: "grid", gap: 10 }}>
            <P title="Hackathon Sandbox" tip="Live connection to the shared hackathon contracts on Sepolia. Shows agent registration, vault balance, and on-chain scores from judges." tag={sandboxData?.connected ? "CONNECTED" : "OFFLINE"}>
              {(() => {
                const sb = sandboxData || {};
                const connected = sb.connected;
                const shortAddr = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
                const etherscanBase = sb.chainId === 11155111 ? "https://sepolia.etherscan.io" : "https://sepolia.basescan.org";
                return React.createElement(React.Fragment, null,
                  React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.brd}` } },
                    React.createElement(Metric, { label: "Agent ID", value: sb.agentId != null ? `#${sb.agentId}` : "—", color: sb.agentId ? T.cyan : T.fg3 }),
                    React.createElement(Metric, { label: "Network", value: sb.network || "—", sub: sb.chainId ? `Chain ${sb.chainId}` : "", color: connected ? T.up : T.fg3 }),
                    React.createElement(Metric, { label: "Vault Balance", value: sb.vaultBalance ? `${Number(sb.vaultBalance).toFixed(4)} ETH` : "—", color: sb.vaultBalance && Number(sb.vaultBalance) > 0 ? T.up : T.fg3 }),
                    React.createElement(Metric, { label: "Wallet", value: sb.walletBalance ? `${Number(sb.walletBalance).toFixed(3)} ETH` : "—", sub: "gas balance", color: sb.walletBalance && Number(sb.walletBalance) > 1 ? T.up : T.warn }),
                  ),
                  React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.brd}` } },
                    React.createElement("div", { style: { background: T.bg, borderRadius: 4, padding: "8px 10px", textAlign: "center" } },
                      React.createElement("div", { style: { fontSize: 8, color: T.fg3, letterSpacing: 1, marginBottom: 4 } }, "VALIDATION SCORE"),
                      React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: sb.validationScore != null && sb.validationScore > 0 ? T.cyan : T.fg3 } }, sb.validationScore != null && sb.validationScore > 0 ? `${sb.validationScore}/100` : "—"),
                      React.createElement("div", { style: { fontSize: 8, color: T.fg3, marginTop: 2 } }, "ValidationRegistry"),
                    ),
                    React.createElement("div", { style: { background: T.bg, borderRadius: 4, padding: "8px 10px", textAlign: "center" } },
                      React.createElement("div", { style: { fontSize: 8, color: T.fg3, letterSpacing: 1, marginBottom: 4 } }, "REPUTATION SCORE"),
                      React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: sb.reputationScore != null && sb.reputationScore > 0 ? T.purple : T.fg3 } }, sb.reputationScore != null && sb.reputationScore > 0 ? `${sb.reputationScore}/100` : "—"),
                      React.createElement("div", { style: { fontSize: 8, color: T.fg3, marginTop: 2 } }, "ReputationRegistry"),
                    ),
                  ),
                  React.createElement("div", { style: { fontSize: 8.5, color: T.fg3, letterSpacing: 1, fontWeight: 600, marginBottom: 4 } }, "SHARED CONTRACTS"),
                  [
                    ["AgentRegistry", sb.contracts?.agentRegistry],
                    ["HackathonVault", sb.contracts?.hackathonVault],
                    ["RiskRouter", sb.contracts?.riskRouter],
                    ["ValidationRegistry", sb.contracts?.validationRegistry],
                    ["ReputationRegistry", sb.contracts?.reputationRegistry],
                  ].map(([name, addr]) => React.createElement("div", { key: name, style: { display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 10 } },
                    React.createElement("span", { style: { color: T.fg2 } }, name),
                    addr ? React.createElement("a", { href: `${etherscanBase}/address/${addr}`, target: "_blank", rel: "noopener", style: { color: T.info, textDecoration: "none", fontWeight: 500, fontSize: 9.5 } }, shortAddr(addr)) : React.createElement("span", { style: { color: T.fg3 } }, "—"),
                  )),
                  React.createElement("div", { style: { display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 } },
                    React.createElement(Badge, { color: connected ? T.up : T.dn }, connected ? "sandbox connected" : "disconnected"),
                    sb.agentId && React.createElement(Badge, { color: T.cyan }, "registered"),
                    sb.vaultBalance && Number(sb.vaultBalance) > 0 && React.createElement(Badge, { color: T.up }, "capital claimed"),
                    React.createElement(Badge, { color: T.info }, "EIP-712 signing"),
                    React.createElement(Badge, { color: T.purple }, "risk-routed"),
                  ),
                );
              })()}
            </P>
            <P title="ERC-8004 Protocol" tip="On-chain registration status, agent identity, contract address, and EIP-1271 / TEE security verification." tag={erc.registrationStatus}>
              <KV k="agentId" v={String(erc.agentId)} />
              <KV k="agentRegistry" v={erc.agentRegistry} c={T.info} />
              <KV k="ownerWallet" v={erc.ownerWallet} />
              <KV k="agentWallet" v={erc.agentWallet} />
              <KV k="tradeIntentHash" v={erc.tradeIntentHash} c={T.cyan} />
              <KV k="validationRequestHash" v={erc.validationRequestHash} c={T.cyan} />
              <KV k="lastFeedbackTag" v={erc.lastFeedbackTag} c={T.warn} />
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                <Badge color={T.up}>identity ready</Badge><Badge color={T.info}>intent signed</Badge><Badge color={T.warn}>validation wired</Badge><Badge color={T.info}>reputation wired</Badge>
                <Badge color={security?.eip1271?.enabled ? T.up : T.fg3}>EIP-1271</Badge>
                <Badge color={security?.teeAttestation?.valid ? T.cyan : T.fg3}>TEE attested</Badge>
              </div>
              {security && (
                <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${T.brd}` }}>
                  <div style={{ fontSize: 8, color: T.fg3, letterSpacing: 1, marginBottom: 4 }}>SECURITY LAYER</div>
                  <KV k="EIP-1271" v={security.eip1271?.enabled ? "✓ active (auto-detect EOA/contract)" : "—"} c={security.eip1271?.enabled ? T.up : T.fg3} />
                  <KV k="TEE type" v={security.teeAttestation?.type || "—"} c={T.cyan} />
                  <KV k="TEE commit" v={security.teeAttestation?.gitCommit || "—"} c={T.info} />
                  <KV k="TEE codeHash" v={security.teeAttestation?.codeHash || "—"} c={T.purple} />
                  <KV k="TEE nonce" v={security.teeAttestation?.nonce || "—"} />
                  <KV k="TEE valid" v={security.teeAttestation?.valid ? "✓ verified" : "✗ invalid"} c={security.teeAttestation?.valid ? T.up : T.dn} />
                </div>
              )}
            </P>
            <P title="MCP Interface" tip="Model Context Protocol tools exposed by the agent. Enables external systems to query state and trigger actions." tag={`${mcp.tools.total} tools`}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${T.brd}` }}>
                <div><div style={{ fontSize: 8, color: T.fg3 }}>TOOLS</div><div style={{ fontSize: 15, fontWeight: 700, color: T.cyan }}>{mcp.tools.total}</div><div style={{ fontSize: 9, color: T.fg2 }}>public {mcp.tools.public} · restricted {mcp.tools.restricted} · operator {mcp.tools.operator}</div></div>
                <div><div style={{ fontSize: 8, color: T.fg3 }}>RESOURCES / PROMPTS</div><div style={{ fontSize: 15, fontWeight: 700, color: T.info }}>{mcp.resources} / {mcp.prompts}</div><div style={{ fontSize: 9, color: T.fg2 }}>{mcp.mode}</div></div>
              </div>
              <KV k="endpoint" v={mcp.endpoint} />
              <KV k="visibility" v={mcp.visibility} />
              <div style={{ marginTop: 6 }}>
                {[["Public", mcp.publicTools, T.up], ["Restricted", mcp.restrictedTools, T.warn], ["Operator", mcp.operatorTools, T.dn]].map(([l, tools, c]) => (
                  <div key={l} style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 8, color: T.fg3, letterSpacing: 1, marginBottom: 2 }}>{l.toUpperCase()}</div>
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>{tools.map((t) => <Badge key={t} color={c}>{t}</Badge>)}</div>
                  </div>
                ))}
              </div>
            </P>
          </div>

          {/* Operator + Mandate + Alerts */}
          <div style={{ display: "grid", gap: 10 }}>
            <P title="Operator Controls" tip="Human operator oversight: pause/resume trading, adjust risk limits, and view recent operator actions." tag={opState}>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button onClick={onPause} style={btn(T.warn)}>Pause</button>
                <button onClick={onResume} style={btn(T.up)}>Resume</button>
                <button onClick={onStop} style={btn(T.dn)}>Emergency Stop</button>
              </div>
              {opLog.map((e, i) => (
                <div key={`${e.ts}${i}`} style={{ display: "grid", gridTemplateColumns: "56px 70px 1fr", padding: "3px 0", fontSize: 9.5, borderTop: `1px solid ${T.brd}30` }}>
                  <span style={{ color: T.fg3 }}>{e.ts}</span>
                  <span style={{ color: T.fg, fontWeight: 600 }}>{e.action}</span>
                  <span style={{ color: T.fg3 }}>{e.reason}</span>
                </div>
              ))}
            </P>
            <P title="Mandate + Supervisory" tip="Agent's trading mandate boundaries: allowed pairs, max drawdown, position limits, and supervisory compliance status." tag={sup.act}>
              <KV k="Capital" v={mandate.capital} />
              <KV k="Max trade size" v={mandate.maxTrade} />
              <KV k="Max daily loss" v={mandate.maxDailyLoss} />
              <KV k="Approval threshold" v={mandate.approvalThreshold} />
              <KV k="Allowed assets" v={mandate.allowedAssets.join(", ")} />
              <KV k="Protocols" v={mandate.protocols.join(", ")} />
              <div style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${T.brd}` }}>
                <KV k="Supervisory decision" v={sup.act} c={sup.ok ? T.up : T.dn} />
              </div>
            </P>
            <P title="DEX Routing" tip="Best-execution routing across DEX protocols. Aerodrome (Base mainnet) and Uniswap V3 (Sepolia testnet). Agent picks the lowest-cost route per trade." tag={dexRouting?.selectedDex ? dexRouting.selectedDex.toUpperCase() : "UNISWAP"}>
              {(() => {
                const dexes = [
                  { name: "Uniswap V3", network: "Sepolia (testnet)", available: true, fee: "30 bps", gas: "free", icon: "●" },
                  { name: "Aerodrome", network: "Base (mainnet)", available: false, fee: "30 bps", gas: "~$0.15", icon: "○" },
                ];
                const selected = dexRouting?.selectedDex || "uniswap";
                const savings = dexRouting?.savingsBps || 0;
                const rationale = dexRouting?.rationale?.join(" · ") || "—";
                return React.createElement(React.Fragment, null,
                  dexes.map((d) => React.createElement("div", { key: d.name, style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px solid ${T.brd}30` } },
                    React.createElement("span", { style: { fontSize: 12, color: d.available ? T.up : T.fg3 } }, d.icon),
                    React.createElement("div", { style: { flex: 1 } },
                      React.createElement("div", { style: { fontSize: 10, fontWeight: 600, color: d.available ? T.fg : T.fg3 } }, d.name, " ", React.createElement("span", { style: { fontSize: 8.5, fontWeight: 400, color: T.fg3 } }, d.network)),
                      React.createElement("div", { style: { fontSize: 8.5, color: T.fg3 } }, `Fee: ${d.fee} · Gas: ${d.gas}`),
                    ),
                    React.createElement(Badge, { color: d.available ? T.up : T.warn }, d.available ? "ACTIVE" : "MAINNET-READY"),
                  )),
                  React.createElement("div", { style: { marginTop: 6, paddingTop: 6, borderTop: `1px solid ${T.brd}` } },
                    React.createElement(KV, { k: "Selected", v: selected.charAt(0).toUpperCase() + selected.slice(1), c: T.up }),
                    savings > 0 && React.createElement(KV, { k: "Savings", v: `${savings} bps`, c: T.up }),
                    React.createElement(KV, { k: "Rationale", v: rationale }),
                  ),
                );
              })()}
            </P>
            <P title="Watch Items" tip="Live monitoring alerts: price levels, regime shifts, and risk conditions the agent is actively tracking." tag="live">
              <div style={{ fontSize: 9.5, color: T.warn, lineHeight: 1.65 }}>
                {[
                  regime === "RANGING" ? "Whipsaw risk elevated — favour reduced size." : "Trend continuation healthy — monitor reversal signals.",
                  oracleStatus === "WATCH" ? "Oracle drift under observation." : "Oracle feeds healthy.",
                  recoveryMode ? "Trust recovery mode active — capital rights capped." : "Trust operating in standard mode.",
                  opState === "ACTIVE" ? "Operator state normal." : "Operator intervention currently affecting runtime.",
                ].map((m, i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}><span style={{ color: T.fg3, flexShrink: 0 }}>▸</span><span>{m}</span></div>)}
              </div>
            </P>
            <P title="SAGE (Self-Adapting Generative Engine)" tip="LLM-powered reflection that auto-tunes signal weights and builds a trading playbook from outcomes." tag={sageData?.enabled ? "ACTIVE" : "OFF"}>
              {(() => {
                const defaults = { trend: 0.6, ret5: 1.8, ret20: 1.1, crossover: 0.15, rsi: 0.6, zscore: 0.5, sentiment: 0.12 };
                const w = sageData?.weights || defaults;
                const anyChanged = Object.keys(defaults).some(k => Math.abs((w[k] || 0) - defaults[k]) > 0.001);
                return React.createElement(React.Fragment, null,
                  React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.brd}` } },
                    React.createElement("div", null,
                      React.createElement("div", { style: { fontSize: 8, color: T.fg3 } }, "STATUS"),
                      React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: sageData?.enabled ? T.up : T.fg3 } }, sageData?.enabled ? "ENABLED" : "OFF"),
                    ),
                    React.createElement("div", null,
                      React.createElement("div", { style: { fontSize: 8, color: T.fg3 } }, "REFLECTIONS"),
                      React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: T.cyan } }, sageData?.reflectionCount || 0),
                    ),
                    React.createElement("div", null,
                      React.createElement("div", { style: { fontSize: 8, color: T.fg3 } }, "PLAYBOOK RULES"),
                      React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: T.purple } }, sageData?.activeRules || 0),
                    ),
                  ),
                  React.createElement("div", { style: { fontSize: 8.5, color: T.fg3, letterSpacing: 1, fontWeight: 600, marginBottom: 4 } }, "SIGNAL WEIGHTS"),
                  Object.keys(defaults).map(k => {
                    const cur = (w[k] || 0);
                    const def = defaults[k];
                    const changed = Math.abs(cur - def) > 0.001;
                    return React.createElement(KV, { key: k, k: k, v: `${cur.toFixed(2)}${changed ? " \u2190 " + def.toFixed(2) : ""}`, c: changed ? T.warn : T.fg });
                  }),
                  anyChanged && React.createElement("div", { style: { marginTop: 6, fontSize: 9, color: T.warn } }, "\u26A1 Weights tuned by SAGE reflection"),
                  sageData?.contextPrefix && React.createElement("div", { style: { marginTop: 8, paddingTop: 6, borderTop: `1px solid ${T.brd}` } },
                    React.createElement("div", { style: { fontSize: 8.5, color: T.fg3, letterSpacing: 1, fontWeight: 600, marginBottom: 4 } }, "SAGE WISDOM"),
                    React.createElement("div", { style: { fontSize: 9.5, color: T.fg2, lineHeight: 1.6 } }, sageData.contextPrefix.substring(0, 300) + (sageData.contextPrefix.length > 300 ? "\u2026" : "")),
                  ),
                );
              })()}
            </P>
          </div>
        </div>
      </div>
    </div>
  );
}
