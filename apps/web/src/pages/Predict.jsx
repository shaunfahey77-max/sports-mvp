// apps/web/src/pages/Predict.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

/* =========================
   Helpers
   ========================= */
function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function fmtPct(x, digits = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtNum(x, digits = 3) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function safeUpper(x) {
  return String(x || "").toUpperCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function badgeClassForTier(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "ELITE") return "badge badge-elite";
  if (t === "STRONG") return "badge badge-strong";
  if (t === "EDGE") return "badge badge-edge";
  if (t === "LEAN") return "badge badge-lean";
  return "badge";
}

function parseTierRank(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "ELITE") return 4;
  if (t === "STRONG") return 3;
  if (t === "EDGE") return 2;
  if (t === "LEAN") return 1;
  return 0;
}

/**
 * Fetch wrapper:
 * - abortable
 * - retry on 429/5xx/network
 * - hard timeout
 */
async function fetchJsonWithRetry(url, { signal, timeoutMs = 20000, retries = 2 } = {}) {
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await fetch(url, { signal: controller.signal });
      const text = await res.text().catch(() => "");
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        const err = new Error(`Bad JSON (HTTP ${res.status})`);
        err.status = res.status;
        err._raw = text?.slice?.(0, 250);
        throw err;
      }

      if (!res.ok) {
        const err = new Error(json?.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.payload = json;
        throw err;
      }

      return json;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const status = Number(e?.status);

      const isAbort = msg.toLowerCase().includes("aborted") || e?.name === "AbortError";
      const isRetryable =
        isAbort ||
        status === 429 ||
        (status >= 500 && status <= 599) ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError");

      if (!isRetryable || attempt >= retries) throw e;

      await sleep(450 * Math.pow(2, attempt));
    } finally {
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  throw lastErr || new Error("Request failed");
}

/**
 * Tiny sessionStorage cache (TTL)
 */
function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (Date.now() > obj.expiresAt) return null;
    return obj.value ?? null;
  } catch {
    return null;
  }
}
function cacheSet(key, value, ttlMs = 25_000) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
  } catch {
    // ignore
  }
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeWarningText(w) {
  const s = String(w || "").trim();
  if (!s) return "";
  // keep it readable (avoid “wall of text”)
  if (s.length > 220) return `${s.slice(0, 220)}…`;
  return s;
}

/* =========================
   Component
   ========================= */
