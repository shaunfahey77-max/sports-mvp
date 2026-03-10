import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import sportsMvpLogo from "../assets/sports-mvp-logo.png";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
  if (t === "ELITE") return { background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.28)", color: "#86efac" };
  if (t === "STRONG") return { background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.28)", color: "#93c5fd" };
  if (t === "EDGE") return { background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.28)", color: "#fcd34d" };
  return { background: "rgba(148,163,184,0.12)", border: "1px solid rgba(148,163,184,0.22)", color: "#cbd5e1" };
}

function leagueColor(league) {
  if (league === "NBA") return "#60a5fa";
  if (league === "NCAAM") return "#f59e0b";
  if (league === "NHL") return "#34d399";
  return "#cbd5e1";
}

function policyRows() {
  return [
    { league: "NBA", market: "Spreads only", note: "Premium validated market" },
    { league: "NCAAM", market: "Totals only", note: "Premium validated market" },
    { league: "NHL", market: "Spreads only", note: "Premium validated market" },
  ];
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
          fetch("http://127.0.0.1:3001/api/predictions?league=nba"),
          fetch("http://127.0.0.1:3001/api/predictions?league=ncaam"),
          fetch("http://127.0.0.1:3001/api/predictions?league=nhl"),
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
        ].sort((a, b) => (num(b?.bet?.evForStake100) || -9999) - (num(a?.bet?.evForStake100) || -9999));

        if (!cancelled) setPicks(all.slice(0, 8));
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
        const res = await fetch("http://127.0.0.1:3001/api/performance/kpis");
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

    return () => { cancelled = true; };
  }, []);

  const featured = picks[0] || null;

  const perfSummary = useMemo(() => {
    if (!performance?.data) return null;

    const p = performance.data;

    return {
      picks: p.picks || 0,
      wins: p.wins || 0,
      losses: p.losses || 0,
      scored: p.scored || 0,
      winRate: p.acc || null,
      avgClv: p.avg_clv_line ?? null,
      avgImpliedClv: p.avg_clv_implied ?? null,
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
      gridTemplateColumns: "1fr 1fr",
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
    logo: {
      width: "72px",
      height: "72px",
      objectFit: "contain",
      filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.35))",
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
    heroGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "14px", marginTop: "20px" },
    statCard: {
      background: "rgba(15,23,42,0.92)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: "18px",
      padding: "16px",
    },
    statLabel: {
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "0.12em",
      color: "#94a3b8",
      marginBottom: "8px",
      fontWeight: 700,
    },
    statValue: { fontSize: "30px", fontWeight: 800, color: "#f8fafc", lineHeight: 1 },
    featuredTitle: { margin: "0 0 12px", fontSize: "22px", fontWeight: 800, color: "#f8fafc" },
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
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
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
    pickMatchup: { fontSize: "20px", fontWeight: 800, color: "#f8fafc", marginTop: "4px" },
    pickLine: { color: "#cbd5e1", fontSize: "15px", marginTop: "6px", fontWeight: 600 },
    metricsRow: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "10px", marginBottom: "12px" },
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
    muted: { color: "#94a3b8", fontSize: "14px", lineHeight: 1.6 },
    empty: {
      background: "rgba(15,23,42,0.72)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: "18px",
      padding: "16px",
      color: "#94a3b8",
      fontSize: "14px",
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <section style={styles.hero}>
          <div style={{ ...styles.panel, ...styles.heroMain }}>
            <div style={styles.sectionTitle}>Premium Dashboard</div>

            <div style={styles.headline}>
              <img src={sportsMvpLogo} alt="Sports MVP alternate logo" style={styles.logo} />
              <div>
                <h1 style={styles.h1}>Sports MVP</h1>
                <p style={styles.subtitle}>
                  Premium betting intelligence powered by validated markets, live edge scoring,
                  confidence-ranked picks, and disciplined no-bet protection.
                </p>
              </div>
            </div>

            <div style={styles.heroGrid}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Today’s Picks</div>
                <div style={styles.statValue}>{picks.length}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>7-Day Wins</div>
                <div style={styles.statValue}>{perfLoading ? "—" : perfSummary.wins}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>7-Day Accuracy</div>
                <div style={styles.statValue}>
                  {perfLoading ? "—" : perfSummary.winRate == null ? "—" : `${Math.round(perfSummary.winRate * 100)}%`}
                </div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Avg CLV</div>
                <div style={styles.statValue}>
                  {perfLoading ? "—" : signedNum(perfSummary?.avgClv, 2)}
                </div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Imp CLV</div>
                <div style={styles.statValue}>
                  {perfLoading ? "—" : pctFromUnit(perfSummary?.avgImpliedClv, 2)}
                </div>
              </div>
            </div>
          </div>

          <div style={{ ...styles.panel, ...styles.heroMeta }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={styles.sectionTitle}>Pick of the Day</div>
            </div>

            {!featured ? (
              <div style={{ ...styles.empty, gridColumn: "1 / -1" }}>
                {loading ? "Loading featured pick..." : error || "No validated pick available."}
              </div>
            ) : (
              <div style={{ ...styles.featuredCard, gridColumn: "1 / -1" }}>
                <div style={styles.matchup}>
                  <div style={styles.teamSide}>
                    <img src={featured.awayLogo} alt={featured.awayAbbr} style={styles.teamLogo} />
                    <div style={styles.teamText}>{featured.awayAbbr}</div>
                  </div>
                  <div style={{ color: "#94a3b8", fontWeight: 700, fontSize: "13px", letterSpacing: "0.08em" }}>AT</div>
                  <div style={styles.teamSide}>
                    <div style={styles.teamText}>{featured.homeAbbr}</div>
                    <img src={featured.homeLogo} alt={featured.homeAbbr} style={styles.teamLogo} />
                  </div>
                </div>

                <h3 style={styles.featuredTitle}>{marketText(featured.bet)}</h3>

                <div style={{ ...styles.badge, ...tierColors(featured.bet?.tier) }}>
                  {featured.bet?.tier || "—"}
                </div>

                <div style={styles.featuredMetricGrid}>
                  <div style={styles.miniStat}>
                    <div style={styles.miniLabel}>Edge</div>
                    <div style={{ ...styles.miniValue, color: "#86efac" }}>
                      {featured.bet?.edge == null ? "—" : pct((Number(featured.bet.edge) || 0) * 100, 1)}
                    </div>
                  </div>
                  <div style={styles.miniStat}>
                    <div style={styles.miniLabel}>EV</div>
                    <div style={{ ...styles.miniValue, color: "#93c5fd" }}>{fmtEv(featured.bet?.evForStake100)}</div>
                  </div>
                  <div style={styles.miniStat}>
                    <div style={styles.miniLabel}>Kelly</div>
                    <div style={{ ...styles.miniValue, color: "#fcd34d" }}>
                      {featured.bet?.kellyHalf == null ? "—" : pct((Number(featured.bet.kellyHalf) || 0) * 100, 1)}
                    </div>
                  </div>
                </div>

                <div style={styles.confidenceWrap}>
                  <div style={styles.confidenceLabelRow}>
                    <span>Confidence</span>
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
              </div>
            )}
          </div>
        </section>

        <div style={styles.bodyGrid}>
          <section style={{ ...styles.panel, ...styles.sectionPanel }}>
            <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: "16px", marginBottom: "18px" }}>
              <div>
                <div style={styles.sectionTitle}>Validated Picks Board</div>
                <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 800, color: "#f8fafc" }}>Top Validated Picks</h2>
                <p style={{ ...styles.muted, marginTop: "8px", maxWidth: "640px" }}>
                  Highest-value premium opportunities across active markets. Every pick includes edge, EV,
                  Kelly sizing, and confidence.
                </p>
              </div>
              <Link to="/predict" style={{ ...styles.navBtn, background: "#2563eb", border: "1px solid rgba(59,130,246,0.36)" }}>
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
                {picks.map((row) => (
                  <article key={`${row.league}-${row.gameId}`} style={styles.pickCard}>
                    <div style={styles.pickTop}>
                      <div>
                        <div style={{ ...styles.pickLeague, color: leagueColor(row.league) }}>{row.league}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                          {row.awayLogo && (
                            <img src={row.awayLogo} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />
                          )}
                          <div style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc" }}>{row.matchup}</div>
                          {row.homeLogo && (
                            <img src={row.homeLogo} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />
                          )}
                        </div>
                        <div style={styles.pickLine}>
                          {marketText(row.bet)} • Odds {oddsText(row.bet?.odds)} {row.bet?.line != null ? `• Line ${row.bet.line}` : ""}
                        </div>
                      </div>

                      <span style={{ ...styles.badge, ...tierColors(row.bet?.tier) }}>
                        {row.bet?.tier || "—"}
                      </span>
                    </div>

                    <div style={styles.metricsRow}>
                      <div style={styles.miniStat}>
                        <div style={styles.miniLabel}>Edge</div>
                        <div style={{ ...styles.miniValue, color: "#86efac" }}>
                          {row.bet?.edge == null ? "—" : pct((Number(row.bet.edge) || 0) * 100, 1)}
                        </div>
                      </div>
                      <div style={styles.miniStat}>
                        <div style={styles.miniLabel}>EV</div>
                        <div style={{ ...styles.miniValue, color: "#93c5fd" }}>{fmtEv(row.bet?.evForStake100)}</div>
                      </div>
                      <div style={styles.miniStat}>
                        <div style={styles.miniLabel}>Kelly</div>
                        <div style={{ ...styles.miniValue, color: "#fcd34d" }}>
                          {row.bet?.kellyHalf == null ? "—" : pct((Number(row.bet.kellyHalf) || 0) * 100, 1)}
                        </div>
                      </div>
                    </div>

                    <div style={styles.confidenceWrap}>
                      <div style={styles.confidenceLabelRow}>
                        <span>Confidence</span>
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
                ))}
              </div>
            )}
          </section>

          <aside style={styles.rightColStack}>
            <section style={{ ...styles.panel, ...styles.sectionPanel }}>
              <div style={styles.sectionTitle}>Active Market Policy</div>
              <h2 style={{ margin: "0 0 14px", fontSize: "28px", fontWeight: 800, color: "#f8fafc" }}>Market Policy</h2>
              <div style={{ display: "grid", gap: "12px" }}>
                {policyRows().map((row) => (
                  <div key={row.league} style={styles.policyCard}>
                    <div style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase", color: leagueColor(row.league) }}>
                      {row.league}
                    </div>
                    <div style={{ marginTop: "6px", fontSize: "18px", fontWeight: 700, color: "#f8fafc" }}>{row.market}</div>
                    <div style={{ marginTop: "4px", fontSize: "13px", color: "#94a3b8" }}>{row.note}</div>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ ...styles.panel, ...styles.sectionPanel }}>
              <div style={styles.sectionTitle}>Recent Scoring</div>
              <h2 style={{ margin: "0 0 14px", fontSize: "28px", fontWeight: 800, color: "#f8fafc" }}>Recent Performance</h2>

              {perfLoading ? (
                <div style={styles.empty}>Loading recent performance...</div>
              ) : perfError ? (
                <div style={{ ...styles.empty, color: "#fda4af" }}>{perfError}</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
                  <div style={styles.policyCard}>
                    <div style={styles.miniLabel}>Total Picks</div>
                    <div style={styles.statValue}>{perfSummary.picks}</div>
                  </div>
                  <div style={styles.policyCard}>
                    <div style={styles.miniLabel}>Scored</div>
                    <div style={styles.statValue}>{perfSummary.scored}</div>
                  </div>
                  <div style={styles.policyCard}>
                    <div style={styles.miniLabel}>Wins</div>
                    <div style={{ ...styles.statValue, color: "#86efac" }}>{perfSummary.wins}</div>
                  </div>
                  <div style={styles.policyCard}>
                    <div style={styles.miniLabel}>Losses</div>
                    <div style={{ ...styles.statValue, color: "#fda4af" }}>{perfSummary.losses}</div>
                  </div>
                </div>
              )}
            </section>

            <section style={{ ...styles.panel, ...styles.sectionPanel }}>
              <div style={styles.sectionTitle}>Application Hub</div>
              <h2 style={{ margin: "0 0 14px", fontSize: "28px", fontWeight: 800, color: "#f8fafc" }}>Navigate</h2>
              <div style={styles.navGrid}>
                <Link to="/predict" style={{ ...styles.navBtn, background: "#2563eb", border: "1px solid rgba(59,130,246,0.36)" }}>All Picks</Link>
                <Link to="/predict-nba" style={styles.navBtn}>NBA</Link>
                <Link to="/ncaab-predictions" style={styles.navBtn}>NCAAM</Link>
                <Link to="/predict-nhl" style={styles.navBtn}>NHL</Link>
                <Link to="/parlays" style={styles.navBtn}>Parlays</Link>
<Link to="/performance" style={styles.navBtn}>Performance</Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
