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

function sideLabel(side) {
  const s = String(side || "").toLowerCase();
  if (s === "home") return "HOME";
  if (s === "away") return "AWAY";
  return "—";
}

export default function Upsets() {
  const [league, setLeague] = useState("nba"); // nba | nhl | ncaam
  const [date, setDate] = useState(todayYMD());

  // API: window, minWin, limit (+ aliases supported by backend)
  const [windowDays, setWindowDays] = useState(14);
  const [minWin, setMinWin] = useState(0.3);
  const [limit, setLimit] = useState(20);

  // mode=watch|strict
  const [mode, setMode] = useState("watch");

  // score | winProb | baseGap
  const [sortKey, setSortKey] = useState("score");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState(null);

  // Sensible defaults when you switch leagues
  useEffect(() => {
    if (league === "ncaam") {
      // NCAA: tighter distribution → 0.20 is more useful
      setMinWin((v) => (Number.isFinite(v) ? Math.min(v, 0.3) : 0.2));
      if (minWin > 0.3) setMinWin(0.2);
      if (windowDays < 14) setWindowDays(45);
    } else {
      if (windowDays > 60) setWindowDays(14);
      if (minWin < 0.25) setMinWin(0.3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league]);

  async function load() {
    setLoading(true);
    setErr("");

    try {
      const qs = new URLSearchParams({
        league,
        date,
        window: String(windowDays),
        minWin: String(minWin),
        limit: String(limit),
        mode,
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
  }, [league, date, windowDays, minWin, limit, mode]);

  const meta = payload?.meta || {};

  // backend returns BOTH `rows` and `candidates`
  const rows = useMemo(() => {
    if (Array.isArray(payload?.rows)) return payload.rows;
    if (Array.isArray(payload?.candidates)) return payload.candidates;
    return [];
  }, [payload]);

  const sorted = useMemo(() => {
    const r = [...rows];

    const baseGapAbs = (x) => {
      const g = x?.signals?.baseGap;
      return Number.isFinite(g) ? Math.abs(g) : 0;
    };

    const score = (x) => {
      const s = x?.signals?.score;
      return Number.isFinite(s) ? s : 0;
    };

    const winProb = (x) => {
      const w = x?.winProb;
      return Number.isFinite(w) ? w : 0;
    };

    r.sort((a, b) => {
      if (sortKey === "baseGap") return baseGapAbs(a) - baseGapAbs(b); // closer game first
      if (sortKey === "winProb") return winProb(b) - winProb(a);
      return score(b) - score(a);
    });

    return r.slice(0, Math.max(1, Math.min(50, Number(limit) || 20)));
  }, [rows, sortKey, limit]);

  const emptyReason = useMemo(() => {
    if (loading) return "";
    if (err) return "";
    if (!payload) return "";

    const slate = typeof meta?.slateGames === "number" ? meta.slateGames : null;

    if (slate === 0) return "No games on this slate (try another date/league).";
    if ((payload?.count ?? 0) === 0) return "No upset candidates matched your filters for this slate.";
    return "No results.";
  }, [loading, err, payload, meta]);

  return (
    <div className="homeFull">
      <div className="container">
        <div className="panel" style={{ marginTop: 10 }}>
          <div className="panelHead">
            <div>
              <div style={{ fontWeight: 900 }}>Upset Watch</div>
              <div className="muted" style={{ marginTop: 6 }}>
                Underdog win equity + model context (pick/edge/conf). Use <b>Watch</b> to scan equity; use{" "}
                <b>Strict</b> for “model actually picked the dog.”
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <span className="pill">Source: {meta?.source || "—"}</span>
                <span className="pill">League: {league.toUpperCase()}</span>
                <span className="pill">Mode: {mode}</span>
                <span className="pill">Window: {windowDays}d</span>
                <span className="pill">Min underdog win%: {pct(minWin)}</span>

                {typeof meta?.slateGames === "number" ? <span className="pill">Slate: {meta.slateGames}</span> : null}
                {typeof meta?.strictUnderdogPicks === "number" ? (
                  <span className="pill">Model underdog picks: {meta.strictUnderdogPicks}</span>
                ) : null}
                {typeof meta?.elapsedMs === "number" ? <span className="pill">API: {meta.elapsedMs}ms</span> : null}
              </div>
            </div>

            <div className="controls">
              <Link className="btnGhost" to="/">
                Home
              </Link>

              <button className={league === "nba" ? "btnPrimary" : "btnGhost"} onClick={() => setLeague("nba")}>
                NBA
              </button>
              <button className={league === "nhl" ? "btnPrimary" : "btnGhost"} onClick={() => setLeague("nhl")}>
                NHL
              </button>
              <button className={league === "ncaam" ? "btnPrimary" : "btnGhost"} onClick={() => setLeague("ncaam")}>
                NCAAM
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="row" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Date</div>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Window</div>
                <input
                  type="number"
                  min={3}
                  max={90}
                  value={windowDays}
                  onChange={(e) => setWindowDays(Number(e.target.value || 14))}
                  className="input"
                  style={{ width: 90 }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Min underdog win%</div>
                <input
                  type="number"
                  min={0.05}
                  max={0.95}
                  step={0.05}
                  value={minWin}
                  onChange={(e) => setMinWin(Number(e.target.value || 0.3))}
                  className="input"
                  style={{ width: 150 }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Limit</div>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value || 20))}
                  className="input"
                  style={{ width: 90 }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Mode</div>
                <select value={mode} onChange={(e) => setMode(e.target.value)} className="input">
                  <option value="watch">Watch (equity filter)</option>
                  <option value="strict">Strict (model picked underdog)</option>
                </select>
              </div>

              <div style={{ flex: 1 }} />

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="muted">Sort</div>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="input">
                  <option value="score">Score</option>
                  <option value="winProb">Underdog win%</option>
                  <option value="baseGap">Gap (closest first)</option>
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
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Upset Candidates</div>

              {err ? (
                <div className="kicker">
                  <span style={{ fontWeight: 800 }}>Error:</span> {err}
                </div>
              ) : loading ? (
                <div className="kicker">Loading upsets…</div>
              ) : sorted.length === 0 ? (
                <div className="kicker">{emptyReason}</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr className="muted" style={{ textAlign: "left" }}>
                        <th style={{ padding: "10px 8px" }}>Matchup</th>
                        <th style={{ padding: "10px 8px" }}>Underdog</th>
                        <th style={{ padding: "10px 8px" }}>Fav</th>
                        <th style={{ padding: "10px 8px" }}>Dog win%</th>
                        <th style={{ padding: "10px 8px" }}>Fav side + gap</th>
                        <th style={{ padding: "10px 8px" }}>Score</th>
                        <th style={{ padding: "10px 8px" }}>Model pick</th>
                        <th style={{ padding: "10px 8px" }}>Dog edge</th>
                        <th style={{ padding: "10px 8px" }}>Conf</th>
                        <th style={{ padding: "10px 8px" }}>Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r) => {
                        const u = r?.underdog || {};
                        const f = r?.favorite || {};
                        const why = Array.isArray(r?.why) ? r.why.join(" • ") : "—";

                        const gap = r?.signals?.baseGap;
                        const favSide = r?.signals?.favoriteSide; // "home" | "away"
                        const score = r?.signals?.score;

                        const pickSide = r?.pick?.pickSide; // "home" | "away"
                        const pickName = r?.pick?.recommendedTeamName;

                        const edge = r?.pick?.edge; // this is UNDERDOG edge in your current API contract
                        const conf = r?.pick?.confidence;

                        const matchup = r?.matchup || "—";

                        return (
                          <tr
                            key={r?.id || r?.gameId || `${r?.league}-${r?.date}-${matchup}`}
                            style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}
                          >
                            <td style={{ padding: "10px 8px", fontWeight: 800 }}>{matchup}</td>

                            <td style={{ padding: "10px 8px" }}>
                              <span className="pill">
                                {u?.abbr || u?.name || "Underdog"}
                                {u?.isHome ? " (H)" : " (A)"}
                              </span>
                            </td>

                            <td style={{ padding: "10px 8px" }}>
                              {f?.abbr || f?.name || "Favorite"}
                              {f?.isHome ? " (H)" : " (A)"}
                            </td>

                            <td style={{ padding: "10px 8px" }}>{pct(r?.winProb)}</td>

                            <td style={{ padding: "10px 8px" }}>
                              {favSide ? `${sideLabel(favSide)} fav` : "—"}
                              {Number.isFinite(gap) ? ` • ${Math.round(Math.abs(gap))}` : ""}
                            </td>

                            <td style={{ padding: "10px 8px" }}>{Number.isFinite(score) ? num(score, 1) : "—"}</td>

                            <td style={{ padding: "10px 8px" }}>
                              <span className="pill">
                                {pickName ? pickName : "—"} {pickSide ? `(${sideLabel(pickSide)})` : ""}
                              </span>
                            </td>

                            <td style={{ padding: "10px 8px" }}>
                              {Number.isFinite(edge) ? num(edge, 3) : "—"}
                            </td>

                            <td style={{ padding: "10px 8px" }}>{Number.isFinite(conf) ? pct(conf) : "—"}</td>

                            <td style={{ padding: "10px 8px" }} className="muted">
                              {why}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                    Notes: “Dog win%” is the underdog’s win equity. “Dog edge” is expressed from the underdog POV
                    (so negatives are common). “Fav side + gap” is an Elo-like pseudo-gap (not official Elo).
                  </div>
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