export default function Predict() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const leagueParam = String(params.league || searchParams.get("league") || "nba").toLowerCase();
  const [league, setLeague] = useState(leagueParam);

  const initialDate = searchParams.get("date") || todayUTCYYYYMMDD();
  const [date, setDate] = useState(initialDate);

  const [windowDays, setWindowDays] = useState(
    numOr(searchParams.get("windowDays"), leagueParam === "ncaam" ? 45 : leagueParam === "nhl" ? 60 : 14)
  );
  const [modelVersion, setModelVersion] = useState(searchParams.get("model") || searchParams.get("modelVersion") || "v2");
  const [tournament, setTournament] = useState((searchParams.get("tournament") ?? "0") === "1");

  // Filters
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [onlyBets, setOnlyBets] = useState((searchParams.get("onlyBets") ?? "1") === "1");
  const [showPass, setShowPass] = useState((searchParams.get("showPass") ?? "0") === "1");
  const [minEdge, setMinEdge] = useState(searchParams.get("minEdge") ?? "0.06");
  const [minWinProb, setMinWinProb] = useState(searchParams.get("minWinProb") ?? "0.58");
  const [minConf, setMinConf] = useState(searchParams.get("minConf") ?? "0.55");
  const [tierFilter, setTierFilter] = useState(searchParams.get("tier") || "");
  const [sortBy, setSortBy] = useState(searchParams.get("sortBy") || "edge");
  const [debug, setDebug] = useState((searchParams.get("debug") ?? "0") === "1");

  // Data state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState(null);

  const abortRef = useRef(null);

  useEffect(() => {
    setLeague(leagueParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueParam]);

  useEffect(() => {
    setWindowDays((cur) => {
      const n = Number(cur);
      if (Number.isFinite(n) && n > 0) return n;
      if (league === "ncaam") return 45;
      if (league === "nhl") return 60;
      return 14;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league]);

  // Persist controls to URL
  useEffect(() => {
    const next = new URLSearchParams(searchParams);

    next.set("league", league);
    next.set("date", date);

    next.set("windowDays", String(windowDays));
    if (league === "nba") next.set("model", String(modelVersion || "v2"));
    else next.delete("model");
    next.set("tournament", tournament ? "1" : "0");

    if (q) next.set("q", q);
    else next.delete("q");

    next.set("onlyBets", onlyBets ? "1" : "0");
    next.set("showPass", showPass ? "1" : "0");
    next.set("minEdge", String(minEdge));
    next.set("minWinProb", String(minWinProb));
    next.set("minConf", String(minConf));

    if (tierFilter) next.set("tier", tierFilter);
    else next.delete("tier");

    next.set("sortBy", sortBy);
    next.set("debug", debug ? "1" : "0");

    const cur = searchParams.toString();
    const nxt = next.toString();
    if (cur !== nxt) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    league,
    date,
    windowDays,
    modelVersion,
    tournament,
    q,
    onlyBets,
    showPass,
    minEdge,
    minWinProb,
    minConf,
    tierFilter,
    sortBy,
    debug,
  ]);

  async function load() {
    setErr("");
    setLoading(true);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const qs = new URLSearchParams();
    qs.set("league", league);
    qs.set("date", date);
    qs.set("windowDays", String(windowDays));
    if (league === "nba") qs.set("model", String(modelVersion || "v2"));
    if (league === "ncaam" && tournament) qs.set("tournament", "1");

    const url = `/api/predictions?${qs.toString()}`;
    const cacheKey = `predictions:${league}:${date}:w${windowDays}:m${modelVersion}:t${tournament ? 1 : 0}`;

    const cached = cacheGet(cacheKey);
    if (cached) {
      setPayload(cached);
      setLoading(false);
      return;
    }

    try {
      const data = await fetchJsonWithRetry(url, { signal: controller.signal, timeoutMs: 25_000, retries: 2 });
      setPayload(data);
      cacheSet(cacheKey, data, 25_000);
    } catch (e) {
      if (String(e?.message || "").toLowerCase().includes("aborted")) return;

      const msg = String(e?.message || e);
      const hint = msg.includes("429") ? " (Rate limited — try again in a moment.)" : "";
      setErr(`Failed to load predictions.${hint}\n${msg}`);
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, date, windowDays, modelVersion, tournament]);

  const meta = payload?.meta || {};
  const games = useMemo(() => (Array.isArray(payload?.games) ? payload.games : []), [payload]);

  const thresholds = useMemo(() => {
    const minE = clamp(numOr(minEdge, 0.06), 0, 1);
    const minW = clamp(numOr(minWinProb, 0.58), 0, 1);
    const minC = clamp(numOr(minConf, 0.55), 0, 1);
    return { minE, minW, minC };
  }, [minEdge, minWinProb, minConf]);

  const viewGames = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const tierNeed = String(tierFilter || "").toUpperCase();

    const filtered = games.filter((g) => {
      const home = g?.home?.abbr || g?.home?.name || g?.home?.id || "";
      const away = g?.away?.abbr || g?.away?.name || g?.away?.id || "";
      const matchup = `${away} @ ${home}`.toLowerCase();

      const pickSide = String(g?.market?.pick || "").toLowerCase();
      const isPass = !pickSide;

      const edge = Number(g?.market?.edge);
      const winProb = Number(g?.market?.winProb);
      const conf = Number(g?.market?.confidence);
      const tier = String(g?.market?.tier || "").toUpperCase();

      if (!showPass && isPass) return false;
      if (onlyBets && isPass) return false;

      if (!isPass) {
        if (Number.isFinite(edge) && edge < thresholds.minE) return false;
        if (Number.isFinite(winProb) && winProb < thresholds.minW) return false;
        if (Number.isFinite(conf) && conf < thresholds.minC) return false;
        if (tierNeed && tier !== tierNeed) return false;
      } else {
        if (tierNeed) return false;
      }

      if (needle) return matchup.includes(needle);
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const ae = Number(a?.market?.edge);
      const be = Number(b?.market?.edge);
      const aw = Number(a?.market?.winProb);
      const bw = Number(b?.market?.winProb);
      const ac = Number(a?.market?.confidence);
      const bc = Number(b?.market?.confidence);
      const at = parseTierRank(a?.market?.tier);
      const bt = parseTierRank(b?.market?.tier);

      if (sortBy === "tier") return (bt - at) || ((Number.isFinite(be) ? be : -1) - (Number.isFinite(ae) ? ae : -1));
      if (sortBy === "winProb") return (Number.isFinite(bw) ? bw : -1) - (Number.isFinite(aw) ? aw : -1);
      if (sortBy === "confidence") return (Number.isFinite(bc) ? bc : -1) - (Number.isFinite(ac) ? ac : -1);
      if (sortBy === "time") {
        const atS = String(a?.time || a?.startTime || a?.commence_time || a?.date || "");
        const btS = String(b?.time || b?.startTime || b?.commence_time || b?.date || "");
        return atS.localeCompare(btS);
      }
      return (Number.isFinite(be) ? be : -1) - (Number.isFinite(ae) ? ae : -1);
    });

    return sorted;
  }, [games, q, tierFilter, onlyBets, showPass, sortBy, thresholds]);

  const betsCount = useMemo(() => viewGames.filter((g) => Boolean(g?.market?.pick)).length, [viewGames]);

  const summary = useMemo(() => {
    const bets = viewGames.filter((g) => g?.market?.pick);
    const edges = bets.map((g) => Number(g?.market?.edge)).filter((x) => Number.isFinite(x));
    const avgEdge = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : null;
    return {
      games: viewGames.length,
      bets: bets.length,
      avgEdge,
    };
  }, [viewGames]);

  const warnings = useMemo(() => {
    const arr = Array.isArray(meta?.warnings) ? meta.warnings : [];
    return arr.map(normalizeWarningText).filter(Boolean);
  }, [meta?.warnings]);

  function onClickRefresh() {
    try {
      Object.keys(sessionStorage).forEach((k) => {
        if (k.startsWith("predictions:")) sessionStorage.removeItem(k);
      });
    } catch {
      // ignore
    }
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title-row">
          <h1>Predict</h1>
          <div className="page-actions">
            <Link className="btn btn-ghost" to="/">
              Home
            </Link>
            <button className="btn" onClick={onClickRefresh} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>

        <div className="subtle">
          <span className="mono">API:</span> {meta?.model || "—"}
          {meta?.elapsedMs != null ? <span> · <span className="mono">{meta.elapsedMs}ms</span></span> : null}
          {" · "}
          Showing <span className="mono">{summary.games}</span> games · <span className="mono">{summary.bets}</span> bets
          {summary.avgEdge != null ? (
            <span>
              {" · "}Avg edge <span className="mono">{summary.avgEdge >= 0 ? "+" : ""}{fmtNum(summary.avgEdge, 3)}</span>
            </span>
          ) : null}
        </div>

        {warnings.length ? (
          <div className="banner bannerWarn" style={{ marginTop: 10 }}>
            <div className="bannerTitle">Upstream warning</div>
            <div className="bannerBody">
              {warnings[0]}
              {warnings.length > 1 ? <div style={{ marginTop: 6 }} className="subtle">+{warnings.length - 1} more</div> : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Controls */}
      <div className="card">
        <div className="toolbar">
          <div className="toolbar-row">
            <label className="field">
              <span>League</span>
              <select value={league} onChange={(e) => setLeague(String(e.target.value).toLowerCase())}>
                <option value="nba">NBA</option>
                <option value="ncaam">NCAAM</option>
                <option value="nhl">NHL</option>
              </select>
            </label>

            <label className="field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>

            <label className="field">
              <span>Window</span>
              <input
                type="number"
                min={league === "ncaam" ? 14 : 3}
                max={league === "nhl" ? 120 : league === "ncaam" ? 90 : 30}
                value={windowDays}
                onChange={(e) => setWindowDays(clamp(e.target.value, 3, 120))}
              />
            </label>

            {league === "nba" ? (
              <label className="field">
                <span>Model</span>
                <select value={modelVersion} onChange={(e) => setModelVersion(e.target.value)}>
                  <option value="v2">v2 (premium)</option>
                  <option value="v1">v1 (legacy)</option>
                </select>
              </label>
            ) : (
              <div className="field" />
            )}

            {league === "ncaam" ? (
              <label className="field inline">
                <span>&nbsp;</span>
                <div className="inline-toggle">
                  <input id="tournament" type="checkbox" checked={tournament} onChange={(e) => setTournament(e.target.checked)} />
                  <label htmlFor="tournament">Tournament mode</label>
                </div>
              </label>
            ) : (
              <div className="field" />
            )}
          </div>

          <div className="toolbar-row">
            <label className="field wide">
              <span>Search</span>
              <input placeholder="Team (e.g. BOS, Duke)…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>

            <label className="field">
              <span>Min Edge</span>
              <input type="number" step="0.01" min="0" max="0.25" value={minEdge} onChange={(e) => setMinEdge(e.target.value)} />
            </label>

            <label className="field">
              <span>Min WinProb</span>
              <input type="number" step="0.01" min="0" max="1" value={minWinProb} onChange={(e) => setMinWinProb(e.target.value)} />
            </label>

            <label className="field">
              <span>Min Conf</span>
              <input type="number" step="0.01" min="0" max="1" value={minConf} onChange={(e) => setMinConf(e.target.value)} />
            </label>

            <label className="field">
              <span>Tier</span>
              <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
                <option value="">All</option>
                <option value="LEAN">LEAN</option>
                <option value="EDGE">EDGE</option>
                <option value="STRONG">STRONG</option>
                <option value="ELITE">ELITE</option>
              </select>
            </label>

            <label className="field">
              <span>Sort</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="edge">Edge</option>
                <option value="tier">Tier</option>
                <option value="winProb">WinProb</option>
                <option value="confidence">Confidence</option>
                <option value="time">Time</option>
              </select>
            </label>
          </div>

          <div className="toolbar-row">
            <label className="pill">
              <input type="checkbox" checked={onlyBets} onChange={(e) => setOnlyBets(e.target.checked)} />
              <span>Only Bets</span>
            </label>

            <label className="pill">
              <input type="checkbox" checked={showPass} onChange={(e) => setShowPass(e.target.checked)} />
              <span>Show PASS</span>
            </label>

            <label className="pill">
              <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
              <span>Debug</span>
            </label>

            <div className="subtle">
              Showing <span className="mono">{viewGames.length}</span> games · <span className="mono">{betsCount}</span> bets
            </div>
          </div>
        </div>
      </div>

      {/* Status */}
      {err ? (
        <div className="card danger">
          <div className="mono pre">{err}</div>
        </div>
      ) : null}

      {loading ? (
        <div className="card">
          <div className="subtle">Loading…</div>
        </div>
      ) : null}

      {!loading && !err && viewGames.length === 0 ? (
        <div className="card">
          <div className="subtle">No games match your filters. Try lowering Min Edge / Min WinProb or toggling “Show PASS”.</div>
        </div>
      ) : null}

      {/* Games */}
      <div className="grid">
        {viewGames.map((g) => {
          const home = g?.home || {};
          const away = g?.away || {};
          const status = g?.status || "";
          const pick = g?.market?.pick || null;
          const tier = g?.market?.tier || "PASS";
          const edge = Number(g?.market?.edge);
          const winProb = Number(g?.market?.winProb);
          const conf = Number(g?.market?.confidence);

          const matchup = `${away?.abbr || away?.name || "AWAY"} @ ${home?.abbr || home?.name || "HOME"}`;
          const headline = g?.why?.headline || (pick ? "Value" : "PASS");
          const bullets = Array.isArray(g?.why?.bullets) ? g.why.bullets : [];
          const deltas = Array.isArray(g?.why?.deltas) ? g.why.deltas : [];

          return (
            <div className="card game" key={g?.gameId || matchup}>
              <div className="game-top">
                <div className="game-main">
                  <div className="game-matchup">{matchup}</div>
                  <div className="subtle">
                    {status ? <span>{status}</span> : null}
                    {g?.homeScore != null || g?.awayScore != null ? (
                      <span>
                        {" "}
                        · <span className="mono">{away?.score ?? g?.awayScore ?? "—"}</span>–
                        <span className="mono">{home?.score ?? g?.homeScore ?? "—"}</span>
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="game-badges">
                  <span className={badgeClassForTier(tier)}>{safeUpper(tier || "PASS")}</span>
                </div>
              </div>

              <div className="game-metrics">
                <div className="metric">
                  <div className="k">Pick</div>
                  <div className="v">{pick ? safeUpper(pick) : "PASS"}</div>
                </div>

                <div className="metric">
                  <div className="k">Edge</div>
                  <div className="v">{Number.isFinite(edge) ? `+${fmtNum(edge, 3)}` : "—"}</div>
                </div>

                <div className="metric">
                  <div className="k">WinProb</div>
                  <div className="v">{Number.isFinite(winProb) ? fmtPct(winProb, 1) : "—"}</div>
                </div>

                <div className="metric">
                  <div className="k">Conf</div>
                  <div className="v">{Number.isFinite(conf) ? fmtPct(conf, 0) : "—"}</div>
                </div>
              </div>

              <div className="why">
                <div className="why-head">{headline}</div>
                {bullets.length ? (
                  <ul className="why-bullets">
                    {bullets.slice(0, 6).map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="subtle">No explanation available.</div>
                )}
              </div>

              {(deltas.length > 0 || debug) ? (
                <details className="details">
                  <summary>Details</summary>

                  {deltas.length ? (
                    <div className="deltas">
                      {deltas.slice(0, 10).map((d, i) => (
                        <div className="delta" key={i}>
                          <div className="k">{d?.label}</div>
                          <div className="v mono">{d?.display ?? "—"}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {debug ? (
                    <pre className="mono pre">
                      {JSON.stringify({ gameId: g?.gameId, market: g?.market, factors: g?.factors, meta: payload?.meta }, null, 2)}
                    </pre>
                  ) : null}
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}