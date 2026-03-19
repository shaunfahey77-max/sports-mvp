import { useEffect, useMemo, useState } from "react";

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
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

function americanToDecimal(odds) {
  const o = num(odds);
  if (o == null || o === 0) return null;
  if (o > 0) return 1 + o / 100;
  return 1 + 100 / Math.abs(o);
}

function decimalToAmerican(d) {
  const dec = num(d);
  if (dec == null || dec <= 1) return null;
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

function calcParlayMetrics(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return null;

  let decimal = 1;
  let modelProb = 1;

  for (const leg of legs) {
    const dec = americanToDecimal(leg.odds);
    const p = num(leg.modelProb);
    if (dec == null || p == null || p <= 0 || p >= 1) return null;
    decimal *= dec;
    modelProb *= p;
  }

  const b = decimal - 1;
  const q = 1 - modelProb;
  const evForStake100 = modelProb * b * 100 - q * 100;
  const impliedProb = decimal > 1 ? 1 / decimal : null;
  const rawKelly = b > 0 ? ((b * modelProb) - q) / b : null;
  const kellyHalf = rawKelly == null ? null : Math.max(0, rawKelly / 2);

  return {
    decimalOdds: decimal,
    americanOdds: decimalToAmerican(decimal),
    modelProb,
    impliedProb,
    evForStake100,
    kellyHalf,
  };
}

function legPickLabel(leg) {
  const mt = String(leg.marketType || "").toLowerCase();
  const side = String(leg.side || "").toLowerCase();
  const line = num(leg.line);

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

function buildCombos(legsPool, comboSize) {
  const out = [];
  const size = Math.max(2, Math.min(6, Number(comboSize) || 2));

  function walk(start, chosen) {
    if (chosen.length === size) {
      const metrics = calcParlayMetrics(chosen);
      if (!metrics) return;
      out.push({
        id: chosen.map((x) => x.gameId).join("-"),
        legs: [...chosen],
        label: chosen.map((x) => `${x.teamLabel} ${x.pickLabel}`).join(" + "),
        ...metrics,
      });
      return;
    }

    for (let i = start; i < legsPool.length; i += 1) {
      chosen.push(legsPool[i]);
      walk(i + 1, chosen);
      chosen.pop();
    }
  }

  walk(0, []);
  return out;
}

function cardStyle() {
  return {
    background: "rgba(9,15,28,0.82)",
    border: "1px solid rgba(148,163,184,0.14)",
    borderRadius: 22,
    boxShadow: "0 18px 46px rgba(0,0,0,0.22)",
  };
}

function tileStyle() {
  return {
    background: "rgba(15,23,42,0.9)",
    border: "1px solid rgba(148,163,184,0.12)",
    borderRadius: 16,
    padding: 14,
  };
}

export default function Parlays() {
  const [league, setLeague] = useState("nba");
  const [date, setDate] = useState(todayYMD());
  const [legs, setLegs] = useState(2);
  const [limit, setLimit] = useState(8);
  const [stake, setStake] = useState(100);
  const [evOnly, setEvOnly] = useState(true);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [predictionData, setPredictionData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const predictionUrl = `/api/predictions?league=${league}&date=${date}`;
        const predictionRes = await fetch(predictionUrl);
        const predictionJson = await predictionRes.json();

        if (!cancelled) setPredictionData(predictionJson);
      } catch {
        if (!cancelled) setError("Failed to load premium parlay data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [league, date, legs, limit, evOnly]);

  const candidateLegs = useMemo(() => {
    return (predictionData?.games || [])
      .filter((g) => g?.recommendedBet)
      .map((g) => {
        const bet = g.recommendedBet;
        return {
          gameId: g.gameId,
          matchup: `${g.away?.abbr || "AWAY"} @ ${g.home?.abbr || "HOME"}`,
          teamLabel:
            String(bet?.marketType || "").toLowerCase() === "spread"
              ? `${String(bet?.side || "").toLowerCase() === "away" ? g.away?.abbr : g.home?.abbr || ""}`
              : `${g.away?.abbr || "AWAY"} @ ${g.home?.abbr || "HOME"}`,
          marketType: bet.marketType,
          side: bet.side,
          line: bet.line,
          odds: bet.odds,
          modelProb: bet.modelProb,
          evForStake100: bet.evForStake100,
          kellyHalf: bet.kellyHalf,
          tier: bet.tier,
          pickLabel: legPickLabel(bet),
        };
      })
      .filter((leg) => num(leg.odds) != null && num(leg.modelProb) != null);
  }, [predictionData]);

  const selectedCombos = useMemo(() => {
    const comboSize = Math.max(2, Math.min(4, Number(legs) || 2));
    const poolSize = comboSize === 2 ? 6 : comboSize === 3 ? 7 : 8;
    const top = candidateLegs.slice(0, poolSize);
    const built = buildCombos(top, comboSize);
    const sorted = built.sort((a, b) => (num(b.evForStake100) || -9999) - (num(a.evForStake100) || -9999));
    const filtered = evOnly ? sorted.filter((c) => (num(c.evForStake100) || 0) > 0) : sorted;
    return filtered.slice(0, Math.max(2, Number(limit) || 8));
  }, [candidateLegs, evOnly, legs, limit]);

  const twoLegCombos = useMemo(() => {
    const top = candidateLegs.slice(0, 6);
    const built = buildCombos(top, 2);
    const sorted = built.sort((a, b) => (num(b.evForStake100) || -9999) - (num(a.evForStake100) || -9999));
    return evOnly ? sorted.filter((c) => (num(c.evForStake100) || 0) > 0) : sorted;
  }, [candidateLegs, evOnly]);

  const bestAvailable = selectedCombos[0] || null;
  const safest = [...selectedCombos].sort((a, b) => (num(b.modelProb) || -9999) - (num(a.modelProb) || -9999))[0] || null;
  const highestEv = selectedCombos[0] || null;
  const featuredCombo = bestAvailable;

  const projectedPayout = useMemo(() => {
    if (!featuredCombo) return null;
    const s = num(stake) || 0;
    const totalReturn = s * (featuredCombo.decimalOdds || 0);
    const profit = totalReturn - s;
    const kellyStake = featuredCombo.kellyHalf == null ? null : s * featuredCombo.kellyHalf;
    return { totalReturn, profit, kellyStake };
  }, [featuredCombo, stake]);

  const heatmapRows = useMemo(() => candidateLegs.slice(0, 6), [candidateLegs]);

  const heatmapValue = (a, b) => {
    if (!a || !b || a.gameId === b.gameId) return null;
    const metrics = calcParlayMetrics([a, b]);
    return metrics?.evForStake100 ?? null;
  };

  const styles = {
    page: {
      minHeight: "100vh",
      background:
        "radial-gradient(circle at top left, rgba(30,111,219,0.20), transparent 26%), radial-gradient(circle at top right, rgba(139,92,246,0.16), transparent 24%), linear-gradient(180deg, #071224 0%, #040b18 100%)",
      color: "#e5e7eb",
      padding: "28px 20px 40px",
    },
    shell: { maxWidth: 1180, margin: "0 auto" },
    hero: {
      ...cardStyle(),
      padding: 24,
      marginBottom: 20,
      background: "linear-gradient(180deg, rgba(9,15,28,0.92) 0%, rgba(7,12,24,0.96) 100%)",
    },
    heroIntroGrid: {
      display: "grid",
      gridTemplateColumns: "minmax(320px, 1.05fr) minmax(320px, 1fr)",
      gap: 22,
      alignItems: "start",
      marginBottom: 18,
    },
    topGrid: {
      display: "grid",
      gridTemplateColumns: "320px 1fr",
      gap: 18,
      alignItems: "start",
    },
    methodGrid: {
      display: "grid",
      gridTemplateColumns: "1.15fr 1fr",
      gap: 16,
      marginTop: 18,
    },
    methodCard: {
      background: "linear-gradient(180deg, rgba(15,23,42,0.96), rgba(10,15,28,0.98))",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: 20,
      padding: 18,
      boxShadow: "0 16px 34px rgba(0,0,0,0.18)",
      minHeight: "100%",
    },
    whyGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: 14,
      marginTop: 18,
      marginBottom: 18,
    },
    whyCard: {
      background: "linear-gradient(180deg, rgba(15,23,42,0.96), rgba(10,15,28,0.98))",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: 20,
      padding: 18,
      boxShadow: "0 16px 34px rgba(0,0,0,0.18)",
      minHeight: "100%",
    },
    chipRow: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginTop: 12,
    },
    chip: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "6px 10px",
      fontSize: 11,
      fontWeight: 800,
      color: "#93c5fd",
      background: "rgba(30,41,59,0.82)",
      border: "1px solid rgba(59,130,246,0.18)",
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    },
    formCard: { ...tileStyle(), padding: 16 },
    label: {
      display: "block",
      fontSize: 12,
      color: "#94a3b8",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      marginBottom: 6,
      fontWeight: 700,
    },
    input: {
      width: "100%",
      background: "rgba(30,41,59,0.82)",
      border: "1px solid rgba(148,163,184,0.18)",
      color: "#f8fafc",
      borderRadius: 12,
      padding: "10px 12px",
      outline: "none",
    },
    statGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: 12,
      marginTop: 14,
    },
    statTile: {
      ...tileStyle(),
      minHeight: 90,
      background: "linear-gradient(180deg, rgba(15,23,42,0.96), rgba(10,15,28,0.98))",
      border: "1px solid rgba(59,130,246,0.18)",
      boxShadow: "0 18px 40px rgba(0,0,0,0.24), 0 0 0 1px rgba(59,130,246,0.05)",
    },
    metricLabel: {
      fontSize: 11,
      color: "#94a3b8",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      fontWeight: 700,
      marginBottom: 8,
    },
    metricValue: {
      fontSize: 24,
      lineHeight: 1.05,
      fontWeight: 800,
      color: "#f8fafc",
    },
    panelGrid: {
      display: "grid",
      gridTemplateColumns: "1.25fr 0.95fr",
      gap: 20,
    },
    sectionPanel: {
      ...cardStyle(),
      padding: 22,
    },
    h2: {
      margin: 0,
      fontSize: 28,
      fontWeight: 800,
      color: "#f8fafc",
    },
    overline: {
      fontSize: 12,
      color: "#93c5fd",
      textTransform: "uppercase",
      letterSpacing: "0.14em",
      fontWeight: 800,
      marginBottom: 10,
    },
    comboCard: {
      ...tileStyle(),
      marginTop: 14,
    },
    comboLegs: {
      display: "grid",
      gap: 8,
      marginTop: 10,
    },
    comboLeg: {
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      fontSize: 14,
      color: "#cbd5e1",
    },
    barTrack: {
      width: "100%",
      height: 10,
      background: "rgba(30,41,59,0.95)",
      borderRadius: 999,
      overflow: "hidden",
      border: "1px solid rgba(148,163,184,0.12)",
    },
    navyBox: {
      ...tileStyle(),
      marginTop: 14,
    },
    heatTable: {
      width: "100%",
      borderCollapse: "separate",
      borderSpacing: 8,
      marginTop: 14,
    },
    heatCell: {
      borderRadius: 12,
      padding: "12px 10px",
      textAlign: "center",
      fontWeight: 700,
      fontSize: 13,
    },
    payoutGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: 12,
      marginTop: 12,
    },
    listCard: {
      ...tileStyle(),
      marginTop: 14,
      padding: 16,
    },
    subscriberGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: 14,
      marginTop: 18,
      marginBottom: 18,
    },
    subscriberCard: {
      background: "linear-gradient(180deg, rgba(15,23,42,0.96), rgba(10,15,28,0.98))",
      border: "1px solid rgba(59,130,246,0.18)",
      borderRadius: 20,
      padding: 18,
      boxShadow: "0 18px 40px rgba(0,0,0,0.24), 0 0 0 1px rgba(59,130,246,0.05)",
      minHeight: "100%",
    },
    subscriberList: {
      display: "grid",
      gap: 10,
      marginTop: 12,
    },
    subscriberItem: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      color: "#cbd5e1",
      fontSize: 14,
      lineHeight: 1.5,
    },
    subscriberDot: {
      width: 8,
      height: 8,
      borderRadius: 999,
      background: "#60a5fa",
      boxShadow: "0 0 12px rgba(96,165,250,0.55)",
      flex: "0 0 auto",
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <section style={styles.hero}>
          <div style={styles.overline}>Premium Parlay Lab</div>

          <div style={styles.heroIntroGrid}>
            <div>
              <img
                src="/landing/hero-logo.png"
                alt="Sports MVP premium parlay logo"
                style={{
                  width: "100%",
                  maxWidth: 620,
                  height: "auto",
                  display: "block",
                  marginTop: 4,
                  marginBottom: 6,
                }}
              />

              <p style={{ color: "#94a3b8", marginTop: 14, marginBottom: 0, lineHeight: 1.7 }}>
                The Sports MVP Parlay Lab transforms validated model picks into structured same-slate combo opportunities
                using expected value, compounded win probability, Kelly sizing logic, and premium filtering.
              </p>
            </div>

            <div>
              <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.02, fontWeight: 900, color: "#f8fafc", letterSpacing: "-0.04em", maxWidth: 520 }}>
                Build smarter parlays with model-ranked combo intelligence.
              </h1>

              <p style={{ color: "#cbd5e1", marginTop: 12, marginBottom: 0, fontSize: 17, lineHeight: 1.65 }}>
                Evaluate same-slate parlay combinations across NBA, NHL, and NCAAM using our proprietary pick engine,
                parlay EV math, payout modeling, and bankroll-aware Kelly guidance.
              </p>

              <p style={{ color: "#94a3b8", marginTop: 12, marginBottom: 0, lineHeight: 1.7 }}>
                This page is designed to help subscribers compare the best available combo, the safest build,
                the highest EV combination, and the strongest two-leg relationships from the current premium candidate pool.
              </p>
            </div>
          </div>

          <div
            style={{
              marginTop: 2,
              padding: "10px 14px",
              borderRadius: 16,
              background: "rgba(15,23,42,0.76)",
              border: "1px solid rgba(59,130,246,0.16)",
              color: "#cbd5e1",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "#e2e8f0" }}>How to use this page:</strong> set your league, date, legs, and result count,
            review the best available and safest combos, then compare combo EV, model probability, payout, and Kelly stake
            before deciding whether the parlay fits your bankroll discipline.
          </div>

          <div style={styles.methodGrid}>
            <div style={{ ...styles.methodCard, border: "1px solid rgba(59,130,246,0.18)" }}>
              <div style={styles.overline}>How It Works</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#f8fafc", marginBottom: 10 }}>Premium parlay workflow</div>
              <div style={{ color: "#cbd5e1", lineHeight: 1.75, fontSize: 14 }}>
                The engine starts with validated Sports MVP picks, converts each leg into a priced combo candidate,
                calculates parlay probability and EV, then surfaces the best combinations for same-slate construction.
              </div>
              <div style={styles.chipRow}>
                <span style={styles.chip}>Validated Picks</span>
                <span style={styles.chip}>Combo EV</span>
                <span style={styles.chip}>Model Probability</span>
                <span style={styles.chip}>Kelly Sizing</span>
              </div>
            </div>

            <div style={{ ...styles.methodCard, border: "1px solid rgba(16,185,129,0.18)" }}>
              <div style={styles.overline}>Parlay Engine</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#f8fafc", marginBottom: 10 }}>What this engine is doing</div>
              <div style={{ color: "#cbd5e1", lineHeight: 1.75, fontSize: 14 }}>
                Sports MVP compares candidate legs, compounds their market odds and model win probabilities, estimates expected value,
                and highlights the strongest combo structures through top-combo ranking, payout analysis, and a two-leg EV heatmap.
              </div>
              <div style={{ marginTop: 14, color: "#86efac", fontSize: 13, fontWeight: 700 }}>
                Best combo + safest combo + payout modeling + two-leg heatmap
              </div>
            </div>
          </div>

          <div style={styles.topGrid}>
            <div style={styles.formCard}>
              <div style={{ marginBottom: 12 }}>
                <label style={styles.label}>League</label>
                <select value={league} onChange={(e) => setLeague(e.target.value)} style={styles.input}>
                  <option value="nba">NBA</option>
                  <option value="ncaam">NCAAM</option>
                  <option value="nhl">NHL</option>
                </select>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={styles.label}>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={styles.input} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={styles.label}>Legs</label>
                  <input type="number" min="2" max="4" value={legs} onChange={(e) => setLegs(Number(e.target.value) || 2)} style={styles.input} />
                </div>
                <div>
                  <label style={styles.label}>Results</label>
                  <input type="number" min="2" max="20" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 8)} style={styles.input} />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={styles.label}>Stake</label>
                <input type="number" min="1" step="1" value={stake} onChange={(e) => setStake(Number(e.target.value) || 100)} style={styles.input} />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#cbd5e1", marginTop: 8 }}>
                <input type="checkbox" checked={evOnly} onChange={(e) => setEvOnly(e.target.checked)} />
                +EV only
              </label>
            </div>

            <div>
              <div style={styles.statGrid}>
                {[{ title: "Best Available", combo: bestAvailable, metric: "EV" }, { title: "Safest", combo: safest, metric: "Prob" }, { title: "Highest EV", combo: highestEv, metric: "EV" }].map((item) => (
                  <div key={item.title} style={styles.statTile}>
                    <div style={styles.metricLabel}>{item.title}</div>
                    <div style={{ fontWeight: 700, color: "#f8fafc", fontSize: 16, marginBottom: 8 }}>
                      {item.combo ? item.combo.label : "—"}
                    </div>
                    <div style={styles.metricValue}>
                      {item.combo
                        ? item.metric === "Prob"
                          ? pctFromUnit(item.combo.modelProb, 1)
                          : fmtEv(item.combo.evForStake100)
                        : "—"}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, color: "#94a3b8", fontSize: 13 }}>
                {loading ? "Loading parlay calculations..." : error || `Candidate legs: ${candidateLegs.length} • ${legs}-leg combos: ${selectedCombos.length} • Two-leg heatmap combos: ${twoLegCombos.length}`}
              </div>
            </div>
          </div>
        </section>

        <section style={{ ...styles.sectionPanel, marginBottom: 20 }}>
          <div style={styles.overline}>Why this parlay engine is different</div>
          <h2 style={styles.h2}>Premium combo intelligence, not generic parlay picks</h2>
          <p style={{ color: "#94a3b8", marginTop: 8, marginBottom: 0, maxWidth: 820, lineHeight: 1.7 }}>
            This layer explains why the Sports MVP parlay workflow is more valuable than a simple same-game parlay generator.
            The engine is built to justify subscription value through disciplined combo construction.
          </p>

          <div style={styles.whyGrid}>
            <div style={{ ...styles.whyCard, border: "1px solid rgba(59,130,246,0.18)" }}>
              <div style={styles.overline}>Market Anchored Modeling</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 10 }}>Market Anchored Modeling</div>
              <div style={{ color: "#cbd5e1", lineHeight: 1.75, fontSize: 14 }}>
                Candidate legs begin with validated Sports MVP picks that have already been ranked against live market prices,
                helping the parlay engine start from higher-quality opportunities instead of raw slate noise.
              </div>
            </div>

            <div style={{ ...styles.whyCard, border: "1px solid rgba(16,185,129,0.18)" }}>
              <div style={styles.overline}>Probability Engine</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 10 }}>Probability Engine</div>
              <div style={{ color: "#cbd5e1", lineHeight: 1.75, fontSize: 14 }}>
                The engine compounds model win probability with sportsbook pricing to estimate expected value, identify stronger combo structures,
                and separate the safest builds from the highest upside opportunities.
              </div>
            </div>

            <div style={{ ...styles.whyCard, border: "1px solid rgba(245,158,11,0.18)" }}>
              <div style={styles.overline}>Bankroll Discipline</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 10 }}>Bankroll Discipline</div>
              <div style={{ color: "#cbd5e1", lineHeight: 1.75, fontSize: 14 }}>
                Kelly-based combo sizing, payout modeling, and structured EV review help users treat parlays as disciplined bankroll decisions
                instead of emotion-driven lottery tickets.
              </div>
            </div>
          </div>
        </section>

        <section style={{ ...styles.sectionPanel, marginBottom: 20 }}>
          <div style={styles.overline}>Subscriber Features</div>
          <h2 style={styles.h2}>What subscribers get</h2>
          <p style={{ color: "#94a3b8", marginTop: 8, marginBottom: 0, maxWidth: 860, lineHeight: 1.7 }}>
            This section translates the parlay lab into subscriber value. It explains why Sports MVP is more than a picks page
            and why the platform deserves subscription-level trust.
          </p>

          <div style={styles.subscriberGrid}>
            <div style={styles.subscriberCard}>
              <div style={styles.overline}>Core Intelligence</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 10 }}>Model + market tools</div>
              <div style={styles.subscriberList}>
                <div style={styles.subscriberItem}><span style={styles.subscriberDot} />Top Picks Intelligence</div>
                <div style={styles.subscriberItem}><span style={styles.subscriberDot} />CLV Tracking</div>
                <div style={styles.subscriberItem}><span style={styles.subscriberDot} />Market Edge Detection</div>
              </div>
            </div>

            <div style={styles.subscriberCard}>
              <div style={styles.overline}>Parlay Workflow</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 10 }}>Combo construction tools</div>
              <div style={styles.subscriberList}>
                <div style={styles.subscriberItem}><span style={styles.subscriberDot} />Parlay EV Engine</div>
                <div style={styles.subscriberItem}><span style={styles.subscriberDot} />Bankroll Sizing Tools</div>
                <div style={styles.subscriberItem}><span style={styles.subscriberDot} />Payout Modeling</div>
              </div>
            </div>

            <div style={styles.subscriberCard}>
              <div style={styles.overline}>Platform Access</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 10 }}>Broader subscriber suite</div>
              <div style={styles.subscriberList}>
                <div style={styles.subscriberItem}><span style={styles.subscriberDot} />Tournament Mode</div>
                <div style={styles.subscriberItem}><span style={styles.subscriberDot} />Performance Dashboard</div>
                <div style={styles.subscriberItem}><span style={styles.subscriberDot} />My Bets Tracking</div>
              </div>
            </div>
          </div>
        </section>

        <div style={styles.panelGrid}>
          <section style={styles.sectionPanel}>
            <div style={styles.overline}>Combo EV Heatmap</div>
            <h2 style={styles.h2}>Two-Leg Heatmap</h2>
            <p style={{ color: "#94a3b8", marginTop: 8, marginBottom: 0 }}>
              Quick visual of the best two-leg combinations from the current premium candidate pool.
            </p>

            {loading ? (
              <div style={styles.navyBox}>Loading heatmap...</div>
            ) : heatmapRows.length < 2 ? (
              <div style={styles.navyBox}>Not enough premium legs on this slate for a combo heatmap.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={styles.heatTable}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.heatCell, background: "transparent", color: "#94a3b8" }} />
                      {heatmapRows.map((leg) => (
                        <th key={leg.gameId} style={{ ...styles.heatCell, background: "rgba(15,23,42,0.85)", color: "#e5e7eb" }}>
                          {leg.teamLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapRows.map((row) => (
                      <tr key={row.gameId}>
                        <td style={{ ...styles.heatCell, background: "rgba(15,23,42,0.85)", color: "#e5e7eb" }}>
                          {row.teamLabel}
                        </td>
                        {heatmapRows.map((col) => {
                          const ev = row.gameId === col.gameId ? null : calcParlayMetrics([row, col])?.evForStake100 ?? null;
                          const bg =
                            ev == null
                              ? "rgba(15,23,42,0.55)"
                              : ev > 0
                              ? `rgba(16,185,129,${clamp(Math.abs(ev) / 60, 0.12, 0.45)})`
                              : `rgba(244,63,94,${clamp(Math.abs(ev) / 60, 0.10, 0.35)})`;
                          const color = ev == null ? "#475569" : ev > 0 ? "#d1fae5" : "#fecdd3";

                          return (
                            <td key={col.gameId} style={{ ...styles.heatCell, background: bg, color }}>
                              {row.gameId === col.gameId ? "—" : fmtEv(ev)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={styles.listCard}>
              <div style={styles.metricLabel}>Rejected Premium Combos</div>
              {selectedCombos.filter((c) => (num(c.evForStake100) || 0) <= 0).length === 0 ? (
                <div style={{ color: "#94a3b8", fontSize: 14 }}>No negative-EV two-leg combos in the current preview set.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {selectedCombos.filter((c) => (num(c.evForStake100) || 0) <= 0).slice(0, 4).map((combo) => (
                    <div key={combo.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#cbd5e1", fontSize: 14 }}>
                      <span>{combo.label}</span>
                      <span style={{ color: "#fda4af", fontWeight: 700 }}>{fmtEv(combo.evForStake100)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside style={{ display: "grid", gap: 20 }}>
            <section style={styles.sectionPanel}>
              <div style={styles.overline}>Payout Calculator</div>
              <h2 style={styles.h2}>Best Combo</h2>

              {!featuredCombo ? (
                <div style={styles.navyBox}>No premium combo available on this slate.</div>
              ) : (
                <>
                  <div style={styles.comboCard}>
                    <div style={{ fontWeight: 800, fontSize: 18, color: "#f8fafc" }}>{featuredCombo.label}</div>
                    <div style={styles.comboLegs}>
                      {featuredCombo.legs.map((leg) => (
                        <div key={leg.gameId} style={styles.comboLeg}>
                          <span>{leg.matchup}</span>
                          <span>{leg.pickLabel}</span>
                        </div>
                      ))}
                    </div>

                    <div style={styles.payoutGrid}>
                      <div style={styles.navyBox}>
                        <div style={styles.metricLabel}>Parlay Odds</div>
                        <div style={styles.metricValue}>{oddsText(featuredCombo.americanOdds)}</div>
                      </div>
                      <div style={styles.navyBox}>
                        <div style={styles.metricLabel}>Model Probability</div>
                        <div style={styles.metricValue}>{pctFromUnit(featuredCombo.modelProb, 1)}</div>
                      </div>
                      <div style={styles.navyBox}>
                        <div style={styles.metricLabel}>Expected Value</div>
                        <div style={{ ...styles.metricValue, color: "#93c5fd" }}>{fmtEv(featuredCombo.evForStake100)}</div>
                      </div>
                      <div style={styles.navyBox}>
                        <div style={styles.metricLabel}>Kelly Half</div>
                        <div style={{ ...styles.metricValue, color: "#fcd34d" }}>
                          {featuredCombo.kellyHalf == null ? "—" : pct(featuredCombo.kellyHalf * 100, 1)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={styles.navyBox}>
                    <div style={styles.metricLabel}>Projected Payout on ${stake}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Profit</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: "#86efac" }}>
                          ${projectedPayout ? Math.round(projectedPayout.profit) : "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Return</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc" }}>
                          ${projectedPayout ? Math.round(projectedPayout.totalReturn) : "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Kelly Stake</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: "#fcd34d" }}>
                          ${projectedPayout?.kellyStake == null ? "—" : Math.round(projectedPayout.kellyStake)}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>

            <section style={styles.sectionPanel}>
              <div style={styles.overline}>Candidate Legs</div>
              <h2 style={styles.h2}>Leg Probabilities</h2>

              {candidateLegs.length === 0 ? (
                <div style={styles.navyBox}>No candidate legs returned for this league/date.</div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {candidateLegs.slice(0, 6).map((leg) => (
                    <div key={leg.gameId} style={styles.navyBox}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, color: "#f8fafc" }}>{leg.matchup}</div>
                          <div style={{ fontSize: 13, color: "#94a3b8" }}>{leg.pickLabel}</div>
                        </div>
                        <div style={{ color: "#93c5fd", fontWeight: 800 }}>{pctFromUnit(leg.modelProb, 1)}</div>
                      </div>
                      <div style={styles.barTrack}>
                        <div
                          style={{
                            width: `${Math.max(0, Math.min(100, (Number(leg.modelProb) || 0) * 100))}%`,
                            height: "100%",
                            background: "linear-gradient(90deg, #2563eb 0%, #22c55e 100%)",
                            borderRadius: 999,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
