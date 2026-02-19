// legacy/apps/web/src/pages/Performance.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const LEAGUES = ["nba", "nhl", "ncaam"];

function todayUTC() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function pct(x) {
  if (x == null || !Number.isFinite(Number(x))) return "—";
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function sum(arr, key) {
  return (arr || []).reduce((acc, r) => acc + (Number(r?.[key]) || 0), 0);
}

function overallWinRate(rows) {
  const wins = sum(rows, "wins");
  const losses = sum(rows, "losses");
  const denom = wins + losses;
  return denom > 0 ? wins / denom : null;
}

export default function Performance() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const q = `leagues=${LEAGUES.join(",")}&days=${days}`;
        const r = await fetch(`/api/performance?${q}`);
        const j = await r.json();
        if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`);
        if (!dead) setData(j);
      } catch (e) {
        if (!dead) setErr(String(e?.message || e));
      } finally {
        if (!dead) setLoading(false);
      }
    }
    run();
    return () => {
      dead = true;
    };
  }, [days]);

  const rowsByLeague = useMemo(() => {
    const rows = data?.rows || {};
    return {
      nba: Array.isArray(rows.nba) ? rows.nba : [],
      nhl: Array.isArray(rows.nhl) ? rows.nhl : [],
      ncaam: Array.isArray(rows.ncaam) ? rows.ncaam : [],
    };
  }, [data]);

  const overall = useMemo(() => {
    const nba = rowsByLeague.nba;
    const nhl = rowsByLeague.nhl;
    const ncaam = rowsByLeague.ncaam;

    const o = {
      nba: overallWinRate(nba),
      nhl: overallWinRate(nhl),
      ncaam: overallWinRate(ncaam),
    };

    const all = [...nba, ...nhl, ...ncaam];
    o.all = overallWinRate(all);
    o.allWins = sum(all, "wins");
    o.allLosses = sum(all, "losses");
    o.allPicks = sum(all, "picks");
    return o;
  }, [rowsByLeague]);

  const newestDate = useMemo(() => {
    // rows are usually returned descending; fall back to today
    const any = rowsByLeague.nba?.[0]?.date || rowsByLeague.ncaam?.[0]?.date || rowsByLeague.nhl?.[0]?.date;
    return any || todayUTC();
  }, [rowsByLeague]);

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="slateHeader">
        <div>
          <div className="h1" style={{ fontSize: 22 }}>Performance</div>
          <div className="sub">Default 7 days. Toggle 14/30. Click a day to jump into predictions.</div>
        </div>

        <div className="pills">
          <button className="pill" onClick={() => setDays(7)} aria-pressed={days === 7}>7D</button>
          <button className="pill" onClick={() => setDays(14)} aria-pressed={days === 14}>14D</button>
          <button className="pill" onClick={() => setDays(30)} aria-pressed={days === 30}>30D</button>
        </div>
      </div>

      {loading ? (
        <div className="sub">Loading…</div>
      ) : err ? (
        <div className="badge bad">{err}</div>
      ) : (
        <>
          <div className="grid" style={{ marginTop: 10 }}>
            <div className="kpi" style={{ gridColumn: "span 3" }}>
              <div className="label">Overall (All Leagues)</div>
              <div className="value">{pct(overall.all)}</div>
              <div className="sub">{overall.allWins}-{overall.allLosses} • {overall.allPicks} picks</div>
            </div>

            <div className="kpi" style={{ gridColumn: "span 3" }}>
              <div className="label">NBA</div>
              <div className="value">{pct(overall.nba)}</div>
              <div className="sub">Latest row: {rowsByLeague.nba?.[0]?.date || "—"}</div>
            </div>

            <div className="kpi" style={{ gridColumn: "span 3" }}>
              <div className="label">NHL</div>
              <div className="value">{pct(overall.nhl)}</div>
              <div className="sub">Picks may be paused (slate mode)</div>
            </div>

            <div className="kpi" style={{ gridColumn: "span 3" }}>
              <div className="label">NCAAM</div>
              <div className="value">{pct(overall.ncaam)}</div>
              <div className="sub">ESPN scoreboard model</div>
            </div>
          </div>

          <div className="grid" style={{ marginTop: 14 }}>
            {LEAGUES.map((l) => {
              const rows = rowsByLeague[l];
              return (
                <div key={l} className="card slateCard" style={{ gridColumn: "span 4" }}>
                  <div className="slateHeader">
                    <div className="slateTitle">{l.toUpperCase()}</div>
                    <Link className="badge" to={`/league/${l}?date=${encodeURIComponent(newestDate)}`}>Open</Link>
                  </div>

                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>W-L</th>
                        <th>Win%</th>
                        <th>Picks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rows || []).slice(0, Math.min(rows.length, days)).map((r) => (
                        <tr key={`${l}-${r.date}`}>
                          <td>
                            <Link to={`/league/${l}?date=${encodeURIComponent(r.date)}`} className="badge">
                              {r.date}
                            </Link>
                          </td>
                          <td>{(r.wins ?? 0)}-{(r.losses ?? 0)}</td>
                          <td>{pct(r.win_rate)}</td>
                          <td>{r.picks ?? 0}</td>
                        </tr>
                      ))}
                      {(!rows || rows.length === 0) && (
                        <tr><td colSpan={4} className="sub">No rows yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
