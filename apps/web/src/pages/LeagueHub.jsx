import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPredictions, getLeagueGames } from "../lib/api";

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function pct(n) {
  const v = clamp(Number(n || 0), 0, 1);
  return `${Math.round(v * 100)}%`;
}

function asTeamAbbr(idOrAbbr) {
  if (!idOrAbbr) return "";
  const s = String(idOrAbbr);
  return s.replace("nba-", "").replace("nhl-", "").toUpperCase();
}

function classifyPick(conf) {
  const c = Number(conf);
  if (!Number.isFinite(c)) return { label: "Unknown", tone: "neutral" };
  if (c >= 0.75) return { label: "Top pick", tone: "top" };
  if (c >= 0.62) return { label: "Value", tone: "value" };
  if (c >= 0.54) return { label: "Lean", tone: "lean" };
  return { label: "Avoid", tone: "avoid" };
}

// ✅ canonical team route helper
function teamHref(leagueLower, teamId) {
  if (!teamId) return "#";
  return `/league/${leagueLower}/team/${teamId}`;
}

export default function LeagueHub() {
  const { league } = useParams(); // "nba" | "nhl"
  const leagueLower = String(league || "").toLowerCase();
  const leagueUpper = leagueLower.toUpperCase();
  const accent = leagueLower === "nhl" ? "var(--nhl)" : "var(--nba)";

  const [date, setDate] = useState(todayUTC());
  const [windowDays, setWindowDays] = useState(5);
  const [tab, setTab] = useState("predictions"); // "games" | "predictions"

  const [games, setGames] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [meta, setMeta] = useState(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // ✅ games are already league-specific now
  const filteredGames = useMemo(() => games || [], [games]);

  const picks = useMemo(() => {
    const list = (predictions || [])
      .map((p) => {
        const awayId = p.away?.id;
        const homeId = p.home?.id;

        const awayName = p.away?.abbr || p.away?.name || asTeamAbbr(awayId);
        const homeName = p.home?.abbr || p.home?.name || asTeamAbbr(homeId);

        const pickName = p.prediction?.winnerName || "—";
        const conf = p.prediction?.confidence;

        const badge = classifyPick(conf);

        return {
          key: p.gameId,
          status: p.status,
          away: { id: awayId, name: awayName },
          home: { id: homeId, name: homeName },
          pickName,
          conf,
          badge,
          raw: p,
        };
      })
      .sort((a, b) => Number(b.conf || 0) - Number(a.conf || 0));

    return list;
  }, [predictions]);

  const topPicks = useMemo(() => picks.slice(0, 3), [picks]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");

      try {
        // ✅ Only fetch what you need based on the active tab.
        // This keeps it fast + avoids unnecessary endpoint churn.
        if (tab === "games") {
          const g = await getLeagueGames(leagueLower, date);
          if (!alive) return;
          setGames(Array.isArray(g) ? g : g?.games || []);
          return;
        }

        // predictions tab
        const p = await getPredictions({ league: leagueLower, date, windowDays });
        if (!alive) return;

        setPredictions(p?.predictions || []);
        setMeta(p?.meta || null);
      } catch (e) {
        if (!alive) return;
        setErr(String(e?.message || e));
        setGames([]);
        setPredictions([]);
        setMeta(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [leagueLower, date, windowDays, tab]);

  return (
    <div>
      <h1 className="h1">
        <span className="badge">
          <span className="dot" style={{ background: accent }} />
          {leagueUpper}
        </span>
        <span style={{ marginLeft: 10 }}>Games & Predictions</span>
      </h1>
      <p className="sub">Date-based slate + model picks (same endpoint for NBA/NHL).</p>

      <div className="panel">
        <div className="panelHead">
          <div className="controls">
            <div className="control">
              <span className="muted">Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            <div className="control">
              <span className="muted">Window</span>
              <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
                <option value={5}>5 days</option>
                <option value={10}>10 days</option>
                <option value={14}>14 days</option>
              </select>
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label="View">
            <button className={`tab ${tab === "games" ? "active" : ""}`} onClick={() => setTab("games")}>
              Games
            </button>
            <button
              className={`tab ${tab === "predictions" ? "active" : ""}`}
              onClick={() => setTab("predictions")}
            >
              Predictions
            </button>
          </div>
        </div>

        <div className="list">
          {err ? <div className="error">Error: {err}</div> : null}

          {loading ? (
            <div className="card">
              <div className="muted">Loading…</div>
            </div>
          ) : null}

          {/* Model card only makes sense on predictions */}
          {!loading && tab === "predictions" && meta ? (
            <div className="card">
              <div className="row">
                <div style={{ fontWeight: 760 }}>Model</div>
                <div className="muted">{meta.note || "Predictions"}</div>
              </div>
              <div className="kicker">
                Window: <b>{meta.windowDays ?? windowDays}d</b>
                {meta.historyStart ? (
                  <>
                    {" "}
                    • History: {meta.historyStart} → {meta.historyEnd}
                  </>
                ) : null}
                {typeof meta.historyGamesFetched === "number" ? (
                  <>
                    {" "}
                    • Samples: {meta.historyGamesFetched} games
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* PREMIUM PREDICTIONS LAYER */}
          {tab === "predictions" && !loading ? (
            <>
              {topPicks?.length ? (
                <div className="card">
                  <div className="sectionHead">
                    <div>
                      <div className="sectionTitle">Top Picks</div>
                      <div className="muted">Highest confidence for {date}</div>
                    </div>
                    <div className="chips">
                      <span className="chip chipTop">Top pick</span>
                      <span className="chip chipValue">Value</span>
                      <span className="chip chipLean">Lean</span>
                      <span className="chip chipAvoid">Avoid</span>
                    </div>
                  </div>

                  <div className="topGrid">
                    {topPicks.map((p, idx) => (
                      <div className="topPick" key={p.key}>
                        <div className="topPickRank">#{idx + 1}</div>

                        <div className="topPickMain">
                          <div className="topPickMatch">
                            <Link to={teamHref(leagueLower, p.away.id)}>{p.away.name}</Link>{" "}
                            <span className="muted">@</span>{" "}
                            <Link to={teamHref(leagueLower, p.home.id)}>{p.home.name}</Link>
                          </div>
                          <div className="topPickMeta">
                            <span className={`pill pill-${p.badge.tone}`}>{p.badge.label}</span>
                            <span className="muted">{p.status}</span>
                          </div>
                        </div>

                        <div className="topPickRight">
                          <div className="pickPill">
                            <span className="muted">Pick</span>
                            <b>{p.pickName}</b>
                          </div>
                          <span className="conf">{pct(p.conf)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {picks?.length ? (
                <div className="card">
                  <div className="sectionHead">
                    <div>
                      <div className="sectionTitle">All Predictions</div>
                      <div className="muted">Sorted by confidence</div>
                    </div>
                    <div className="muted">{picks.length} games</div>
                  </div>

                  <div className="predList">
                    {picks.map((p) => (
                      <div className="predRow" key={p.key}>
                        <div className="predLeft">
                          <div className="predMatch">
                            <Link to={teamHref(leagueLower, p.away.id)}>{p.away.name}</Link>{" "}
                            <span className="muted">@</span>{" "}
                            <Link to={teamHref(leagueLower, p.home.id)}>{p.home.name}</Link>
                          </div>
                          <div className="predMeta">
                            <span className={`pill pill-${p.badge.tone}`}>{p.badge.label}</span>
                            <span className="muted">{p.status}</span>
                          </div>
                        </div>

                        <div className="predRight">
                          <div className="pickPill">
                            <span className="muted">Pick</span>
                            <b>{p.pickName}</b>
                          </div>
                          <span className="conf">{pct(p.conf)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="card">
                  <div className="muted">No predictions returned for {date}.</div>
                </div>
              )}
            </>
          ) : null}

          {/* GAMES TAB (league-native endpoint) */}
          {tab === "games" && !loading ? (
            filteredGames.length ? (
              filteredGames.map((g) => {
                const home = g.homeTeam?.abbr || asTeamAbbr(g.homeTeamId);
                const away = g.awayTeam?.abbr || asTeamAbbr(g.awayTeamId);
                const hs = typeof g.homeScore === "number" ? g.homeScore : "-";
                const as = typeof g.awayScore === "number" ? g.awayScore : "-";

                return (
                  <div className="card" key={g.id}>
                    <div className="row">
                      <div style={{ fontWeight: 720 }}>
                        <Link to={teamHref(leagueLower, g.awayTeamId)} style={{ color: "inherit" }}>
                          {away}
                        </Link>{" "}
                        @{" "}
                        <Link to={teamHref(leagueLower, g.homeTeamId)} style={{ color: "inherit" }}>
                          {home}
                        </Link>
                      </div>
                      <div className="muted">
                        {as}–{hs}
                      </div>
                    </div>
                    <div className="kicker">{g.status}</div>
                  </div>
                );
              })
            ) : (
              <div className="card">
                <div className="muted">No games found for {date}.</div>
              </div>
            )
          ) : null}

          <div className="footer">
            <div className="footerInner">
              <span className="muted">Tip: use 5d to avoid rate limits</span>
              <Link to="/" className="muted">
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
