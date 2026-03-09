import { useState, useEffect, useMemo } from "react";

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
function P({ title, tag, children, style: sx, noPad }) {
  return (
    <div style={{ background: T.s1, border: `1px solid ${T.brd}`, borderRadius: 6, overflow: "hidden", display: "flex", flexDirection: "column", ...sx }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", borderBottom: `1px solid ${T.brd}`, background: T.s2, flexShrink: 0 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: T.fg, letterSpacing: 0.3 }}>{title}</span>
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

/* ═══ MAIN ═══ */
export default function Actura() {
  const [prices, setPrices] = useState(() => genPrices(72));
  const [stage, setStage] = useState(0);
  const [tick, setTick] = useState(0);
  const [vol, setVol] = useState(0.0162);
  const [volRatio, setVolRatio] = useState(0.81);
  const [adx, setAdx] = useState(27.8);
  const [chop, setChop] = useState(41.2);
  const [bayesBias, setBayesBias] = useState(0.06);
  const [edgePct, setEdgePct] = useState(0.0029);
  const [costBps, setCostBps] = useState(18);
  const [trustScore, setTrustScore] = useState(91);
  const [trustHistory, setTrustHistory] = useState([74, 76, 79, 83, 85, 88, 90, 91]);
  const [opState, setOpState] = useState("ACTIVE");
  const [oracleStatus, setOracleStatus] = useState("HEALTHY");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [selIdx, setSelIdx] = useState(0);
  const [opLog, setOpLog] = useState([
    { ts: "12:44:09", action: "resume", reason: "manual_release" },
    { ts: "12:37:52", action: "pause", reason: "volatility_spike_review" },
    { ts: "12:32:11", action: "resume", reason: "operator_clearance" },
  ]);

  const regime = useMemo(() => { if (volRatio > 1.9) return "STRESSED"; if (adx > 22 && chop < 45) return "TRENDING"; if (chop > 52) return "RANGING"; return "UNCERTAIN"; }, [volRatio, adx, chop]);
  const profile = useMemo(() => { if (volRatio > 2.1) return "EXTREME_DEFENSIVE"; if (volRatio > 1.25) return "HIGH_VOL"; if (volRatio < 0.8) return "LOW_VOL"; return "NORMAL"; }, [volRatio]);
  const edgeGate = useMemo(() => edgePct >= (costBps / 10000) * 1.5 ? "PASS" : "FAIL", [edgePct, costBps]);
  const tier = useMemo(() => getTier(trustScore), [trustScore]);
  const capMult = useMemo(() => getMult(tier), [tier]);
  const adjConf = useMemo(() => clamp(0.87 + bayesBias, 0, 1), [bayesBias]);
  const tDelta = useMemo(() => trustHistory.length > 1 ? trustHistory[trustHistory.length - 1] - trustHistory[trustHistory.length - 2] : 0, [trustHistory]);

  const mandate = { capital: "$100,000", maxTrade: "5%", maxDailyLoss: "8%", allowedAssets: ["ETH", "BTC", "USDC"], protocols: ["Uniswap", "Aave"], approvalThreshold: "$20,000" };
  const erc = { agentId: 22, agentRegistry: "eip155:84532:0x7420...ab19", ownerWallet: "0xA91c...4D2e", agentWallet: "0xB27f...91Aa", tradeIntentHash: "0x7fd2...bb13", validationRequestHash: "0x41ac...ff09", lastFeedbackTag: "tradingYield:day", registrationStatus: "READY" };
  const mcp = { status: "ACTIVE", endpoint: "/mcp", mode: "governed", visibility: "public + restricted + operator", tools: { public: 7, restricted: 2, operator: 3, total: 12 }, resources: 8, prompts: 4, publicTools: ["get_market_state", "explain_trade", "get_trust_state", "get_capital_rights"], restrictedTools: ["propose_trade", "execute_trade"], operatorTools: ["pause_agent", "resume_agent", "emergency_stop"] };

  const sim = useMemo(() => {
    const slip = clamp(8 + volRatio * 6 + (regime === "STRESSED" ? 8 : 0), 6, 34);
    const gas = clamp(3.8 + volRatio * 1.7, 2.2, 11.5);
    const net = edgePct - slip / 10000 - gas / 100000;
    const st = net > 0.001 ? "APPROVED" : net > 0 ? "WATCH" : "BLOCKED";
    return { slip, gas, net, st };
  }, [edgePct, volRatio, regime]);

  const oracle = useMemo(() => {
    const dev = clamp((volRatio - 0.8) * 0.014, 0.001, 0.041);
    const stale = oracleStatus === "HEALTHY" ? 7 : oracleStatus === "WATCH" ? 31 : 73;
    const src = oracleStatus === "HEALTHY" ? 3 : 2;
    return { dev, stale, src };
  }, [oracleStatus, volRatio]);

  const cap = 10247.8, pnl = ((cap - 10000) / 10000) * 100, cPrice = prices[prices.length - 1];

  const sup = useMemo(() => {
    const ok = opState === "ACTIVE" && oracleStatus !== "BLOCKED" && edgeGate === "PASS" && sim.st !== "BLOCKED" && trustScore >= 60;
    const eff = recoveryMode ? Math.min(capMult, 0.6) : capMult;
    const act = ok ? (recoveryMode ? "THROTTLE" : "ALLOW") : "BLOCK";
    return { ok, eff, act };
  }, [opState, oracleStatus, edgeGate, sim.st, trustScore, recoveryMode, capMult]);

  const positions = useMemo(() => [
    { id: 23, side: "LONG", size: 0.0612 * sup.eff, entry: cPrice - 44, stop: cPrice - 132, pnl: 4.92, profile },
    { id: 22, side: "LONG", size: 0.0488, entry: cPrice - 70, stop: cPrice - 154, pnl: 7.11, profile: "LOW_VOL" },
    { id: 21, side: "SHORT", size: 0.0394, entry: cPrice + 16, stop: cPrice + 96, pnl: -1.62, profile: "HIGH_VOL" },
  ], [cPrice, sup.eff, profile]);

  const trades = useMemo(() => [
    { id: 47 + tick, signal: "LONG", conf: 0.87, bias: bayesBias, confAdj: adjConf, regime, profile, edgePct, costBps, edgeGate, price: cPrice, size: sup.ok ? 0.0612 * sup.eff : 0, approved: sup.ok, trustScore, tier, receipt: "QmActuraReceipt...9af2", tx: "0x8f1c...0a71" },
    { id: 46 + tick, signal: "SHORT", conf: 0.64, bias: -0.04, confAdj: 0.60, regime: "RANGING", profile: "LOW_VOL", edgePct: 0.0013, costBps: 18, edgeGate: "FAIL", price: cPrice - 18, size: 0, approved: false, trustScore: 78, tier: "TIER_2_LIMITED", receipt: "QmActuraReceipt...7bc4", tx: "—" },
    { id: 45 + tick, signal: "LONG", conf: 0.58, bias: 0.02, confAdj: 0.60, regime: "UNCERTAIN", profile: "NORMAL", edgePct: 0.0019, costBps: 17, edgeGate: "WATCH", price: cPrice - 9, size: 0, approved: false, trustScore: 84, tier: "TIER_2_LIMITED", receipt: "QmActuraReceipt...11c0", tx: "—" },
  ], [tick, bayesBias, adjConf, regime, profile, edgePct, costBps, edgeGate, cPrice, sup, trustScore, tier]);

  const checks = useMemo(() => [
    { n: "circuit_breaker", p: true, v: "ARMED" },
    { n: "mandate_engine", p: true, v: `${mandate.maxTrade} / ${mandate.maxDailyLoss}` },
    { n: "structure_regime", p: true, v: `${regime} (ADX ${adx.toFixed(1)}, CHOP ${chop.toFixed(1)})` },
    { n: "oracle_integrity", p: oracleStatus !== "BLOCKED", v: `${oracleStatus} (${fp(oracle.dev, 2)} dev)` },
    { n: "execution_simulation", p: sim.st !== "BLOCKED", v: `${sim.st} (${sim.slip.toFixed(1)}bps)` },
    { n: "trust_recovery", p: true, v: recoveryMode ? "ACTIVE" : "OFF" },
    { n: "supervisory", p: sup.ok, v: `${sup.act} @ ${sup.eff.toFixed(2)}x` },
    { n: "operator_state", p: opState === "ACTIVE", v: opState },
  ], [mandate, regime, adx, chop, oracleStatus, oracle, sim, recoveryMode, sup, opState]);

  const sel = trades[selIdx] || trades[0];

  function addLog(a, r) { const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); setOpLog((p) => [{ ts: t, action: a, reason: r }, ...p].slice(0, 6)); }
  function onPause() { setOpState("PAUSED"); addLog("pause", "manual_operator_pause"); }
  function onResume() { setOpState("ACTIVE"); setOracleStatus("HEALTHY"); addLog("resume", "manual_operator_resume"); }
  function onStop() { setOpState("EMERGENCY_STOP"); setOracleStatus("BLOCKED"); addLog("emergency_stop", "manual_emergency"); }

  useEffect(() => {
    const id = setInterval(() => {
      setStage((s) => (s + 1) % STAGES.length);
      setTick((t) => t + 1);
      setPrices((p) => { const l = p[p.length - 1]; return [...p.slice(-71), l * (1 + (Math.random() - 0.48) * 0.012)]; });
      setVol((v) => clamp(v + (Math.random() - 0.5) * 0.002, 0.008, 0.045));
      setVolRatio((v) => clamp(v + (Math.random() - 0.5) * 0.15, 0.55, 2.6));
      setAdx((v) => clamp(v + (Math.random() - 0.5) * 2.8, 8, 45));
      setChop((v) => clamp(v + (Math.random() - 0.5) * 3.4, 25, 65));
      setBayesBias((v) => clamp(v + (Math.random() - 0.5) * 0.04, -0.35, 0.35));
      setEdgePct((v) => clamp(v + (Math.random() - 0.5) * 0.0005, 0.0004, 0.0055));
      setCostBps((v) => clamp(v + (Math.random() - 0.5) * 2, 10, 40));
      setTrustScore((s) => { const n = clamp(s + (Math.random() - 0.44) * 3.2 + (opState === "ACTIVE" ? 0.4 : -0.8), 54, 98); setTrustHistory((p) => [...p.slice(-27), n]); return n; });
      setRecoveryMode((p) => { const l = trustHistory[trustHistory.length - 1] ?? trustScore; return l < 78 || (p && l < 85); });
      setOracleStatus(() => { if (opState === "EMERGENCY_STOP") return "BLOCKED"; if (volRatio > 2.0) return "WATCH"; return Math.random() > 0.94 ? "WATCH" : "HEALTHY"; });
    }, 2500);
    return () => clearInterval(id);
  }, [opState, volRatio, trustHistory, trustScore]);

  const btn = (color) => ({ background: `${color}18`, color, border: `1px solid ${color}30`, borderRadius: 4, padding: "6px 14px", fontSize: 10, fontWeight: 700, fontFamily: F, cursor: "pointer", transition: "opacity .1s" });

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: F, fontSize: 11, lineHeight: 1.4 }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`*{margin:0;padding:0;box-sizing:border-box}body{background:${T.bg}}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:${T.brd};border-radius:2px}button{font-family:${F};cursor:pointer;transition:opacity .1s}button:hover{opacity:.8}`}</style>

      {/* ═══ 1. STATUS BAR ═══ */}
      <header style={{ display: "flex", alignItems: "center", height: 40, padding: "0 16px", borderBottom: `1px solid ${T.brd}`, background: T.s2, gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 4, background: `linear-gradient(135deg, ${T.up}, ${T.cyan})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: T.bg }}>A</div>
          <span style={{ fontSize: 13, fontWeight: 800, color: T.w, letterSpacing: 1 }}>ACTURA</span>
          <span style={{ fontSize: 8, color: T.fg3, letterSpacing: 1.5 }}>ERC-8004 · GACR · Base Sepolia</span>
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

      <div style={{ padding: "10px 14px 30px", display: "grid", gap: 10 }}>

        {/* ═══ 2. MARKET + PIPELINE (the governance story starts here) ═══ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {/* Market Intelligence */}
          <P title="Market Intelligence" tag={`${regime} · ${profile}`}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, marginBottom: 8, borderBottom: `1px solid ${T.brd}`, paddingBottom: 6 }}>
              <Metric label="ETH/USD" value={`$${fn(cPrice, 1)}`} color={T.w} />
              <Metric label="Capital" value={`$${cap.toFixed(0)}`} sub={`+${pnl.toFixed(2)}%`} color={T.up} />
              <Metric label="Volatility" value={`${volRatio.toFixed(2)}x`} sub={`σ ${fp(vol)}`} color={proC(profile)} />
              <Metric label="Oracle" value={oracleStatus} sub={`${oracle.src}src · ${oracle.stale}s`} color={oraC(oracleStatus)} />
            </div>
            <Spark prices={prices} h={72} />
          </P>

          {/* Governance Pipeline — THE HERO */}
          <P title="Governance Pipeline" tag={`cycle ${47 + tick}`}>
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
        </div>

        {/* ═══ 3. DECISION ENGINE ═══ */}
        <P title="Decision Engine" tag={`${trades.length} decisions`} noPad>
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
          <P title="Trade Trust Proof" tag={`#${sel.id} · ${sel.approved ? "APPROVED" : "BLOCKED"}`}>
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
          <P title="Artifact Drawer" tag={`trade ${sel.id}`}>
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
            <P title="Execution Simulation" tag={sim.st}>
              {[["Expected Edge", fp(edgePct, 2), edgePct / 0.006, T.up], ["Slippage", `${sim.slip.toFixed(1)}bps`, sim.slip / 40, T.warn], ["Net Edge", fp(sim.net, 2), (sim.net + 0.005) / 0.01, sim.net > 0 ? T.up : T.dn]].map(([l, v, p, c]) => (
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
            <P title="Positions + Exposure" tag={`${positions.length} active`}>
              {positions.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${T.bg}50` }}>
                  <div><span style={{ color: sigC(p.side), fontWeight: 700 }}>#{p.id} {p.side} {fn(p.size, 4)}</span> <span style={{ color: T.fg3, fontSize: 9.5 }}>@ ${fn(p.entry)} · stop ${fn(p.stop)}</span></div>
                  <span style={{ color: p.pnl >= 0 ? T.up : T.dn, fontWeight: 700 }}>{p.pnl >= 0 ? "+" : ""}${fn(p.pnl)}</span>
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderTop: `1px solid ${T.brd}`, paddingTop: 6, marginTop: 4 }}>
                <div><div style={{ fontSize: 8, color: T.fg3 }}>GROSS</div><div style={{ fontWeight: 700 }}>8.2%</div></div>
                <div><div style={{ fontSize: 8, color: T.fg3 }}>DIRECTION</div><div style={{ fontWeight: 700 }}>63/37</div></div>
                <div><div style={{ fontSize: 8, color: T.fg3 }}>DRAWDOWN</div><div style={{ fontWeight: 700, color: T.warn }}>1.8%</div></div>
              </div>
            </P>
          </div>
        </div>

        {/* ═══ 5. TRUST LAYER + PROTOCOL + OPERATOR — 3 columns ═══ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>

          {/* Trust + Capital Rights */}
          <P title="Trust + Capital Ladder" tag={shortTier(tier)}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 8 }}>
              <div><div style={{ fontSize: 8, color: T.fg3 }}>TRUST SCORE</div><div style={{ fontSize: 18, fontWeight: 700, color: truC(trustScore) }}>{fn(trustScore, 0)}</div><div style={{ fontSize: 9, color: T.fg2 }}>{trustLabel(trustScore)} · {tDelta >= 0 ? "+" : ""}{fn(tDelta, 0)}</div></div>
              <div><div style={{ fontSize: 8, color: T.fg3 }}>CAPITAL RIGHT</div><div style={{ fontSize: 18, fontWeight: 700, color: T.info }}>{sup.eff.toFixed(2)}x</div><div style={{ fontSize: 9, color: T.fg2 }}>{recoveryMode ? "recovery capped" : shortTier(tier)}</div></div>
            </div>
            <Spark prices={trustHistory} h={48} colorOverride={truC(trustScore)} />
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

          {/* ERC-8004 + MCP */}
          <div style={{ display: "grid", gap: 10 }}>
            <P title="ERC-8004 Protocol" tag={erc.registrationStatus}>
              <KV k="agentId" v={String(erc.agentId)} />
              <KV k="agentRegistry" v={erc.agentRegistry} c={T.info} />
              <KV k="ownerWallet" v={erc.ownerWallet} />
              <KV k="agentWallet" v={erc.agentWallet} />
              <KV k="tradeIntentHash" v={erc.tradeIntentHash} c={T.cyan} />
              <KV k="validationRequestHash" v={erc.validationRequestHash} c={T.cyan} />
              <KV k="lastFeedbackTag" v={erc.lastFeedbackTag} c={T.warn} />
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                <Badge color={T.up}>identity ready</Badge><Badge color={T.info}>intent signed</Badge><Badge color={T.warn}>validation wired</Badge><Badge color={T.info}>reputation wired</Badge>
              </div>
            </P>
            <P title="MCP Interface" tag={`${mcp.tools.total} tools`}>
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
            <P title="Operator Controls" tag={opState}>
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
            <P title="Mandate + Supervisory" tag={sup.act}>
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
            <P title="Watch Items" tag="live">
              <div style={{ fontSize: 9.5, color: T.warn, lineHeight: 1.65 }}>
                {[
                  regime === "RANGING" ? "Whipsaw risk elevated — favour reduced size." : "Trend continuation healthy — monitor reversal signals.",
                  oracleStatus === "WATCH" ? "Oracle drift under observation." : "Oracle feeds healthy.",
                  recoveryMode ? "Trust recovery mode active — capital rights capped." : "Trust operating in standard mode.",
                  opState === "ACTIVE" ? "Operator state normal." : "Operator intervention currently affecting runtime.",
                ].map((m, i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}><span style={{ color: T.fg3, flexShrink: 0 }}>▸</span><span>{m}</span></div>)}
              </div>
            </P>
          </div>
        </div>
      </div>
    </div>
  );
}
