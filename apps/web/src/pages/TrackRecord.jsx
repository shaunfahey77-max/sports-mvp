import { useEffect, useState } from "react";

  const API_BASE = import.meta.env.VITE_API_BASE || "";

  const LEAGUE_META = {
    nba: { icon: "🏀", label: "NBA", market: "Moneyline" },
    nhl: { icon: "🏒", label: "NHL", market: "Moneyline" },
    ncaam: { icon: "🎓", label: "NCAAM", market: "Game Totals" },
  };

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function roi(v) {
    const n = num(v);
    if (n == null) return "—";
    const pct = (n * 100).toFixed(1);
    return n >= 0 ? `+${pct}%` : `${pct}%`;
  }

  function roiColor(v) {
    const n = num(v);
    if (n == null) return "#94a3b8";
    return n > 0 ? "#4ade80" : n < 0 ? "#f87171" : "#94a3b8";
  }

  function winRate(v) {
    const n = num(v);
    if (n == null) return "—";
    return `${(n * 100).toFixed(1)}%`;
  }

  function formatDate(v) {
    if (!v) return "";
    const [y, m, d] = v.split("-");
    return new Date(Date.UTC(+y, +m - 1, +d)).toLocaleDateString("en-US", {
      month: "short", day: "numeric", timeZone: "UTC",
    });
  }

  const CARD_STYLE = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "12px",
    padding: "24px",
  };

  export default function TrackRecord() {
    const [loading, setLoading] = useState(true);
    const [kpis, setKpis] = useState(null);
    const [recent, setRecent] = useState([]);
    const [error, setError] = useState("");

    useEffect(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        setError("");
        try {
          const [kpiRes, recentRes] = await Promise.all([
            fetch(`${API_BASE}/api/performance/kpis?leagues=nba,nhl,ncaam&days=90`),
            fetch(`${API_BASE}/api/performance/recent?leagues=nba,nhl,ncaam&days=30&limit=60`),
          ]);
          const [kpiJson, recentJson] = await Promise.all([kpiRes.json(), recentRes.json()]);
          if (!cancelled) {
            setKpis(kpiJson);
            setRecent(recentJson.rows || recentJson.recent || recentJson.data || []);
          }
        } catch (e) {
          if (!cancelled) setError("Unable to load performance data.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, []);

    const overall = kpis
      ? {
          roi: num(kpis.roi),
          wins: num(kpis.wins) ?? 0,
          losses: num(kpis.losses) ?? 0,
          acc: num(kpis.acc ?? kpis.accuracy),
          stake: num(kpis.roi_stake ?? kpis.scored_picks ?? kpis.scoredPicks),
          units: num(kpis.roi_units),
        }
      : null;

    const byLeague = kpis?.by_league_roi || kpis?.byLeagueRoi || {};

    // Group recent rows by date for the log
    const dateMap = new Map();
    for (const row of recent) {
      const d = row.date;
      if (!dateMap.has(d)) dateMap.set(d, []);
      dateMap.get(d).push(row);
    }
    const dates = Array.from(dateMap.keys()).sort((a, b) => b.localeCompare(a)).slice(0, 14);

    return (
      <div style={{ minHeight: "100vh", background: "#0a0f1a", color: "#f1f5f9", fontFamily: "system-ui, sans-serif" }}>
        {/* Header */}
        <div style={{ background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-0.5px" }}>SportEdge</span>
            <span style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)", borderRadius: "6px", padding: "2px 8px", fontSize: "11px", fontWeight: 600 }}>LIVE TRACK RECORD</span>
          </div>
          <a
            href="/login"
            style={{ background: "#4ade80", color: "#0a0f1a", borderRadius: "8px", padding: "8px 20px", fontWeight: 700, fontSize: "14px", textDecoration: "none" }}
          >
            Start Free Trial →
          </a>
        </div>

        <div style={{ maxWidth: "1040px", margin: "0 auto", padding: "40px 24px" }}>
          {/* Hero */}
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h1 style={{ fontSize: "clamp(28px,5vw,48px)", fontWeight: 800, margin: "0 0 12px", letterSpacing: "-1px" }}>
              Every pick. Every result. <span style={{ color: "#4ade80" }}>No cherry-picking.</span>
            </h1>
            <p style={{ color: "#94a3b8", fontSize: "16px", margin: "0 0 8px" }}>
              90-day audited performance across NBA, NHL, and NCAAM.
            </p>
            <p style={{ color: "#64748b", fontSize: "13px", margin: 0 }}>
              Results calculated from opening odds at time of pick publication.
            </p>
          </div>

          {/* Top KPI bar */}
          {loading ? (
            <div style={{ textAlign: "center", color: "#64748b", padding: "60px 0" }}>Loading performance data…</div>
          ) : error ? (
            <div style={{ textAlign: "center", color: "#f87171", padding: "40px 0" }}>{error}</div>
          ) : overall && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "32px" }}>
                {[
                  { label: "90-Day ROI", value: roi(overall.roi), color: roiColor(overall.roi), sub: "flat $100/bet" },
                  { label: "Win Rate", value: winRate(overall.acc), color: "#f1f5f9", sub: "all graded bets" },
                  { label: "Record", value: `${overall.wins}-${overall.losses}`, color: "#f1f5f9", sub: "W-L (90 days)" },
                  { label: "Graded Bets", value: overall.stake != null ? overall.stake.toLocaleString() : "—", color: "#f1f5f9", sub: "settled picks" },
                  { label: "Units Profit", value: overall.units != null ? `${overall.units > 0 ? "+" : ""}${overall.units.toFixed(1)}u` : "—", color: roiColor(overall.roi), sub: "1u = 1 bet" },
                ].map(({ label, value, color, sub }) => (
                  <div key={label} style={{ ...CARD_STYLE, textAlign: "center" }}>
                    <div style={{ fontSize: "28px", fontWeight: 800, color, letterSpacing: "-0.5px", lineHeight: 1.1 }}>{value}</div>
                    <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: "13px", marginTop: "6px" }}>{label}</div>
                    <div style={{ color: "#64748b", fontSize: "12px", marginTop: "2px" }}>{sub}</div>
                  </div>
                ))}
              </div>

              {/* By-league cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px", marginBottom: "40px" }}>
                {["nba", "nhl", "ncaam"].map((lg) => {
                  const meta = LEAGUE_META[lg] || { icon: "📊", label: lg.toUpperCase(), market: "" };
                  const d = byLeague[lg];
                  if (!d) return null;
                  return (
                    <div key={lg} style={{ ...CARD_STYLE, position: "relative" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                        <span style={{ fontSize: "28px" }}>{meta.icon}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "16px" }}>{meta.label}</div>
                          <div style={{ color: "#64748b", fontSize: "12px" }}>{meta.market}</div>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                        {[
                          { label: "ROI", value: roi(d.roi), color: roiColor(d.roi) },
                          { label: "Record", value: `${d.wins ?? 0}-${d.losses ?? 0}`, color: "#f1f5f9" },
                          { label: "Bets", value: d.stake?.toLocaleString() ?? "—", color: "#f1f5f9" },
                          { label: "Avg Odds", value: d.avg_odds != null ? (d.avg_odds > 0 ? `+${d.avg_odds}` : `${d.avg_odds}`) : "—", color: "#94a3b8" },
                        ].map(({ label, value, color }) => (
                          <div key={label}>
                            <div style={{ color, fontWeight: 700, fontSize: "18px" }}>{value}</div>
                            <div style={{ color: "#64748b", fontSize: "12px" }}>{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Daily log */}
              {dates.length > 0 && (
                <div style={{ marginBottom: "40px" }}>
                  <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px", color: "#f1f5f9" }}>
                    Daily Results Log
                    <span style={{ color: "#64748b", fontWeight: 400, fontSize: "13px", marginLeft: "10px" }}>last 14 days</span>
                  </h2>
                  <div style={{ ...CARD_STYLE, padding: "0", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
                          {["Date", "League", "W", "L", "Win%", "ROI"].map(h => (
                            <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dates.flatMap(date =>
                          (dateMap.get(date) || []).map((row, i) => {
                            const accN = num(row.acc ?? row.win_rate);
                            const roiN = num(row.roi);
                            const lgMeta = LEAGUE_META[row.league?.toLowerCase()] || { icon: "📊", label: (row.league || "").toUpperCase() };
                            return (
                              <tr key={date + row.league} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                                <td style={{ padding: "10px 16px", color: "#94a3b8" }}>{i === 0 ? formatDate(date) : ""}</td>
                                <td style={{ padding: "10px 16px" }}>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                    <span>{lgMeta.icon}</span>
                                    <span style={{ fontWeight: 600 }}>{lgMeta.label}</span>
                                  </span>
                                </td>
                                <td style={{ padding: "10px 16px", color: "#4ade80", fontWeight: 600 }}>{num(row.wins) ?? "—"}</td>
                                <td style={{ padding: "10px 16px", color: "#f87171" }}>{num(row.losses) ?? "—"}</td>
                                <td style={{ padding: "10px 16px" }}>{accN != null ? `${(accN * 100).toFixed(0)}%` : "—"}</td>
                                <td style={{ padding: "10px 16px", fontWeight: 700, color: roiColor(roiN) }}>
                                  {roiN != null ? roi(roiN) : "—"}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* CTA */}
              <div style={{ ...CARD_STYLE, background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)", textAlign: "center", padding: "40px 24px" }}>
                <div style={{ fontSize: "24px", fontWeight: 800, marginBottom: "8px" }}>
                  Get today's picks — <span style={{ color: "#4ade80" }}>$19.99/month</span>
                </div>
                <p style={{ color: "#94a3b8", marginBottom: "24px", fontSize: "15px" }}>
                  NBA, NHL, and NCAAM picks delivered every morning. Cancel anytime.
                </p>
                <a
                  href="/login"
                  style={{ display: "inline-block", background: "#4ade80", color: "#0a0f1a", borderRadius: "10px", padding: "14px 36px", fontWeight: 800, fontSize: "16px", textDecoration: "none" }}
                >
                  Start Your Free Trial →
                </a>
                <div style={{ color: "#64748b", fontSize: "12px", marginTop: "12px" }}>No credit card required to start</div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "24px", textAlign: "center", color: "#475569", fontSize: "12px" }}>
          Past performance does not guarantee future results. Sports betting involves risk. Please gamble responsibly.
        </div>
      </div>
    );
  }
  