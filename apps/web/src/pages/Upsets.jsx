// apps/web/src/pages/Upsets.jsx
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function pct(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

function num(n, digits = 0) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const m = Math.pow(10, digits);
  return String(Math.round(n * m) / m);
}

export default function Upsets() {
  const [league, setLeague] = useState("nba");
  const [date, setDate] = useState(todayYMD());
  const [windowDays, setWindowDays] = useState(5);
  const [minGap, setMinGap] = useState(15);
  const [limit, setLimit] = useState(12);
  const [sortKey, setSortKey] = useState("score"); // score | winProb | baseGap
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState(null);

  async function load() {
    setLoading(true);
    setErr("");

    try {
      const qs = new URLSearchParams({
        league,
        date,
        window: String(windowDays),
        minGap: String(minGap),
        limit: String(limit),
      });

      const res = await fetch(`/api/upsets?${qs.toString()}`);
      const json = await res.json();

      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }

      setPayload(json);
    } catch (e) {
      setPayload(null);
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, date, windowDays, minGap, limit]);

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  const sortedRows = useMemo(() => {
    const r = [...rows];
    const get = (row) => {
      if (sortKey === "winProb") return row?.pick?.winProb ?? 0;
      if (sortKey === "baseGap") return row?.signals?.baseGap ?? -9999;
      return row?.signals?.score ?? 0;
    };
    r.sort((a, b) => get(b) - get(a));
    return r;
  }, [rows, sortKey]);

  const meta = payload?.meta || {};

  const emptyReason = useMemo(() => {
    if (loading) return "";
    if (err) return "";
    if (!payload) return "";
    if ((meta?.trainedGames ?? 0) === 0) return "No model history available for that date/window.";
    // if rows is empty, it’s either “no games” or “no candidates”
    return "No upset candidates matched your filters for this slate.";
  }, [loading, err, payload, meta]);

  return (
    <div className="homeFull">
      <div className="container">
        <div className="panel" style={{ marginTop: 10 }}>
          <div className="panelHead">
            <div>
              <div style={{ fontWeight: 900 }}>Upset Watch</div>
              <div className="muted" style={{ marginTop: 6 }}>
                Underdog candidates with real win equity (based on today’s model slate).
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <span className="pill">Model: {meta?.sourceModel || "elo+rest"}</span>
                <span className="pill">Window: {windowDays}d</span>
                <span className="pill">Min gap: {minGap} Elo</span>
                <span className="pill">Limit: {limit}</span>
                {typeof meta?.trainedGames === "number" ? (
                  <span className="pill">Trained: {meta.trainedGames} games</span>
                ) : null}
              </div>
            </div>

            <div className="controls">
              <Link className="btnGhost" to="/">
                Home
              </Link>

              <button
                className={league === "nba" ? "btnPrimary" : "btnGhost"}
                onClick={() => setLeague("nba")}
              >
                NBA
              </button>
              <button
                className={league === "nhl" ? "btnPrimary" : "btnGhost"}
                onClick={() => setLeague("nhl")}
              >
                NHL
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="row" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Date</div>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input"
                />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Window</div>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={windowDays}
                  onChange={(e) => setWindowDays(Number(e.target.value || 5))}
                  className="input"
                  style={{ width: 90 }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Min gap</div>
                <input
                  type="number"
                  min={0}
                  max={250}
                  value={minGap}
                  onChange={(e) => setMinGap(Number(e.target.value || 0))}
                  className="input"
                  style={{ width: 90 }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Limit</div>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value || 12))}
                  className="input"
                  style={{ width: 90 }}
                />
              </div>

              <div style={{ flex: 1 }} />

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Sort</div>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  className="input"
                >
                  <option value="score">Edge score</option>
                  <option value="winProb">Win prob</option>
                  <option value="baseGap">Elo gap</option>
                </select>
              </div>

              <button className="btnGhost" onClick={load} disabled={loading}>
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="list" style={{ marginTop: 14 }}>
            <div className="card">
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Today’s Candidates</div>

              {err ? (
                <div className="kicker">
                  <span style={{ fontWeight: 800 }}>Error:</span> {err}
                </div>
              ) : loading ? (
                <div className="kicker">Loading upsets…</div>
              ) : sortedRows.length === 0 ? (
                <div className="kicker">{emptyReason}</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr className="muted" style={{ textAlign: "left" }}>
                        <th style={{ padding: "10px 8px" }}>Matchup</th>
                        <th style={{ padding: "10px 8px" }}>Pick</th>
                        <th style={{ padding: "10px 8px" }}>Win%</th>
                        <th style={{ padding: "10px 8px" }}>Elo gap</th>
                        <th style={{ padding: "10px 8px" }}>Why</th>
                        <th style={{ padding: "10px 8px" }}>Rest</th>
                        <th style={{ padding: "10px 8px" }}>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((r) => {
                        const home = r?.home?.abbr || "HOME";
                        const away = r?.away?.abbr || "AWAY";
                        const pickName = r?.pick?.winnerName || "—";

                        const winProb = r?.pick?.winProb;
                        const baseGap = r?.signals?.baseGap;
                        const score = r?.signals?.score;

                        const restH = r?.signals?.rest?.home;
                        const restA = r?.signals?.rest?.away;

                        const restText =
                          restH && restA
                            ? `H:${restH.restDays ?? "—"}d / A:${restA.restDays ?? "—"}d`
                            : "—";

                        const why = Array.isArray(r?.why) ? r.why.join(" • ") : "—";

                        return (
                          <tr key={r?.gameId} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                            <td style={{ padding: "10px 8px", fontWeight: 800 }}>
                              {away} @ {home}
                            </td>
                            <td style={{ padding: "10px 8px" }}>
                              <span className="pill">{pickName}</span>
                            </td>
                            <td style={{ padding: "10px 8px" }}>{pct(winProb)}</td>
                            <td style={{ padding: "10px 8px" }}>
                              {baseGap == null ? "—" : `${Math.round(baseGap)} `}
                              {r?.signals?.isAwayPick ? <span className="pill">Away</span> : null}
                            </td>
                            <td style={{ padding: "10px 8px" }} className="muted">
                              {why}
                            </td>
                            <td style={{ padding: "10px 8px" }} className="muted">
                              {restText}
                            </td>
                            <td style={{ padding: "10px 8px" }}>{num(score, 2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="footer">
          <div className="footerInner">
            <div className="muted">Sports MVP</div>
            <div className="muted">Upset Watch</div>
          </div>
        </div>
      </div>
    </div>
  );
}
