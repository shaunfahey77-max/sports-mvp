import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import sportsMvpLogo from "../assets/sports-mvp-logo.png";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function roundToQuarter(n) {
  return Math.round(n * 4) / 4;
}

function pct(v, digits = 1) {
  const n = num(v);
  if (n == null) return "—";
  return `${n.toFixed(digits)}%`;
}

function pctFromUnit(v, digits = 1) {
  const n = num(v);
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedNum(v, digits = 2) {
  const n = num(v);
  if (n == null) return "—";
  const abs = Math.abs(n).toFixed(digits);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${abs}`;
}

function clvCoverageUnit(v) {
  const n = num(v);
  if (n == null) return null;
  if (n > 1) return n / 100;
  if (n < 0) return null;
  return n;
}

function clvDisplay(avg, coverage, digits = 2) {
  const n = num(avg);
  const c = clvCoverageUnit(coverage);

  if (n == null) return "—";
  if (Math.abs(n) < 0.005) return "—";

  const base = signedNum(n, digits);
  if (c == null) return base;

  const pct = Math.round(c * 100);
  if (pct >= 95) return base;
  return `${base} · ${pct}%`;
}

function impliedClvDisplay(avg, coverage, digits = 2) {
  const n = num(avg);
  const c = clvCoverageUnit(coverage);

  if (n == null) return "—";
  if (Math.abs(n * 100) < 0.01) return "—";

  const base = `${(n * 100).toFixed(digits)}%`;
  if (c == null) return base;

  const pct = Math.round(c * 100);
  if (pct >= 95) return base;
  return `${base} · ${pct}%`;
}

function oddsText(v) {
  const n = num(v);
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtEv(v) {
  const n = num(v);
  if (n == null) return "—";
  return `${Math.round(n)}%`;
}

function marketText(bet) {
  if (!bet) return "—";
  const mt = String(bet.marketType || "").toLowerCase();
  const side = String(bet.side || "").toLowerCase();
  const line = num(bet.line);

  if (mt === "spread") {
    const sideText = side === "away" ? "Away" : side === "home" ? "Home" : side;
    return `${sideText} ${line == null ? "" : line > 0 ? `+${line}` : `${line}`}`.trim();
  }

  if (mt === "total") {
    const sideText = side === "under" ? "Under" : side === "over" ? "Over" : side;
    return `${sideText} ${line == null ? "" : line}`.trim();
  }

  if (mt === "moneyline") return side ? `${side.toUpperCase()} ML` : "Moneyline";

  return "—";
}

function tierColors(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "ELITE") {
    return {
      background: "rgba(16,185,129,0.12)",
      border: "1px solid rgba(16,185,129,0.28)",
      color: "#86efac",
    };
  }
  if (t === "STRONG") {
    return {
      background: "rgba(59,130,246,0.12)",
      border: "1px solid rgba(59,130,246,0.28)",
      color: "#93c5fd",
    };
  }
  if (t === "EDGE") {
    return {
      background: "rgba(245,158,11,0.12)",
      border: "1px solid rgba(245,158,11,0.28)",
      color: "#fcd34d",
    };
  }
  return {
    background: "rgba(148,163,184,0.12)",
    border: "1px solid rgba(148,163,184,0.22)",
    color: "#cbd5e1",
  };
}

function leagueColor(league) {
  if (league === "NBA") return "#60a5fa";
  if (league === "NCAAM") return "#f59e0b";
  if (league === "NHL") return "#34d399";
  return "#cbd5e1";
}

function tierBonus(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "ELITE") return 10;
  if (t === "STRONG") return 6;
  if (t === "EDGE") return 3;
  return 0;
}

function edgeScoreFromBet(bet) {
  if (!bet) return 0;

  const evNorm = (clamp(num(bet?.evForStake100) || 0, 0, 80) / 80) * 100;
  const confidenceNorm = clamp((num(bet?.modelProb) || 0) * 100, 0, 100);
  const edgeNorm = (clamp((num(bet?.edge) || 0) * 100, 0, 20) / 20) * 100;
  const kellyNorm = (clamp((num(bet?.kellyHalf) || 0) * 100, 0, 5) / 5) * 100;

  const score =
    evNorm * 0.4 +
    confidenceNorm * 0.25 +
    edgeNorm * 0.2 +
    kellyNorm * 0.1 +
    tierBonus(bet?.tier);

  return Math.round(clamp(score, 0, 99));
}

function sizeRecommendation(bet) {
  if (!bet) return { units: "—", bankrollPct: "—", mode: "No data" };

  const score = edgeScoreFromBet(bet);
  const tier = String(bet?.tier || "").toUpperCase();
  const kellyPct = Math.max(0, (num(bet?.kellyHalf) || 0) * 100);

  let units = 0.5;
  if (tier === "STRONG") units = 0.75;
  if (tier === "ELITE") units = 1.0;
  if (score >= 80) units += 0.5;
  else if (score >= 70) units += 0.25;
  if (kellyPct >= 5) units += 0.25;

  units = clamp(roundToQuarter(units), 0.5, 1.5);

  let mode = "Conservative";
  if (units >= 1.25) mode = "Aggressive";
  else if (units >= 1.0) mode = "Standard";

  return {
    units: `${units.toFixed(2).replace(/\.00$/, "")}u`,
    bankrollPct: `${units.toFixed(2).replace(/\.00$/, "")}%`,
    mode,
  };
}

function policyRows() {
  return [
    { league: "NBA", market: "Moneyline • Spread • Total", note: "CLV tracking where closing lines are available" },
    { league: "NCAAM", market: "Moneyline • Spread • Total", note: "CLV tracking where closing lines are available" },
    { league: "NHL", market: "Moneyline • Spread • Total", note: "CLV tracking where closing lines are available" },
  ];
}

function metricHelpText(key) {
  const map = {
    picks: "The number of premium recommendations currently surfaced on the homepage.",
    wins: "Scored wins from the recent KPI window.",
    scored: "Total graded picks contributing to recent performance context.",
    clv: "Closing line value. Positive is better. When coverage is partial, the UI shows the coverage-aware CLV signal instead of implying full closing-line coverage.",
    impliedClv: "Implied-probability view of closing line value.",
    edge: "Model edge versus market implied probability.",
    ev: "Expected value estimate for the recommended wager.",
    kelly: "Half-Kelly sizing signal from the model.",
    confidence: "Model probability for the recommended side or total.",
    edgeScore:
      "Edge Score v1 blends the live fields currently exposed to the homepage: EV, confidence, edge, Kelly, and tier. CLV and market movement can be layered in later when the pick payload exposes them directly.",
    betSize:
      "Recommended size derived from Kelly, Edge Score, and tier. Treated as bankroll guidance, not a guarantee.",
  };

  return map[key] || "";
}

function InfoTip({ text }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        marginLeft: "6px",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={text}
        title={text}
        style={{
          width: "18px",
          height: "18px",
          borderRadius: "999px",
          border: "1px solid rgba(148,163,184,0.25)",
          background: "rgba(15,23,42,0.92)",
          color: "#93c5fd",
          fontSize: "11px",
          fontWeight: 800,
          lineHeight: 1,
          cursor: "help",
          padding: 0,
        }}
      >
        i
      </button>

      {open ? (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "26px",
            left: 0,
            zIndex: 20,
            width: "260px",
            padding: "10px 12px",
            borderRadius: "12px",
            background: "rgba(2,6,23,0.98)",
            border: "1px solid rgba(96,165,250,0.24)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
            color: "#dbeafe",
            fontSize: "12px",
            lineHeight: 1.5,
            fontWeight: 500,
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

function LabelWithTip({ label, tip, style }) {
  return (
    <div style={style}>
      <span>{label}</span>
      <InfoTip text={tip} />
    </div>
  );
}

function SectionSummary({ summary, howToUse }) {
  return (
    <div style={{ display: "grid", gap: "10px", marginTop: "8px" }}>
      <p
        style={{
          margin: 0,
          color: "#cbd5e1",
          fontSize: "14px",
          lineHeight: 1.7,
          maxWidth: "760px",
        }}
      >
        {summary}
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "8px",
          padding: "12px 14px",
          borderRadius: "14px",
          background: "rgba(15,23,42,0.72)",
          border: "1px solid rgba(96,165,250,0.14)",
          color: "#bfdbfe",
          fontSize: "13px",
          lineHeight: 1.6,
        }}
      >
        <span style={{ fontSize: "14px" }}>ⓘ</span>
        <span>
          <strong>How to use this section:</strong> {howToUse}
        </span>
      </div>
    </div>
  );
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [perfLoading, setPerfLoading] = useState(true);
  const [error, setError] = useState("");
  const [perfError, setPerfError] = useState("");
  const [picks, setPicks] = useState([]);
  const [performance, setPerformance] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPredictions() {
      setLoading(true);
      setError("");
      try {
        const [nbaRes, ncaamRes, nhlRes] = await Promise.all([
          fetch("/api/predictions?league=nba"),
          fetch("/api/predictions?league=ncaam"),
          fetch("/api/predictions?league=nhl"),
        ]);

        const [nbaJson, ncaamJson, nhlJson] = await Promise.all([
          nbaRes.json(),
          ncaamRes.json(),
          nhlRes.json(),
        ]);

        const normalize = (league, games) =>
          (games || [])
            .filter((g) => g?.recommendedBet)
            .map((g) => ({
              league,
              gameId: g.gameId,
              matchup: `${g.away?.abbr || "AWAY"} @ ${g.home?.abbr || "HOME"}`,
              awayAbbr: g.away?.abbr || "AWAY",
              homeAbbr: g.home?.abbr || "HOME",
              awayLogo: g.away?.logo || "",
              homeLogo: g.home?.logo || "",
              bet: g.recommendedBet,
            }));

        const all = [
          ...normalize("NBA", nbaJson?.games),
          ...normalize("NCAAM", ncaamJson?.games),
          ...normalize("NHL", nhlJson?.games),
        ].sort((a, b) => {
          const scoreDiff = edgeScoreFromBet(b.bet) - edgeScoreFromBet(a.bet);
          if (scoreDiff !== 0) return scoreDiff;
          return (num(b?.bet?.evForStake100) || 0) - (num(a?.bet?.evForStake100) || 0);
        });

        const topOnly = all.filter((x) => x?.bet?.topPick === true);
        if (!cancelled) setPicks((topOnly.length ? topOnly : all).slice(0, 3));
      } catch {
        if (!cancelled) setError("Failed to load premium picks.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    async function loadPerformance() {
      setPerfLoading(true);
      setPerfError("");
      try {
        const res = await fetch("/api/performance/kpis");
        const json = await res.json();
        if (!cancelled) setPerformance(json);
      } catch {
        if (!cancelled) setPerfError("Failed to load recent performance.");
      } finally {
        if (!cancelled) setPerfLoading(false);
      }
    }

    loadPredictions();
    loadPerformance();

    return () => {
      cancelled = true;
    };
  }, []);

  const featured = picks[0] || null;
  const featuredScore = featured ? edgeScoreFromBet(featured.bet) : null;
  const featuredSize = featured ? sizeRecommendation(featured.bet) : null;

  const perfSummary = useMemo(() => {
    if (!performance?.data) return null;
    const p = performance.data;

    return {
      wins: p.wins || 0,
      scored: p.scored || 0,
      avgClv: p.avg_clv_line ?? null,
      avgImpliedClv: p.avg_clv_implied ?? null,
      clvCoverage: p.clv_coverage ?? p.clvCoverage ?? null,
      impliedClvCoverage: p.implied_clv_coverage ?? p.impliedClvCoverage ?? null,
    };
  }, [performance]);

  const styles = {
    page: {
      minHeight: "100vh",
      background:
        "radial-gradient(circle at top left, rgba(30,111,219,0.20), transparent 26%), radial-gradient(circle at top right, rgba(139,92,246,0.16), transparent 24%), linear-gradient(180deg, #071224 0%, #040b18 100%)",
      color: "#e5e7eb",
      padding: "28px 20px 40px",
    },
    shell: { maxWidth: "1180px", margin: "0 auto" },
    hero: {
      display: "grid",
      gridTemplateColumns: "1.35fr 0.95fr",
      gap: "20px",
      marginBottom: "22px",
    },
    panel: {
      background: "rgba(9,15,28,0.82)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: "24px",
      boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
      backdropFilter: "blur(10px)",
    },
    heroMain: { padding: "24px" },
    heroMeta: {
      padding: "20px",
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: "14px",
      alignContent: "start",
    },
    sectionTitle: {
      fontSize: "13px",
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "#93c5fd",
      marginBottom: "10px",
      fontWeight: 700,
    },
    headline: { display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" },
    logoWrap: {
      width: 520,
      height: 160,
      borderRadius: 24,
      background: "linear-gradient(135deg, rgba(30,111,219,0.25), rgba(242,183,5,0.22))",
      border: "1px solid rgba(148,163,184,0.18)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      padding: "14px 20px",
      boxSizing: "border-box",
      boxShadow: "0 12px 40px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.04)",
      flexShrink: 0,
    },
    logo: {
      width: "100%",
      height: "auto",
      transform: "scale(1.15)",
      objectFit: "contain",
      display: "block",
      flexShrink: 0,
    },
    h1: { fontSize: "42px", lineHeight: 1.02, margin: 0, fontWeight: 800, color: "#f8fafc" },
    subtitle: {
      margin: "8px 0 0",
      color: "#cbd5e1",
      fontSize: "16px",
      lineHeight: 1.6,
      maxWidth: "640px",
    },
    heroGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
      gap: "14px",
      marginTop: "20px",
    },
    statCard: {
      background: "rgba(15,23,42,0.92)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: "18px",
      padding: "16px",
      minHeight: "112px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    },
    statLabel: {
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "0.12em",
      color: "#94a3b8",
      marginBottom: "8px",
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
    },
    statValue: { fontSize: "30px", fontWeight: 800, color: "#f8fafc", lineHeight: 1 },
    statSubtext: {
      marginTop: "8px",
      color: "#94a3b8",
      fontSize: "12px",
      lineHeight: 1.45,
    },
    featuredTitle: { margin: "0 0 12px", fontSize: "24px", fontWeight: 800, color: "#f8fafc" },
    featuredCard: {
      background: "linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(7,12,24,0.95) 100%)",
      border: "1px solid rgba(96,165,250,0.18)",
      borderRadius: "20px",
      padding: "18px",
    },
    matchup: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "14px",
      marginBottom: "14px",
    },
    teamSide: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
    teamLogo: {
      width: "34px",
      height: "34px",
      objectFit: "contain",
      borderRadius: "999px",
      background: "rgba(15,23,42,0.65)",
      padding: "3px",
      border: "1px solid rgba(148,163,184,0.14)",
      flexShrink: 0,
    },
    teamText: { fontSize: "15px", fontWeight: 700, color: "#f8fafc" },
    featuredMetricGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: "10px",
      marginTop: "14px",
    },
    miniStat: {
      background: "rgba(15,23,42,0.8)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: "14px",
      padding: "12px",
    },
    miniLabel: {
      fontSize: "11px",
      color: "#94a3b8",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      marginBottom: "6px",
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
    },
    miniValue: { fontSize: "18px", fontWeight: 800, color: "#f8fafc" },
    badge: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: "999px",
      padding: "6px 10px",
      fontSize: "11px",
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
    },
    bodyGrid: { display: "grid", gridTemplateColumns: "1.55fr 0.95fr", gap: "20px" },
    sectionPanel: { padding: "22px" },
    picksGrid: { display: "grid", gap: "14px" },
    pickCard: {
      background: "rgba(9,15,28,0.82)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: "20px",
      padding: "18px",
      boxShadow: "0 16px 34px rgba(0,0,0,0.18)",
    },
    pickTop: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "12px",
      marginBottom: "14px",
    },
    pickLeague: {
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "0.12em",
      fontWeight: 800,
    },
    pickLine: { color: "#cbd5e1", fontSize: "15px", marginTop: "6px", fontWeight: 600 },
    metricsRow: {
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: "10px",
      marginBottom: "12px",
    },
    confidenceWrap: { marginTop: "6px" },
    confidenceLabelRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "8px",
      fontSize: "12px",
      color: "#94a3b8",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
    },
    confidenceLeft: {
      display: "flex",
      alignItems: "center",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
    },
    barTrack: {
      width: "100%",
      height: "10px",
      background: "rgba(30,41,59,0.95)",
      borderRadius: "999px",
      overflow: "hidden",
      border: "1px solid rgba(148,163,184,0.12)",
    },
    rightColStack: { display: "grid", gap: "20px" },
    policyCard: {
      background: "rgba(9,15,28,0.82)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: "18px",
      padding: "16px",
    },
    navGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" },
    navBtn: {
      display: "block",
      textDecoration: "none",
      borderRadius: "16px",
      padding: "14px 16px",
      fontWeight: 700,
      color: "#f8fafc",
      background: "rgba(15,23,42,0.9)",
      border: "1px solid rgba(148,163,184,0.12)",
    },
    empty: {
      background: "rgba(15,23,42,0.72)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: "18px",
      padding: "16px",
      color: "#94a3b8",
      fontSize: "14px",
    },
    helperBox: {
      marginTop: "14px",
      padding: "14px 16px",
      borderRadius: "16px",
      background: "rgba(15,23,42,0.72)",
      border: "1px solid rgba(148,163,184,0.12)",
    },
    helperTitle: {
      margin: 0,
      color: "#f8fafc",
      fontSize: "13px",
      fontWeight: 800,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    },
    helperText: {
      margin: "8px 0 0",
      color: "#cbd5e1",
      fontSize: "13px",
      lineHeight: 1.6,
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <section style={styles.hero}>
          <div style={{ ...styles.panel, ...styles.heroMain }}>
            <div style={styles.sectionTitle}>Premium Home</div>

            <div style={styles.headline}>
              <div style={styles.logoWrap}>
                <img src="/assets/sports-mvp-hero.png" alt="Sports MVP hero logo" style={styles.logo} />
              </div>
              <div>
                <h1 style={styles.h1}>Sports MVP Premium</h1>
                <p style={styles.subtitle}>
                  Edge-ranked premium picks, decision-grade sizing guidance, and model
                  intelligence designed to make the best opportunities easier to act on.
                </p>
              </div>
            </div>

            <SectionSummary
              summary="This premium homepage now centers on Edge Score v1, recommended bet size, and the strongest validated opportunities on the board. It is designed to help subscribers move from raw model data to decision-ready picks faster."
              howToUse="Start with Pick of the Day, compare the Top Picks board, and use Edge Score plus Bet Size together. Edge Score ranks quality; Bet Size helps translate that into bankroll action."
            />

            <div style={styles.heroGrid}>
              <div style={styles.statCard}>
                <LabelWithTip label="Today’s Picks" tip={metricHelpText("picks")} style={styles.statLabel} />
                <div style={styles.statValue}>{picks.length}</div>
                <div style={styles.statSubtext}>Top premium opportunities currently surfaced.</div>
              </div>

              <div style={styles.statCard}>
                <LabelWithTip label="Scored Picks" tip={metricHelpText("scored")} style={styles.statLabel} />
                <div style={styles.statValue}>{perfLoading ? "—" : perfSummary?.scored}</div>
                <div style={styles.statSubtext}>Recent graded sample supporting trust in the model.</div>
              </div>

              <div style={styles.statCard}>
                <LabelWithTip label="Avg CLV" tip={metricHelpText("clv")} style={styles.statLabel} />
                <div style={styles.statValue}>{perfLoading ? "—" : clvDisplay(perfSummary?.avgClv, perfSummary?.clvCoverage ?? perfSummary?.clv_coverage ?? null)}</div>
                <div style={styles.statSub}>Based on picks with closing data</div>
                <div style={styles.statSubtext}>Closing-line quality signal from recent scored picks.</div>
              </div>

              <div style={styles.statCard}>
                <LabelWithTip label="Edge Score" tip={metricHelpText("edgeScore")} style={styles.statLabel} />
                <div style={styles.statValue}>{featuredScore == null ? "—" : featuredScore}</div>
                <div style={styles.statSubtext}>Premium ranking score for the current top play.</div>
              </div>

              <div style={styles.statCard}>
                <LabelWithTip label="Bet Size" tip={metricHelpText("betSize")} style={styles.statLabel} />
                <div style={styles.statValue}>{featuredSize?.units || "—"}</div>
                <div style={styles.statSubtext}>{featuredSize?.mode || "Sizing unavailable"} guidance.</div>
              </div>
            </div>
          </div>

          <div style={{ ...styles.panel, ...styles.heroMeta }}>
            <div>
              <div style={styles.sectionTitle}>Pick of the Day</div>
              <SectionSummary
                summary="The single highest-ranked premium play currently available using Edge Score v1."
                howToUse="Treat this as the model’s clearest current statement. Use Edge Score for ranking, EV for expected value, and Bet Size for bankroll guidance."
              />
            </div>

            {!featured ? (
              <div style={styles.empty}>
                {loading ? "Loading top pick..." : error || "No validated top pick available."}
              </div>
            ) : (
              <div style={styles.featuredCard}>
                <div style={styles.matchup}>
                  <div style={styles.teamSide}>
                    <img src={featured.awayLogo} alt={featured.awayAbbr} style={styles.teamLogo} />
                    <div style={styles.teamText}>{featured.awayAbbr}</div>
                  </div>
                  <div style={{ color: "#94a3b8", fontWeight: 700, fontSize: "13px", letterSpacing: "0.08em" }}>
                    AT
                  </div>
                  <div style={styles.teamSide}>
                    <div style={styles.teamText}>{featured.homeAbbr}</div>
                    <img src={featured.homeLogo} alt={featured.homeAbbr} style={styles.teamLogo} />
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#facc15", background: "rgba(250,204,21,0.12)", border: "1px solid rgba(250,204,21,0.28)", padding: "6px 10px", borderRadius: 999 }}>
                    Top Pick
                  </span>
                </div>
                <h3 style={styles.featuredTitle}>{marketText(featured.bet)}</h3>

                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
                  <div style={{ ...styles.badge, ...tierColors(featured.bet?.tier) }}>
                    {featured.bet?.tier || "—"}
                  </div>
                  <div style={{ ...styles.badge, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.28)", color: "#bfdbfe" }}>
                    Edge Score {featuredScore}
                  </div>
                  <div style={{ ...styles.badge, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.28)", color: "#fde68a" }}>
                    {featuredSize?.units} • {featuredSize?.mode}
                  </div>
                </div>

                <div style={styles.featuredMetricGrid}>
                  <div style={styles.miniStat}>
                    <LabelWithTip label="Edge Score" tip={metricHelpText("edgeScore")} style={styles.miniLabel} />
                    <div style={{ ...styles.miniValue, color: "#bfdbfe" }}>{featuredScore}</div>
                  </div>
                  <div style={styles.miniStat}>
                    <LabelWithTip label="EV" tip={metricHelpText("ev")} style={styles.miniLabel} />
                    <div style={{ ...styles.miniValue, color: "#93c5fd" }}>{fmtEv(featured.bet?.evForStake100)}</div>
                  </div>
                  <div style={styles.miniStat}>
                    <LabelWithTip label="Bet Size" tip={metricHelpText("betSize")} style={styles.miniLabel} />
                    <div style={{ ...styles.miniValue, color: "#fde68a" }}>{featuredSize?.units}</div>
                  </div>
                  <div style={styles.miniStat}>
                    <LabelWithTip label="Kelly" tip={metricHelpText("kelly")} style={styles.miniLabel} />
                    <div style={{ ...styles.miniValue, color: "#86efac" }}>
                      {featured.bet?.kellyHalf == null ? "—" : pct((Number(featured.bet.kellyHalf) || 0) * 100, 1)}
                    </div>
                  </div>
                </div>

                <div style={styles.confidenceWrap}>
                  <div style={styles.confidenceLabelRow}>
                    <div style={styles.confidenceLeft}>
                      <span>Confidence</span>
                      <InfoTip text={metricHelpText("confidence")} />
                    </div>
                    <span>{pctFromUnit(featured.bet?.modelProb, 1)}</span>
                  </div>
                  <div style={styles.barTrack}>
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, (Number(featured.bet?.modelProb) || 0) * 100))}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, #2563eb 0%, #22c55e 100%)",
                        borderRadius: "999px",
                      }}
                    />
                  </div>
                </div>

                <div style={styles.helperBox}>
                  <p style={styles.helperTitle}>Why this is ranked first</p>
                  <p style={styles.helperText}>
                    Edge Score v1 blends EV, confidence, edge, Kelly, and tier into one premium ranking signal.
                    Bet Size then turns that rank into bankroll guidance for subscribers.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <div style={styles.bodyGrid}>
          <section style={{ ...styles.panel, ...styles.sectionPanel }}>
            <div
              style={{
                display: "flex",
                alignItems: "end",
                justifyContent: "space-between",
                gap: "16px",
                marginBottom: "18px",
              }}
            >
              <div>
                <div style={styles.sectionTitle}>Premium Edge Board</div>
                <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 800, color: "#f8fafc" }}>
                  🔥 Today's Top Picks
                </h2>

                <SectionSummary
                  summary="These plays are ranked using Edge Score v1 and then organized for quick comparison. EV remains visible, but ranking now reflects a more complete premium view of quality."
                  howToUse="Use this board to compare quality, expected value, and bankroll guidance side by side. Start with the higher Edge Score, then confirm the EV and suggested bet size fit your risk tolerance."
                />
              </div>

              <Link
                to="/predict"
                style={{
                  ...styles.navBtn,
                  background: "#2563eb",
                  border: "1px solid rgba(59,130,246,0.36)",
                }}
              >
                View All Picks
              </Link>
            </div>

            {loading ? (
              <div style={styles.empty}>Loading premium picks...</div>
            ) : error ? (
              <div style={{ ...styles.empty, color: "#fda4af" }}>{error}</div>
            ) : picks.length === 0 ? (
              <div style={styles.empty}>No validated premium picks available right now.</div>
            ) : (
              <div style={styles.picksGrid}>
                {picks.map((row, i) => {
                  const score = edgeScoreFromBet(row.bet);
                  const size = sizeRecommendation(row.bet);
                  const rankLabel =
                    i === 0 ? "#1 EDGE LEADER" :
                    i === 1 ? "#2 EV VALUE" :
                    "#3 PREMIUM PLAY";

                  return (
                    <article key={`${row.league}-${row.gameId}`} style={styles.pickCard}>
                      <div
                        style={{
                          fontSize: 11,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "#94a3b8",
                          marginBottom: 6,
                          fontWeight: 700,
                        }}
                      >
                        {rankLabel}
                      </div>

                      <div style={styles.pickTop}>
                        <div>
                          <div style={{ ...styles.pickLeague, color: leagueColor(row.league) }}>{row.league}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                            {row.awayLogo ? (
                              <img src={row.awayLogo} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />
                            ) : null}
                            <div style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc" }}>{row.matchup}</div>
                            {row.homeLogo ? (
                              <img src={row.homeLogo} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />
                            ) : null}
                          </div>

                          <div style={styles.pickLine}>
                            {marketText(row.bet)} • Odds {oddsText(row.bet?.odds)}{" "}
                            {row.bet?.line != null ? `• Line ${row.bet.line}` : ""}
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                          <span style={{ ...styles.badge, ...tierColors(row.bet?.tier) }}>
                            {row.bet?.tier || "—"}
                          </span>
                          <span style={{ ...styles.badge, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.28)", color: "#bfdbfe" }}>
                            Score {score}
                          </span>
                        </div>
                      </div>

                      <div style={styles.metricsRow}>
                        <div style={styles.miniStat}>
                          <LabelWithTip label="Edge Score" tip={metricHelpText("edgeScore")} style={styles.miniLabel} />
                          <div style={{ ...styles.miniValue, color: "#bfdbfe" }}>{score}</div>
                        </div>

                        <div style={styles.miniStat}>
                          <LabelWithTip label="EV" tip={metricHelpText("ev")} style={styles.miniLabel} />
                          <div style={{ ...styles.miniValue, color: "#93c5fd" }}>{fmtEv(row.bet?.evForStake100)}</div>
                        </div>

                        <div style={styles.miniStat}>
                          <LabelWithTip label="Bet Size" tip={metricHelpText("betSize")} style={styles.miniLabel} />
                          <div style={{ ...styles.miniValue, color: "#fde68a" }}>{size.units}</div>
                        </div>

                        <div style={styles.miniStat}>
                          <LabelWithTip label="Kelly" tip={metricHelpText("kelly")} style={styles.miniLabel} />
                          <div style={{ ...styles.miniValue, color: "#86efac" }}>
                            {row.bet?.kellyHalf == null ? "—" : pct((Number(row.bet.kellyHalf) || 0) * 100, 1)}
                          </div>
                        </div>
                      </div>

                      <div style={styles.confidenceWrap}>
                        <div style={styles.confidenceLabelRow}>
                          <div style={styles.confidenceLeft}>
                            <span>Confidence</span>
                            <InfoTip text={metricHelpText("confidence")} />
                          </div>
                          <span>{pctFromUnit(row.bet?.modelProb, 1)}</span>
                        </div>
                        <div style={styles.barTrack}>
                          <div
                            style={{
                              width: `${Math.max(0, Math.min(100, (Number(row.bet?.modelProb) || 0) * 100))}%`,
                              height: "100%",
                              background: "linear-gradient(90deg, #2563eb 0%, #22c55e 100%)",
                              borderRadius: "999px",
                            }}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <aside style={styles.rightColStack}>
            <section style={{ ...styles.panel, ...styles.sectionPanel }}>
              <div style={styles.sectionTitle}>Premium Method</div>
              <h2 style={{ margin: "0 0 14px", fontSize: "28px", fontWeight: 800, color: "#f8fafc" }}>
                Edge Score
              </h2>

              <SectionSummary
                summary="Edge Score v1 is the premium ranking layer for homepage plays."
                howToUse="Read Edge Score first for ordering, then use EV and Bet Size to decide whether the opportunity fits your bankroll approach."
              />

              <div style={{ display: "grid", gap: "12px", marginTop: "14px" }}>
                <div style={styles.policyCard}>
                  <div style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: "#93c5fd" }}>
                    Blend
                  </div>
                  <div style={{ marginTop: "8px", color: "#f8fafc", fontWeight: 700 }}>EV • Confidence • Edge • Kelly • Tier</div>
                  <div style={{ marginTop: "6px", color: "#94a3b8", fontSize: "13px", lineHeight: 1.55 }}>
                    CLV and market movement can be layered into this later when the live pick payload exposes them directly.
                  </div>
                </div>

                <div style={styles.policyCard}>
                  <div style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: "#fde68a" }}>
                    Sizing
                  </div>
                  <div style={{ marginTop: "8px", color: "#f8fafc", fontWeight: 700 }}>Conservative • Standard • Aggressive</div>
                  <div style={{ marginTop: "6px", color: "#94a3b8", fontSize: "13px", lineHeight: 1.55 }}>
                    Bet Size guidance uses Kelly, Edge Score, and tier to convert picks into bankroll action.
                  </div>
                </div>
              </div>
            </section>

            <section style={{ ...styles.panel, ...styles.sectionPanel }}>
              <div style={styles.sectionTitle}>Premium Market Coverage</div>
              <h2 style={{ margin: "0 0 14px", fontSize: "28px", fontWeight: 800, color: "#f8fafc" }}>
                Market Coverage
              </h2>

              <SectionSummary
                summary="The premium scoring layer now evaluates moneyline, spread, and totals across NBA, NCAAM, and NHL."
                howToUse="Use this section as a coverage guide, not a restriction. The homepage can now surface premium opportunities from all three major market types."
              />

              <div style={{ display: "grid", gap: "12px", marginTop: "14px" }}>
                {policyRows().map((row) => (
                  <div key={row.league} style={styles.policyCard}>
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 800,
                        letterSpacing: "0.10em",
                        textTransform: "uppercase",
                        color: leagueColor(row.league),
                      }}
                    >
                      {row.league}
                    </div>
                    <div style={{ marginTop: "6px", fontSize: "18px", fontWeight: 700, color: "#f8fafc" }}>
                      {row.market}
                    </div>
                    <div style={{ marginTop: "4px", fontSize: "13px", color: "#94a3b8" }}>{row.note}</div>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ ...styles.panel, ...styles.sectionPanel }}>
              <div style={styles.sectionTitle}>Recent Performance</div>
              <h2 style={{ margin: "0 0 14px", fontSize: "28px", fontWeight: 800, color: "#f8fafc" }}>
                Trust Layer
              </h2>

              <SectionSummary
                summary="Quick context from the performance KPI endpoint."
                howToUse="Use this section to judge whether the premium homepage is operating on enough recent graded volume to trust the rankings."
              />

              {perfLoading ? (
                <div style={styles.empty}>Loading recent performance...</div>
              ) : perfError ? (
                <div style={{ ...styles.empty, color: "#fda4af" }}>{perfError}</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px", marginTop: "14px" }}>
                  <div style={styles.policyCard}>
                    <div style={styles.miniLabel}>Wins</div>
                    <div style={{ ...styles.statValue, color: "#86efac" }}>{perfSummary?.wins}</div>
                  </div>
                  <div style={styles.policyCard}>
                    <div style={styles.miniLabel}>Scored</div>
                    <div style={styles.statValue}>{perfSummary?.scored}</div>
                  </div>
                  <div style={styles.policyCard}>
                    <div style={styles.miniLabel}>Avg CLV</div>
                    <div style={styles.statValue}>{clvDisplay(perfSummary?.avgClv, perfSummary?.clvCoverage ?? perfSummary?.clv_coverage ?? null)}</div>
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: 4 }}>Closing-data aware</div>
                  </div>
                  <div style={styles.policyCard}>
                    <div style={styles.miniLabel}>Imp CLV</div>
                    <div style={styles.statValue}>{impliedClvDisplay(perfSummary?.avgImpliedClv, perfSummary?.impliedClvCoverage ?? perfSummary?.implied_clv_coverage ?? null, 2)}</div>
                  </div>
                </div>
              )}
            </section>

            <section style={{ ...styles.panel, ...styles.sectionPanel }}>
              <div style={styles.sectionTitle}>Application Hub</div>
              <h2 style={{ margin: "0 0 14px", fontSize: "28px", fontWeight: 800, color: "#f8fafc" }}>
                Navigate
              </h2>

              <SectionSummary
                summary="Fast access to deeper prediction views and performance reporting."
                howToUse="Use All Picks for the full ranked board, Performance for analytics, and My Bets for bankroll tracking."
              />

              <div style={styles.navGrid}>
                <Link to="/predict" style={{ ...styles.navBtn, background: "#2563eb", border: "1px solid rgba(59,130,246,0.36)" }}>All Picks</Link>
                <Link to="/predict-nba" style={styles.navBtn}>NBA</Link>
                <Link to="/ncaab-predictions" style={styles.navBtn}>NCAAM</Link>
                <Link to="/predict-nhl" style={styles.navBtn}>NHL</Link>
                <Link to="/performance" style={styles.navBtn}>Performance</Link>
                <Link to="/my-bets" style={styles.navBtn}>My Bets</Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
