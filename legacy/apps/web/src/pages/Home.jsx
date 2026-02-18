// legacy/apps/web/src/pages/Home.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getTeamLogo } from "../lib/teamLogos.js";

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function fmtPct(x, digits = 0) {
  if (x == null || !Number.isFinite(Number(x))) return "—";
  const n = Number(x);
  const p = Math.round(n * 100 * Math.pow(10, digits)) / Math.pow(10, digits);
  return `${p}%`;
}

function fmtNum(x) {
  if (x == null || !Number.isFinite(Number(x))) return "—";
  return String(Number(x));
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function leagueLabel(l) {
  const x = String(l || "").toLowerCase();
  if (x === "nba") return "NBA";
  if (x === "nhl") return "NHL";
  if (x === "ncaam") return "NCAAM";
  return String(l || "").toUpperCase();
}

function sortByDateAsc(rows) {
  return [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function sortByDateDesc(rows) {
  return [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function summarizeRows(rows) {
  const r = safeArr(rows);

  let games = 0;
  let picks = 0;
  let pass = 0;
  let completed = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;

  for (const x of r) {
    games += Number(x?.games || 0);
    picks += Number(x?.picks || 0);
    pass += Number(x?.pass || 0);
    completed += Number(x?.completed || 0);
    wins += Number(x?.wins || 0);
    losses += Number(x?.losses || 0);
    pushes += Number(x?.pushes || 0);
  }

  const winRate = picks > 0 ? wins / Math.max(1, wins + losses) : null;
  return { games, picks, pass, completed, wins, losses, pushes, winRate };
}

function dayRowLabel(row) {
  const d = String(row?.date || "");
  if (d.length >= 10) return d.slice(5, 10);
  return d || "—";
}

function isFinalStatus(s) {
  const x = String(s || "").toLowerCase();
  return x.includes("final") || x === "f" || x === "ft";
}

/**
 * Normalize prediction list items into a consistent pick object:
 * { pickSide, winProb, edge, confidence, tier, raw }
 */
function normalizePickFields(pickLike) {
  const p = pickLike || {};

  const pickSide = p?.pickSide ?? p?.side ?? p?.pick ?? null;
  const winProb = p?.winProb ?? p?.prob ?? p?.p ?? null;
  const edge = p?.edge ?? p?.ev ?? p?.value ?? null;

  // Confidence should be numeric; if it’s a tier string, don’t treat it as confidence.
  let confidence = p?.confidence ?? p?.conf ?? null;
  if (typeof confidence === "string") {
    const s = confidence.trim().toUpperCase();
    if (["A", "B", "C", "D"].includes(s)) confidence = null;
  }

  const tier = p?.tier ?? (typeof p?.confidence === "string" ? p.confidence : null) ?? null;

  return {
    pickSide: pickSide == null ? null : String(pickSide),
    winProb: winProb == null ? null : Number(winProb),
    edge: edge == null ? null : Number(edge),
    confidence: confidence == null ? null : Number(confidence),
    tier: tier == null ? null : String(tier),
    raw: p,
  };
}

function pickGameId(item) {
  return item?.gameId || item?.id || item?.game_id || item?.eventId || item?.espnEventId || null;
}

function predictionsEndpointForLeague(lg, date) {
  if (lg === "nba") return `/api/nba/predict?date=${encodeURIComponent(date)}`;
  if (lg === "nhl") return `/api/nhl/predict?date=${encodeURIComponent(date)}`;
  if (lg === "ncaam") return `/api/ncaam/predict?date=${encodeURIComponent(date)}`;
  return `/api/predictions?league=${encodeURIComponent(lg)}&date=${encodeURIComponent(date)}`;
}

function scheduleEndpointForLeague(lg, date) {
  // unified schedule (your /api/games normalizes id/gameId + home/away)
  const qs = new URLSearchParams({ league: lg, date, expand: "teams" });
  return `/api/games?${qs.toString()}`;
}

export default function Home() {
  const [slateDate] = useState(todayUTCYYYYMMDD());
  const [rangeDays, setRangeDays] = useState(30);

  const [apiOk, setApiOk] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const [perf, setPerf] = useState({ meta: null, rows: { nba: [], nhl: [], ncaam: [] } });
  const [loadingPerf, setLoadingPerf] = useState(false);
  const [perfErr, setPerfErr] = useState("");

  const [slate, setSlate] = useState({
    loading: false,
    error: "",
    byLeague: { nba: [], nhl: [], ncaam: [] },
    predMeta: { nba: null, nhl: null, ncaam: null },
  });

  // Health check
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/health", { signal: controller.signal });
        const j = await res.json().catch(() => null);
        setApiOk(Boolean(j?.ok));
      } catch {
        setApiOk(false);
      }
    })();
    return () => controller.abort();
  }, []);

  // Performance fetch
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      setLoadingPerf(true);
      setPerfErr("");

      try {
        const qs = new URLSearchParams({
          leagues: "nba,nhl,ncaam",
          days: String(rangeDays),
        });

        const res = await fetch(`/api/performance?${qs.toString()}`, { signal: controller.signal });
        const j = await res.json();

        const rows = j?.rows || {};
        const next = {
          meta: j?.meta || null,
          rows: {
            nba: safeArr(rows.nba),
            nhl: safeArr(rows.nhl),
            ncaam: safeArr(rows.ncaam),
          },
        };

        setPerf(next);

        const all = [...next.rows.nba, ...next.rows.nhl, ...next.rows.ncaam];
        const maxTs = all
          .map((r) => (r?.updated_at ? Date.parse(r.updated_at) : NaN))
          .filter((t) => Number.isFinite(t))
          .sort((a, b) => b - a)[0];

        setUpdatedAt(Number.isFinite(maxTs) ? new Date(maxTs).toLocaleString() : null);
      } catch (e) {
        const msg = String(e?.message || e);
        if (!msg.toLowerCase().includes("aborted")) setPerfErr(msg);
      } finally {
        setLoadingPerf(false);
      }
    })();

    return () => controller.abort();
  }, [rangeDays]);

  // Today's slate + predictions
  useEffect(() => {
    const controller = new AbortController();

    async function fetchJSON(url) {
      const res = await fetch(url, { signal: controller.signal });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = j?.error || j?.message || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return j;
    }

    (async () => {
      setSlate((s) => ({ ...s, loading: true, error: "" }));

      const leagues = ["nba", "nhl", "ncaam"];

      try {
        const results = await Promise.allSettled(
          leagues.map(async (lg) => {
            // 1) schedule
            const gamesPayload = await fetchJSON(scheduleEndpointForLeague(lg, slateDate));
            const games = safeArr(gamesPayload?.games);

            // 2) predictions (league-specific first, then fallbacks)
            let predPayload = null;
            let predErr = null;

            try {
              predPayload = await fetchJSON(predictionsEndpointForLeague(lg, slateDate));
            } catch (e1) {
              predErr = e1;
              try {
                const qs = new URLSearchParams({ league: lg, date: slateDate });
                predPayload = await fetchJSON(`/api/predictions?${qs.toString()}`);
                predErr = null;
              } catch (e2) {
                predErr = e2;
                try {
                  const qs2 = new URLSearchParams({ league: lg, date: slateDate });
                  predPayload = await fetchJSON(`/api/predict?${qs2.toString()}`);
                  predErr = null;
                } catch (e3) {
                  predErr = e3;
                  predPayload = null;
                }
              }
            }

            // 3) map predictions by gameId
            const byGameId = new Map();
            const predList =
              safeArr(predPayload?.games) ||
              safeArr(predPayload?.rows) ||
              safeArr(predPayload?.data) ||
              safeArr(predPayload?.predictions) ||
              [];

            for (const item of predList) {
              const gid = pickGameId(item);
              if (!gid) continue;
              const pickLike = item?.pick || item?.modelPick || item?.prediction || item;
              byGameId.set(String(gid), normalizePickFields(pickLike));
            }

            // 4) merge picks onto schedule
            const merged = games.map((g) => {
              const gid = String(g?.gameId || g?.id || "");
              const pick = gid ? byGameId.get(gid) : null;
              return {
                ...g,
                _pick:
                  pick ||
                  ({
                    pickSide: null,
                    winProb: null,
                    edge: null,
                    confidence: null,
                    tier: null,
                    raw: null,
                  }),
              };
            });

            return {
              lg,
              games: merged,
              predMeta: predPayload?.meta || null,
              predError: predErr ? String(predErr?.message || predErr) : "",
            };
          })
        );

        const next = { nba: [], nhl: [], ncaam: [] };
        const predMeta = { nba: null, nhl: null, ncaam: null };
        let anyErr = "";

        for (const r of results) {
          if (r.status === "fulfilled") {
            next[r.value.lg] = safeArr(r.value.games);
            predMeta[r.value.lg] = r.value.predMeta || null;
            if (r.value.predError) {
              anyErr = anyErr || `Predictions unavailable for ${leagueLabel(r.value.lg)} (${r.value.predError})`;
            }
          } else {
            anyErr = anyErr || String(r.reason?.message || r.reason || "Unknown slate error");
          }
        }

        setSlate({ loading: false, error: anyErr, byLeague: next, predMeta });
      } catch (e) {
        const msg = String(e?.message || e);
        if (!msg.toLowerCase().includes("aborted")) setSlate((s) => ({ ...s, loading: false, error: msg }));
      }
    })();

    return () => controller.abort();
  }, [slateDate]);

  const leagueRows = useMemo(() => {
    return {
      nba: sortByDateAsc(perf.rows.nba),
      nhl: sortByDateAsc(perf.rows.nhl),
      ncaam: sortByDateAsc(perf.rows.ncaam),
    };
  }, [perf]);

  const leagueSummaries = useMemo(() => {
    return {
      nba: summarizeRows(leagueRows.nba),
      nhl: summarizeRows(leagueRows.nhl),
      ncaam: summarizeRows(leagueRows.ncaam),
    };
  }, [leagueRows]);

  const totals = useMemo(() => {
    const s = ["nba", "nhl", "ncaam"].reduce(
      (acc, l) => {
        const x = leagueSummaries[l];
        acc.games += x.games;
        acc.picks += x.picks;
        acc.pass += x.pass;
        acc.completed += x.completed;
        acc.wins += x.wins;
        acc.losses += x.losses;
        acc.pushes += x.pushes;
        return acc;
      },
      { games: 0, picks: 0, pass: 0, completed: 0, wins: 0, losses: 0, pushes: 0 }
    );

    const winRate = s.picks > 0 ? s.wins / Math.max(1, s.wins + s.losses) : null;
    return { ...s, winRate };
  }, [leagueSummaries]);

  const rangeLabel = rangeDays === 7 ? "Last 7 days" : rangeDays === 14 ? "Last 14 days" : "Last 30 days";

  function teamMetaFromGame(g, side /* "home" | "away" */) {
    const isHome = side === "home";

    // unified games gives home/away objects; older screens may still have homeTeam/awayTeam
    const obj = isHome ? g?.home || g?.homeTeam : g?.away || g?.awayTeam;

    const id = obj?.id || (isHome ? g?.homeTeamId : g?.awayTeamId) || (isHome ? g?.home_team_id : g?.away_team_id) || null;
    const name = obj?.name || obj?.abbr || id || (isHome ? "HOME" : "AWAY");
    const abbr = obj?.abbr || null;

    const logo = obj?.logo || null; // (NCAAM ESPN includes logo)
    return { id, name, abbr, logo };
  }

  function renderSlateLeagueCard(lg) {
    const rows = safeArr(slate.byLeague[lg]);

    const sorted = [...rows].sort((a, b) => {
      const aFinal = isFinalStatus(a?.status);
      const bFinal = isFinalStatus(b?.status);
      if (aFinal !== bFinal) return aFinal ? 1 : -1;
      return String(a?.id || a?.gameId || "").localeCompare(String(b?.id || b?.gameId || ""));
    });

    const hasGames = sorted.length > 0;

    return (
      <div className="league card" key={`slate-${lg}`}>
        <div className="league-head">
          <div className="league-name">{leagueLabel(lg)}</div>
          <div className="muted">{hasGames ? `${sorted.length} games` : "No games"}</div>
        </div>

        <div className="league-body">
          {slate.loading ? (
            <div className="muted">Loading…</div>
          ) : !hasGames ? (
            <div className="muted">No games found for {slateDate}</div>
          ) : (
            <div className="day-list">
              {sorted.map((g) => {
                const home = teamMetaFromGame(g, "home");
                const away = teamMetaFromGame(g, "away");

                const homeLogo = home.logo || getTeamLogo(lg, home?.id || home?.name);
                const awayLogo = away.logo || getTeamLogo(lg, away?.id || away?.name);

                const hs = g?.homeScore ?? g?.home_score ?? home?.score ?? null;
                const as = g?.awayScore ?? g?.away_score ?? away?.score ?? null;

                const status = String(g?.status || "—");

                const pickSide = g?._pick?.pickSide;
                const winProb = g?._pick?.winProb;
                const edge = g?._pick?.edge;
                const confidence = g?._pick?.confidence;
                const tier = g?._pick?.tier;

                const pickTeam = pickSide === "home" ? home : pickSide === "away" ? away : null;

                return (
                  <div className="day-row" key={`${lg}-${g?.id || g?.gameId || Math.random()}`}>
                    <div className="day-date" style={{ width: 56 }}>
                      <span className="muted">{status}</span>
                    </div>

                    <div className="day-mid" style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 200 }}>
                        {awayLogo ? (
                          <img src={awayLogo} alt={away.name} style={{ width: 18, height: 18, borderRadius: 4 }} />
                        ) : null}
                        <span>{away.name}</span>
                        <span className="muted">@</span>
                        {homeLogo ? (
                          <img src={homeLogo} alt={home.name} style={{ width: 18, height: 18, borderRadius: 4 }} />
                        ) : null}
                        <span>{home.name}</span>
                      </div>

                      <div className="muted" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span>
                          {as != null && hs != null ? <strong style={{ fontWeight: 600 }}>{as}-{hs}</strong> : "—"}
                        </span>

                        {pickTeam ? (
                          <>
                            <span className="tag">Pick: {pickTeam.name}</span>
                            <span className="tag">Win: {fmtPct(winProb, 0)}</span>
                            <span className="tag">Edge: {edge == null ? "—" : Number(edge).toFixed(2)}</span>
                            <span className="tag">Tier: {tier ?? "—"}</span>
                            <span className="tag">
                              Conf: {confidence == null || !Number.isFinite(confidence) ? "—" : Number(confidence).toFixed(2)}
                            </span>
                          </>
                        ) : (
                          <span className="tag warn">No prediction</span>
                        )}
                      </div>
                    </div>

                    <div className="day-pct" style={{ width: 90, textAlign: "right" }}>
                      <Link
                        to={`/upsets?league=${encodeURIComponent(lg)}&date=${encodeURIComponent(slateDate)}`}
                        className="btn secondary"
                        style={{ padding: "6px 10px", fontSize: 12 }}
                      >
                        Upsets
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="muted" style={{ marginTop: 10, display: "flex", justifyContent: "space-between" }}>
          <span>Model: {slate.predMeta?.[lg]?.model || slate.predMeta?.[lg]?.engine || "—"}</span>
          <Link className="muted" to={`/${lg}`}>
            Open {leagueLabel(lg)} →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="shell">
        <div className="hero">
          <div>
            <h1>Sports MVP</h1>
            <p className="muted">Daily slate + premium predictions contract across NBA / NHL / NCAAM.</p>
          </div>

          <div className="hero-actions">
            <div className="pill">{slateDate}</div>
            <Link className="btn" to="/nba">
              Open NBA
            </Link>
          </div>
        </div>

        <div className="top-stats">
          <div className="stat card">
            <div className="label">API</div>
            <div className="value">{apiOk === null ? "—" : apiOk ? "Online" : "Offline"}</div>
          </div>

          <div className="stat card">
            <div className="label">Slate date</div>
            <div className="value">{slateDate}</div>
          </div>

          <div className="stat card">
            <div className="label">Updated</div>
            <div className="value">{updatedAt || "—"}</div>
          </div>

          <div className="stat card">
            <div className="label">Scored accuracy</div>
            <div className="value">{fmtPct(totals.winRate, 0)}</div>
          </div>
        </div>

        {/* SECTION 1: PERFORMANCE */}
        <div className="card section">
          <div className="section-header">
            <div>
              <div className="section-title">{rangeDays}-day performance</div>
              <div className="muted">
                Scored picks: {fmtNum(totals.picks)} • Total games: {fmtNum(totals.games)} • Completed: {fmtNum(totals.completed)}
              </div>
            </div>

            <div className="section-controls">
              <div className="muted">Accuracy trend</div>
              <div className="toggle">
                <button className={rangeDays === 7 ? "active" : ""} onClick={() => setRangeDays(7)} type="button">
                  7 days
                </button>
                <button className={rangeDays === 14 ? "active" : ""} onClick={() => setRangeDays(14)} type="button">
                  14 days
                </button>
                <button className={rangeDays === 30 ? "active" : ""} onClick={() => setRangeDays(30)} type="button">
                  30 days
                </button>
              </div>
              <div className="pill small">{rangeLabel}</div>
            </div>
          </div>

          {perfErr ? (
            <div className="error">
              <div className="error-title">Performance error</div>
              <div className="muted">{perfErr}</div>
            </div>
          ) : null}

          <div className="league-grid">
            {["nba", "nhl", "ncaam"].map((lg) => {
              const rowsAsc = leagueRows[lg];
              const rowsDesc = sortByDateDesc(rowsAsc);
              const sum = leagueSummaries[lg];
              const empty = sum.picks === 0 && sum.pass === 0 && sum.games === 0;

              return (
                <div className="league card" key={lg}>
                  <div className="league-head">
                    <div className="league-name">{leagueLabel(lg)}</div>
                    <div className="muted">Avg: {fmtPct(sum.winRate, 0)}</div>
                  </div>

                  <div className="league-body">
                    {loadingPerf ? (
                      <div className="muted">Loading…</div>
                    ) : empty ? (
                      <div className="muted">No scored picks yet</div>
                    ) : (
                      <div className="day-list">
                        {rowsDesc.map((r) => {
                          const scored = Number(r?.picks || 0);
                          const pct = r?.win_rate;
                          const note = r?.error ? String(r.error) : "";

                          return (
                            <div className="day-row" key={`${lg}-${r.date}`}>
                              <div className="day-date">{dayRowLabel(r)}</div>
                              <div className="day-mid">
                                <span className="muted">{scored} scored</span>
                                {note ? <span className="tag warn">{note}</span> : null}
                              </div>
                              <div className="day-pct">{fmtPct(pct, 0)}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section-foot muted">
            Tip: Use <span className="tag">Tournament</span> mode on NCAAM pages for neutral-court feel + higher upset sensitivity.
          </div>
        </div>

        {/* SECTION 2: TODAY'S SLATE + MODEL PICKS */}
        <div className="card section">
          <div className="section-header">
            <div>
              <div className="section-title">Today’s slate (model picks)</div>
              <div className="muted">
                Date: {slateDate} • Schedule via <span className="tag">/api/games</span> • Predictions via{" "}
                <span className="tag">/api/&lt;league&gt;/predict</span>
              </div>
            </div>

            <div className="section-controls">
              <Link className="btn secondary" to={`/upsets?league=nba&date=${encodeURIComponent(slateDate)}`}>
                Upset Watch
              </Link>
            </div>
          </div>

          {slate.error ? (
            <div className="error">
              <div className="error-title">Slate warning</div>
              <div className="muted">{slate.error}</div>
            </div>
          ) : null}

          <div className="league-grid">{["nba", "nhl", "ncaam"].map((lg) => renderSlateLeagueCard(lg))}</div>

          <div className="section-foot muted">Note: Olympics are included as normal NHL games — no special filtering.</div>
        </div>

        <div className="bottom-actions">
          <Link className="btn secondary" to="/parlay">
            Parlay Lab
          </Link>
          <Link className="btn secondary" to="/upsets">
            Upset Watch
          </Link>
          <Link className="btn secondary" to="/ncaam?tournament=1">
            NCAAM Tournament Mode
          </Link>
        </div>
      </div>
    </div>
  );
}
