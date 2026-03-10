import { useEffect, useMemo, useState } from "react";

const API_BASE = "http://127.0.0.1:3001";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function leagueMeta(key) {
  const k = String(key || "").toLowerCase();
  if (k === "nba") return { icon: "🏀", label: "NBA" };
  if (k === "nhl") return { icon: "🏒", label: "NHL" };
  if (k === "ncaam") return { icon: "🎓", label: "NCAAM" };
  return { icon: "📊", label: String(key || "Unknown").toUpperCase() };
}

export default function Performance() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kpis, setKpis] = useState(null);
  const [leagueRows, setLeagueRows] = useState([]);
  const [recentRows, setRecentRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [kpisRes, leagueRes, recentRes] = await Promise.all([
          fetch(`${API_BASE}/api/performance/kpis`),
          fetch(`${API_BASE}/api/performance/league`),
          fetch(`${API_BASE}/api/performance/recent`),
        ]);

        const [kpisJson, leagueJson, recentJson] = await Promise.all([
          kpisRes.json(),
          leagueRes.json(),
          recentRes.json(),
        ]);

        if (!kpisRes.ok || kpisJson?.ok === false) {
          throw new Error(kpisJson?.error || "Failed to load performance KPIs.");
        }
        if (!leagueRes.ok || leagueJson?.ok === false) {
          throw new Error(leagueJson?.error || "Failed to load league performance.");
        }
        if (!recentRes.ok || recentJson?.ok === false) {
          throw new Error(recentJson?.error || "Failed to load recent performance.");
        }

        if (!cancelled) {
          setKpis(kpisJson?.data || null);
          setLeagueRows(Array.isArray(leagueJson?.data) ? leagueJson.data : []);
          setRecentRows(Array.isArray(recentJson?.data) ? recentJson.data : []);
        }
      } catch (e) {
        if (!cancelled) setError(String(e?.message || "Failed to load performance."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const bestLeague = useMemo(() => {
    const eligible = [...leagueRows].filter((r) => typeof num(r?.acc) === "number" && (num(r?.picks) || 0) > 0);
    if (!eligible.length) return "—";
    eligible.sort((a, b) => (num(b?.acc) - num(a?.acc)) || ((num(b?.picks) || 0) - (num(a?.picks) || 0)));
    const best = eligible[0];
    const meta = leagueMeta(best?.league);
    return `${meta.icon} ${meta.label}`;
  }, [leagueRows]);

  const styles = {
    page: {
      minHeight: "100vh",
      background:
        "radial-gradient(circle at top left, rgba(30,111,219,0.20), transparent 26%), radial-gradient(circle at top right, rgba(139,92,246,0.16), transparent 24%), linear-gradient(180deg, #071224 0%, #040b18 100%)",
      color: "#e5e7eb",
      padding: "28px 20px 40px",
    },
    shell: {
      maxWidth: "1280px",
      margin: "0 auto",
    },
    card: {
      background: "rgba(9,15,28,0.84)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: "24px",
      boxShadow: "0 18px 46px rgba(0,0,0,0.22)",
      padding: 22,
    },
    hero: {
      display: "grid",
      gridTemplateColumns: "220px 1fr 280px",
      gap: 22,
      alignItems: "center",
    },
    heroLogoWrap: {
      width: 220,
      height: 220,
      borderRadius: 28,
      background: "linear-gradient(135deg, rgba(30,111,219,0.16), rgba(242,183,5,0.14))",
      border: "1px solid rgba(148,163,184,0.18)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
    },
    heroLogo: {
      width: "88%",
      height: "88%",
      objectFit: "contain",
      display: "block",
    },
    eyebrow: {
      fontSize: 12,
      color: "#93c5fd",
      textTransform: "uppercase",
      letterSpacing: "0.16em",
      fontWeight: 800,
      marginBottom: 10,
    },
    heroTitle: {
      margin: 0,
      fontSize: 46,
      fontWeight: 900,
      lineHeight: 1.02,
      color: "#f8fafc",
    },
    heroText: {
      color: "#a5b4c7",
      marginTop: 10,
      fontSize: 16,
      lineHeight: 1.6,
      maxWidth: 760,
    },
    heroSide: {
      background: "rgba(15,23,42,0.88)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: 20,
      padding: 18,
    },
    heroSideLabel: {
      fontSize: 11,
      color: "#94a3b8",
      textTransform: "uppercase",
      fontWeight: 800,
      letterSpacing: "0.12em",
      marginBottom: 10,
    },
    heroSideValue: {
      fontSize: 26,
      fontWeight: 900,
      color: "#f8fafc",
      marginBottom: 8,
    },
    heroSideSub: {
      color: "#94a3b8",
      fontSize: 14,
      lineHeight: 1.5,
    },
    statsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
      gap: 14,
    },
    statTile: {
      background: "rgba(15,23,42,0.9)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: 18,
      padding: 16,
    },
    statLabel: {
      fontSize: 11,
      color: "#94a3b8",
      textTransform: "uppercase",
      fontWeight: 800,
      letterSpacing: "0.08em",
      marginBottom: 8,
    },
    statValue: {
      fontSize: 32,
      fontWeight: 900,
      color: "#f8fafc",
    },
    sectionTitle: {
      fontSize: 24,
      fontWeight: 900,
      color: "#f8fafc",
      margin: 0,
    },
    sectionSub: {
      color: "#94a3b8",
      marginTop: 6,
    },
    grid3: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: 14,
    },
    leagueTile: {
      background: "rgba(15,23,42,0.9)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: 18,
      padding: 18,
    },
    leagueTitle: {
      fontSize: 22,
      fontWeight: 900,
      color: "#f8fafc",
      marginBottom: 12,
    },
    leagueMetric: {
      fontSize: 28,
      fontWeight: 900,
      color: "#ffffff",
      marginBottom: 12,
    },
    leagueSub: {
      color: "#cbd5e1",
      marginBottom: 8,
      fontWeight: 600,
    },
    timeline: {
      display: "grid",
      gap: 12,
    },
    timelineRow: {
      display: "grid",
      gridTemplateColumns: "160px 120px repeat(7, 90px)",
      gap: 12,
      background: "rgba(15,23,42,0.9)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: 16,
      padding: 14,
      alignItems: "center",
    },
    chip: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "6px 10px",
      fontWeight: 800,
      fontSize: 12,
      background: "rgba(30,111,219,0.16)",
      color: "#bfdbfe",
      border: "1px solid rgba(59,130,246,0.24)",
    },
    marketGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: 14,
    },
    marketTile: {
      background: "rgba(15,23,42,0.9)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: 18,
      padding: 18,
    },
  };

  const marketSummary = useMemo(() => {
    const bucket = new Map();

    for (const row of recentRows) {
      const lg = String(row?.league || "").toLowerCase();
      if (!lg) continue;
      if (!bucket.has(lg)) {
        bucket.set(lg, { league: lg, picks: 0, wins: 0, losses: 0, pass: 0, acc: null });
      }
      const cur = bucket.get(lg);
      cur.picks += num(row?.picks) || 0;
      cur.wins += num(row?.wins) || 0;
      cur.losses += num(row?.losses) || 0;
      cur.pass += num(row?.pass) || 0;
    }

    return [...bucket.values()].map((x) => {
      const scored = x.wins + x.losses;
      return {
        ...x,
        acc: scored > 0 ? x.wins / scored : null,
        ...leagueMeta(x.league),
      };
    });
  }, [recentRows]);

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <section style={{ ...styles.card, marginBottom: 20 }}>
          <div style={styles.hero}>
            <div style={styles.heroLogoWrap}>
              <img
                src="/assets/sports-mvp-hero.png"
                alt="Sports MVP Alternate Logo"
                style={styles.heroLogo}
              />
            </div>

            <div>
              <div style={styles.eyebrow}>Premium Performance Center</div>
              <h1 style={styles.heroTitle}>Performance Dashboard</h1>
              <div style={styles.heroText}>
                This is the section that proves or disproves the model. Clean scoring,
                trusted aggregates, and premium league-level visibility built from the same
                backend source powering the rest of Sports MVP.
              </div>
            </div>

            <div style={styles.heroSide}>
              <div style={styles.heroSideLabel}>🔥 Best League</div>
              <div style={styles.heroSideValue}>{bestLeague}</div>
              <div style={styles.heroSideSub}>
                14-day validated window. Same trusted summary layer as the homepage.
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <section style={styles.card}>Loading performance…</section>
        ) : error ? (
          <section style={{ ...styles.card, color: "#fda4af" }}>{error}</section>
        ) : (
          <>
            <section style={{ ...styles.card, marginBottom: 20 }}>
              <div style={styles.statsGrid}>
                <div style={styles.statTile}>
                  <div style={styles.statLabel}>📊 Total Picks</div>
                  <div style={styles.statValue}>{kpis?.picks ?? 0}</div>
                </div>
                <div style={styles.statTile}>
                  <div style={styles.statLabel}>✅ Wins</div>
                  <div style={{ ...styles.statValue, color: "#86efac" }}>{kpis?.wins ?? 0}</div>
                </div>
                <div style={styles.statTile}>
                  <div style={styles.statLabel}>❌ Losses</div>
                  <div style={{ ...styles.statValue, color: "#fda4af" }}>{kpis?.losses ?? 0}</div>
                </div>
                <div style={styles.statTile}>
                  <div style={styles.statLabel}>⏭️ Passes</div>
                  <div style={styles.statValue}>{kpis?.pass ?? 0}</div>
                </div>
                <div style={styles.statTile}>
                  <div style={styles.statLabel}>🎯 Accuracy</div>
                  <div style={styles.statValue}>{pctFromUnit(kpis?.acc)}</div>
                </div>
                <div style={styles.statTile}>
                  <div style={styles.statLabel}>📈 Avg CLV</div>
                  <div style={styles.statValue}>{signedNum(kpis?.avg_clv_line, 2)}</div>
                </div>
                <div style={styles.statTile}>
                  <div style={styles.statLabel}>🧠 Avg Implied CLV</div>
                  <div style={styles.statValue}>{pctFromUnit(kpis?.avg_clv_implied, 2)}</div>
                </div>
              </div>
            </section>

            <section style={{ ...styles.card, marginBottom: 20 }}>
              <h2 style={styles.sectionTitle}>League Snapshot</h2>
              <div style={styles.sectionSub}>A cleaner look at where the model is performing best.</div>

              <div style={{ ...styles.grid3, marginTop: 16 }}>
                {leagueRows.map((card) => {
                  const meta = leagueMeta(card?.league);
                  return (
                    <div key={card.league} style={styles.leagueTile}>
                      <div style={styles.leagueTitle}>{meta.icon} {meta.label}</div>
                      <div style={styles.leagueMetric}>{pctFromUnit(card?.acc)}</div>
                      <div style={styles.leagueSub}>📊 Picks: {card?.picks ?? 0}</div>
                      <div style={styles.leagueSub}>✅ Wins: {card?.wins ?? 0}</div>
                      <div style={styles.leagueSub}>❌ Losses: {card?.losses ?? 0}</div>
                      <div style={styles.leagueSub}>⏭️ Passes: {card?.pass ?? 0}</div>
                      <div style={styles.leagueSub}>📈 Avg CLV: {signedNum(card?.avg_clv_line, 2)}</div>
                      <div style={styles.leagueSub}>🧠 Avg Implied CLV: {pctFromUnit(card?.avg_clv_implied, 2)}</div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section style={{ ...styles.card, marginBottom: 20 }}>
              <h2 style={styles.sectionTitle}>League Performance Mix</h2>
              <div style={styles.sectionSub}>Quick visual scan of the current validated window.</div>

              <div style={{ ...styles.marketGrid, marginTop: 16 }}>
                {marketSummary.map((m) => (
                  <div key={m.league} style={styles.marketTile}>
                    <div style={styles.leagueTitle}>{m.icon} {m.label}</div>
                    <div style={styles.leagueSub}>📊 Picks: {m.picks}</div>
                    <div style={styles.leagueSub}>✅ Wins: {m.wins}</div>
                    <div style={styles.leagueSub}>❌ Losses: {m.losses}</div>
                    <div style={styles.leagueSub}>🎯 Accuracy: {pctFromUnit(m.acc)}</div>
                  </div>
                ))}
              </div>
            </section>

            <section style={styles.card}>
              <h2 style={styles.sectionTitle}>Recent Scoring Timeline</h2>
              <div style={styles.sectionSub}>Most recent validated daily rows across all tracked leagues.</div>

              <div style={{ ...styles.timeline, marginTop: 16 }}>
                {recentRows.map((r, i) => {
                  const meta = leagueMeta(r?.league);
                  return (
                    <div key={`${r?.league}-${r?.date}-${i}`} style={styles.timelineRow}>
                      <div style={{ fontWeight: 900, color: "#f8fafc" }}>{r?.date || "—"}</div>
                      <div><span style={styles.chip}>{meta.icon} {meta.label}</span></div>
                      <div><div style={styles.statLabel}>Picks</div><div>{r?.picks ?? 0}</div></div>
                      <div><div style={styles.statLabel}>Wins</div><div style={{ color: "#86efac" }}>{r?.wins ?? 0}</div></div>
                      <div><div style={styles.statLabel}>Losses</div><div style={{ color: "#fda4af" }}>{r?.losses ?? 0}</div></div>
                      <div><div style={styles.statLabel}>Pass</div><div>{r?.pass ?? 0}</div></div>
                      <div><div style={styles.statLabel}>Acc</div><div>{pctFromUnit(r?.acc)}</div></div>
                      <div><div style={styles.statLabel}>CLV</div><div>{signedNum(r?.avg_clv_line, 2)}</div></div>
                      <div><div style={styles.statLabel}>Imp CLV</div><div>{pctFromUnit(r?.avg_clv_implied, 2)}</div></div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
