// apps/web/src/pages/Home.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import DailyPicks from "../components/DailyPicks.jsx";

/* =========================
   Date helpers (UTC-safe)
   ========================= */
function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function addDaysUTC(ymd, deltaDays) {
  const [y, m, d] = String(ymd).split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
  return dt.toISOString().slice(0, 10);
}

function daysRangeUTC(endYMD, days) {
  const out = [];
  const n = Math.max(1, Number(days || 1));
  const start = addDaysUTC(endYMD, -(n - 1));
  for (let i = 0; i < n; i++) out.push(addDaysUTC(start, i));
  return out;
}

function pct(n, digits = 0) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

/* =========================
   Fetch helper (timeout + JSON)
   ========================= */
async function fetchJson(url, { signal, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const txt = await res.text().catch(() => "");
    let json = null;

    try {
      json = txt ? JSON.parse(txt) : null;
    } catch {
      const err = new Error(`Bad JSON from API (HTTP ${res.status})`);
      err.status = res.status;
      err._raw = txt?.slice?.(0, 250);
      throw err;
    }

    if (!res.ok) {
      const err = new Error(json?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/* =========================
   Model utils
   ========================= */
function tierCounts(games = []) {
  const out = { picks: 0, ELITE: 0, STRONG: 0, EDGE: 0, LEAN: 0, PASS: 0 };
  for (const g of games) {
    const pick = g?.market?.pick ? 1 : 0;
    if (pick) out.picks++;
    const t = String(g?.market?.tier || (pick ? "LEAN" : "PASS")).toUpperCase();
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}

function sumPerf(rows = []) {
  const picks = rows.reduce((a, r) => a + (Number(r.picks) || 0), 0);
  const wins = rows.reduce((a, r) => a + (Number(r.wins) || 0), 0);
  const losses = rows.reduce((a, r) => a + (Number(r.losses) || 0), 0);
  const pushes = rows.reduce((a, r) => a + (Number(r.pushes) || 0), 0);
  const scored = rows.reduce((a, r) => a + (Number(r.scored) || 0), 0);
  const denom = wins + losses;
  return { picks, wins, losses, pushes, scored, winRate: denom ? wins / denom : null };
}

function missingDates(rows = []) {
  return rows
    .filter((r) => String(r?.error || "") && String(r.error) !== "null" && String(r.error) !== "undefined")
    .map((r) => r.date)
    .filter(Boolean);
}

/* =========================
   UI helpers
   ========================= */
function Banner({ tone = "info", title, children }) {
  const cls = tone === "danger" ? "banner bannerDanger" : tone === "warn" ? "banner bannerWarn" : "banner";
  return (
    <div className={cls}>
      <div className="bannerTitle">{title}</div>
      <div className="bannerBody">{children}</div>
    </div>
  );
}

function SnapshotCard({ title, subtitle, loading, error, meta, counts, href }) {
  return (
    <Link className="card game" to={href} style={{ textDecoration: "none" }}>
      <div className="game-top">
        <div className="game-main">
          <div className="game-matchup">{title}</div>
          <div className="subtle">{subtitle}</div>
        </div>
        <div className="game-badges">
          {loading ? <span className="badge">LOADING</span> : null}
          {error ? <span className="badge badge-bad">ERROR</span> : <span className="badge badge-ok">OK</span>}
        </div>
      </div>

      {error ? (
        <div className="subtle pre" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <div className="subtle" style={{ marginTop: 10 }}>
            <span className="mono">{meta?.model || "—"}</span>
            {meta?.elapsedMs != null ? <span> · {meta.elapsedMs}ms</span> : null}
          </div>

          <div className="game-metrics" style={{ marginTop: 10 }}>
            <div className="metric">
              <div className="k">Games</div>
              <div className="v mono">{meta?.count ?? "—"}</div>
            </div>
            <div className="metric">
              <div className="k">Picks</div>
              <div className="v mono">{counts?.picks ?? "—"}</div>
            </div>
            <div className="metric">
              <div className="k">ELITE</div>
              <div className="v mono">{counts?.ELITE ?? 0}</div>
            </div>
            <div className="metric">
              <div className="k">STRONG</div>
              <div className="v mono">{counts?.STRONG ?? 0}</div>
            </div>
          </div>
        </>
      ) : null}
    </Link>
  );
}

function PerformancePanel({ days, setDays, perf, onRefresh }) {
  const nba = perf?.rows?.nba || [];
  const ncaam = perf?.rows?.ncaam || [];
  const nhl = perf?.rows?.nhl || [];

  const nbaS = sumPerf(nba);
  const ncaamS = sumPerf(ncaam);
  const nhlS = sumPerf(nhl);

  const nbaMissing = missingDates(nba);
  const ncaamMissing = missingDates(ncaam);
  const nhlMissing = missingDates(nhl);

  const NHL_BREAK_FROM = "2026-02-05";
  const NHL_BREAK_TO = "2026-02-24";

  const anyMissing = (perf?.meta?.missingCount || 0) > 0;

  return (
    <div className="card">
      <div className="panelHead">
        <div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Performance</div>
          <div className="subtle">Supabase (performance_daily) — last {days} days</div>
        </div>

        <div className="actions">
          <div className="seg segSmall">
            {[7, 14, 30].map((d) => (
              <button key={d} className={`segBtn ${days === d ? "isOn" : ""}`} onClick={() => setDays(d)}>
                {d}d
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>

      {perf?.meta ? (
        <div className="subtle">
          source: <span className="mono">{perf.meta.source}</span>
          {" · "}missing: <span className="mono">{perf.meta.missingCount}</span>
          {perf.meta.partial ? " · partial=true" : ""}
          {" · "}elapsed: <span className="mono">{perf.meta.elapsedMs}ms</span>
        </div>
      ) : null}

      <div className="divider" />

      <Banner tone="info" title="NHL Olympic break">
        NHL is paused from <span className="mono">{NHL_BREAK_FROM}</span> → <span className="mono">{NHL_BREAK_TO}</span>.
        We still show last {days} days of performance rows (scored picks + record).
      </Banner>

      {anyMissing ? (
        <Banner tone="warn" title="Missing performance rows in range">
          Missing rows usually means scoring wasn’t run for those dates yet. Use <b>Run Scoring</b> (or Backfill 30d) below,
          then refresh after ~2–5 seconds (Supabase write latency).
        </Banner>
      ) : null}

      <div className="kpiGrid">
        <div className="kpi">
          <div className="kpiLabel">NBA win rate</div>
          <div className="kpiValue mono">{pct(nbaS.winRate)}</div>
          <div className="kpiFoot mono">
            {nbaS.wins}-{nbaS.losses}-{nbaS.pushes} · picks {nbaS.picks} · scored {nbaS.scored}
          </div>
          {nbaMissing.length ? (
            <div className="kpiFoot">
              Missing: <span className="mono">{nbaMissing.join(", ")}</span>
            </div>
          ) : null}
        </div>

        <div className="kpi">
          <div className="kpiLabel">NCAAM win rate</div>
          <div className="kpiValue mono">{pct(ncaamS.winRate)}</div>
          <div className="kpiFoot mono">
            {ncaamS.wins}-{ncaamS.losses}-{ncaamS.pushes} · picks {ncaamS.picks} · scored {ncaamS.scored}
          </div>
          {ncaamMissing.length ? (
            <div className="kpiFoot">
              Missing: <span className="mono">{ncaamMissing.join(", ")}</span>
            </div>
          ) : null}
        </div>

        <div className="kpi">
          <div className="kpiLabel">NHL win rate</div>
          <div className="kpiValue mono">{pct(nhlS.winRate)}</div>
          <div className="kpiFoot mono">
            {nhlS.wins}-{nhlS.losses}-{nhlS.pushes} · picks {nhlS.picks} · scored {nhlS.scored}
          </div>
          {nhlMissing.length ? (
            <div className="kpiFoot">
              Missing: <span className="mono">{nhlMissing.join(", ")}</span>
            </div>
          ) : null}
        </div>

        <div className="kpi">
          <div className="kpiLabel">Data health</div>
          <div className="kpiValue mono">{perf?.meta?.missingCount ?? "—"}</div>
          <div className="kpiFoot">Missing DB rows in range</div>
          <div className="kpiFoot subtle">If you just ran scoring, refresh after ~2–5s.</div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Scoring Console (premium)
   ========================= */
function ScoreConsole({
  today,
  requestedDate,
  setRequestedDate,
  leagues,
  setLeagues,
  running,
  onRun,
  result,
  error,
  backfill,
  onBackfill30,
  onCancelBackfill,
}) {
  const resultsArr = Array.isArray(result?.results) ? result.results : [];
  const ranLeagues = Array.isArray(result?.leagues) ? result.leagues : [];

  const backfillPct = backfill?.total ? Math.round((backfill.done / backfill.total) * 100) : 0;

  return (
    <div className="card">
      <div className="panelHead">
        <div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Run Scoring</div>
          <div className="subtle">
            Forces scoring + grading writes for NBA / NCAAM / NHL for a specific date (NHL will be 0 games during break).
          </div>
        </div>

        <div className="actions" style={{ flexWrap: "wrap" }}>
          <button className="btn btnPrimary" onClick={onRun} disabled={running || backfill?.running}>
            {running ? "Running…" : "Run Scoring for date"}
          </button>

          <button className="btn btn-ghost" onClick={onBackfill30} disabled={running || backfill?.running}>
            {backfill?.running ? "Backfilling…" : "Backfill last 30 days"}
          </button>

          {backfill?.running ? (
            <button className="btn btn-ghost" onClick={onCancelBackfill}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="divider" />

      <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="metric" style={{ gap: 6 }}>
          <div className="k">Date</div>
          <input
            className="input"
            type="date"
            value={requestedDate}
            onChange={(e) => setRequestedDate(e.target.value)}
            max={today}
            style={{ width: "100%" }}
          />
          <div className="subtle">Use this to backfill day-by-day.</div>
        </div>

        <div className="metric" style={{ gap: 6 }}>
          <div className="k">Leagues</div>
          <select className="input" value={leagues} onChange={(e) => setLeagues(e.target.value)} style={{ width: "100%" }}>
            <option value="nba,ncaam,nhl">nba,ncaam,nhl</option>
            <option value="nba,ncaam">nba,ncaam</option>
            <option value="nba">nba</option>
            <option value="ncaam">ncaam</option>
            <option value="nhl">nhl</option>
          </select>
          <div className="subtle">What to attempt for scoring.</div>
        </div>

        <div className="metric" style={{ gap: 6 }}>
          <div className="k">Note</div>
          <div className="subtle">
            If <span className="mono">completed=0</span>, the slate has no finals yet — grading stays 0.
          </div>
        </div>
      </div>

      {backfill?.running ? (
        <div style={{ marginTop: 10 }}>
          <Banner tone="info" title="Backfill running">
            <div className="subtle" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span>
                Progress: <span className="mono">{backfill.done}</span>/<span className="mono">{backfill.total}</span> (
                <span className="mono">{backfillPct}%</span>)
              </span>
              {backfill.currentDate ? (
                <span>
                  Current date: <span className="mono">{backfill.currentDate}</span>
                </span>
              ) : null}
            </div>
            {backfill.lastError ? (
              <div className="subtle pre" style={{ marginTop: 8 }}>
                Last error: {backfill.lastError}
              </div>
            ) : null}
          </Banner>
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 10 }}>
          <Banner tone="danger" title="Scoring failed">
            <div className="pre subtle">{error}</div>
          </Banner>
        </div>
      ) : null}

      {result ? (
        <div style={{ marginTop: 10 }}>
          <Banner tone="info" title="Scoring complete">
            <div className="subtle" style={{ marginBottom: 8 }}>
              ranFor: <span className="mono">{result?.ranFor || requestedDate}</span>
              {" · "}requested: <span className="mono">{leagues}</span>
              {" · "}ran: <span className="mono">{ranLeagues.join(", ") || "—"}</span>
              {" · "}scoredGames: <span className="mono">{result?.scoredGames ?? "—"}</span>
            </div>

            {resultsArr.length ? (
              <>
                <div className="divider" />
                <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  {resultsArr.map((r, idx) => {
                    const counts = r?.report?.counts || {};
                    const metrics = r?.report?.metrics || {};
                    const isOk = !!r?.ok;
                    return (
                      <div key={`${r?.league || "league"}-${idx}`} className="card" style={{ padding: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontWeight: 900 }}>{String(r?.league || "league").toUpperCase()}</div>
                          <span className={`pill ${isOk ? "badge-ok" : "badge-bad"}`}>{isOk ? "OK" : "ERROR"}</span>
                        </div>

                        <div className="subtle" style={{ marginTop: 8 }}>
                          input: <span className="mono">{counts.inputGames ?? 0}</span>
                          {" · "}completed: <span className="mono">{counts.completed ?? 0}</span>
                        </div>

                        <div className="subtle" style={{ marginTop: 6 }}>
                          picks: <span className="mono">{counts.picks ?? 0}</span>
                          {" · "}graded: <span className="mono">{counts.graded ?? 0}</span>
                        </div>

                        <div className="subtle" style={{ marginTop: 6 }}>
                          W-L-P:{" "}
                          <span className="mono">
                            {counts.wins ?? 0}-{counts.losses ?? 0}-{counts.pushes ?? 0}
                          </span>
                          {" · "}winRate: <span className="mono">{pct(metrics.winRate, 0)}</span>
                        </div>

                        {r?.report?.error ? (
                          <div className="subtle pre" style={{ marginTop: 8 }}>
                            {r.report.error}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </Banner>
        </div>
      ) : null}
    </div>
  );
}

export default function Home() {
  const date = todayUTCYYYYMMDD();

  const [api, setApi] = useState({ ok: null, version: "", time: "" });

  const [nba, setNba] = useState({ loading: true, error: "", meta: null, counts: null });
  const [ncaam, setNcaam] = useState({ loading: true, error: "", meta: null, counts: null });

  const [days, setDays] = useState(30);
  const [perf, setPerf] = useState({ loading: true, error: "", data: null });

  const [runDate, setRunDate] = useState(date);
  const [runLeagues, setRunLeagues] = useState("nba,ncaam,nhl");
  const [scoreRun, setScoreRun] = useState({ running: false, error: "", result: null });

  const [backfill, setBackfill] = useState({
    running: false,
    done: 0,
    total: 0,
    currentDate: "",
    lastError: "",
  });
  const backfillCancelRef = useRef(false);

  const abortRef = useRef(null);
  const refreshTimerRef = useRef(null);

  const loadHealth = useCallback(() => {
    fetchJson("/api/health", { timeoutMs: 8000 })
      .then((j) => setApi({ ok: true, version: j?.version || "", time: j?.time || "" }))
      .catch(() => setApi({ ok: false, version: "", time: "" }));
  }, []);

  const loadSnapshots = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setNba({ loading: true, error: "", meta: null, counts: null });
    setNcaam({ loading: true, error: "", meta: null, counts: null });

    (async () => {
      try {
        const nbaUrl = `/api/predictions?league=nba&date=${date}&windowDays=14&model=v2`;
        const ncaamUrl = `/api/predictions?league=ncaam&date=${date}&windowDays=45`;

        const [nbaData, ncaamData] = await Promise.all([
          fetchJson(nbaUrl, { signal: controller.signal, timeoutMs: 30000 }),
          fetchJson(ncaamUrl, { signal: controller.signal, timeoutMs: 30000 }),
        ]);

        const nbaGames = Array.isArray(nbaData?.games) ? nbaData.games : [];
        const ncaamGames = Array.isArray(ncaamData?.games) ? ncaamData.games : [];

        setNba({
          loading: false,
          error: "",
          meta: { ...(nbaData?.meta || {}), count: nbaData?.count ?? nbaGames.length },
          counts: tierCounts(nbaGames),
        });

        setNcaam({
          loading: false,
          error: "",
          meta: { ...(ncaamData?.meta || {}), count: ncaamData?.count ?? ncaamGames.length },
          counts: tierCounts(ncaamGames),
        });
      } catch (e) {
        const msg = String(e?.message || e);
        setNba((s) => ({ ...s, loading: false, error: s.error || msg }));
        setNcaam((s) => ({ ...s, loading: false, error: s.error || msg }));
      }
    })();

    return () => controller.abort();
  }, [date]);

  const loadPerformance = useCallback(() => {
    const controller = new AbortController();
    setPerf({ loading: true, error: "", data: null });

    fetchJson(`/api/performance?leagues=nba,ncaam,nhl&days=${days}`, { signal: controller.signal, timeoutMs: 35000 })
      .then((data) => setPerf({ loading: false, error: "", data }))
      .catch((e) => setPerf({ loading: false, error: String(e?.message || e), data: null }));

    return () => controller.abort();
  }, [days]);

  const refreshAll = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    loadHealth();
    loadSnapshots();
    loadPerformance();
  }, [loadHealth, loadSnapshots, loadPerformance]);

  useEffect(() => {
    loadHealth();
    loadSnapshots();
    loadPerformance();

    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [loadHealth, loadSnapshots, loadPerformance]);

  useEffect(() => {
    setRunDate((d) => d || date);
  }, [date]);

  const runScoringForDate = useCallback(async () => {
    if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(runDate))) {
      setScoreRun({ running: false, error: "Missing or invalid date (YYYY-MM-DD).", result: null });
      return;
    }

    setScoreRun({ running: true, error: "", result: null });
    try {
      const url = `/api/admin/run-cron?date=${encodeURIComponent(runDate)}&leagues=${encodeURIComponent(
        runLeagues
      )}&force=1&grade=all`;

      const res = await fetchJson(url, { timeoutMs: 60000 });
      setScoreRun({ running: false, error: "", result: res });

      // immediate refresh + delayed refresh (Supabase write latency)
      refreshAll();
      refreshTimerRef.current = setTimeout(() => refreshAll(), 2500);
    } catch (e) {
      setScoreRun({ running: false, error: String(e?.message || e), result: null });
    }
  }, [runDate, runLeagues, refreshAll]);

  const cancelBackfill = useCallback(() => {
    backfillCancelRef.current = true;
    setBackfill((s) => ({ ...s, running: false, lastError: s.lastError || "Canceled by user." }));
  }, []);

  const backfillLast30 = useCallback(async () => {
    const ok = window.confirm(
      "Backfill last 30 days?\n\nThis will run scoring sequentially for 30 dates and write to Supabase.\nOK to proceed?"
    );
    if (!ok) return;

    backfillCancelRef.current = false;

    const dates = daysRangeUTC(date, 30);
    setBackfill({ running: true, done: 0, total: dates.length, currentDate: "", lastError: "" });

    let done = 0;

    for (const d of dates) {
      if (backfillCancelRef.current) break;

      setBackfill((s) => ({ ...s, running: true, currentDate: d, done, lastError: s.lastError }));

      try {
        const url = `/api/admin/run-cron?date=${encodeURIComponent(d)}&leagues=${encodeURIComponent(
          "nba,ncaam,nhl"
        )}&force=1&grade=all`;

        await fetchJson(url, { timeoutMs: 90000 });
      } catch (e) {
        setBackfill((s) => ({ ...s, lastError: String(e?.message || e) }));
      }

      done += 1;
      setBackfill((s) => ({ ...s, done, running: !backfillCancelRef.current }));
      await new Promise((r) => setTimeout(r, 350));
    }

    setBackfill((s) => ({ ...s, running: false }));
    refreshAll();
    refreshTimerRef.current = setTimeout(() => refreshAll(), 2500);
  }, [date, refreshAll]);

  const apiStatus = api.ok == null ? "Checking…" : api.ok ? "Online" : "Offline";

  const perfUpdatedAt = useMemo(() => {
    const rows = [
      ...(perf?.data?.rows?.nba || []),
      ...(perf?.data?.rows?.ncaam || []),
      ...(perf?.data?.rows?.nhl || []),
    ];
    const ts = rows
      .map((r) => r?.updated_at || r?.updatedAt || null)
      .filter(Boolean)
      .sort()
      .slice(-1)[0];
    return ts || "";
  }, [perf?.data]);

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title-row">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0 }}>Dashboard</h1>
            <span className="pill pillSoft">Premium: value edge + tiers + why panels</span>
          </div>

          <div className="page-actions">
            <Link className="btn" to={`/predict/nba?date=${date}&model=v2&windowDays=14`}>
              Predict
            </Link>
            <Link className="btn btn-ghost" to={`/upsets?date=${date}`}>
              Upset Watch
            </Link>
            <button className="btn btn-ghost" onClick={refreshAll}>
              Refresh
            </button>
          </div>
        </div>

        <div className="subtle">
          API <span className="mono">{apiStatus}</span>
          {api.version ? (
            <span>
              {" "}
              · <span className="mono">{api.version}</span>
            </span>
          ) : null}
          {api.time ? (
            <span>
              {" "}
              · <span className="mono">{api.time}</span>
            </span>
          ) : null}
          {" · "}Date <span className="mono">{date}</span> · NBA model <span className="mono">v2</span> (14d) · NCAAM window{" "}
          <span className="mono">45d</span>
          {perfUpdatedAt ? (
            <span>
              {" "}
              · perf updated <span className="mono">{String(perfUpdatedAt).slice(0, 19).replace("T", " ")}</span>
            </span>
          ) : null}
        </div>

        {api.ok === false ? (
          <Banner tone="danger" title="API offline">
            Your web is up, but the API is not responding. Start API at <span className="mono">127.0.0.1:3001</span>.
          </Banner>
        ) : null}
      </div>

      <DailyPicks date={date} nbaModel="v2" windowNba={14} windowNcaam={45} maxPicksPerLeague={8} />

      <div style={{ height: 12 }} />

      <ScoreConsole
        today={date}
        requestedDate={runDate}
        setRequestedDate={setRunDate}
        leagues={runLeagues}
        setLeagues={setRunLeagues}
        running={scoreRun.running}
        onRun={runScoringForDate}
        result={scoreRun.result}
        error={scoreRun.error}
        backfill={backfill}
        onBackfill30={backfillLast30}
        onCancelBackfill={cancelBackfill}
      />

      <div style={{ height: 12 }} />

      {perf.loading ? (
        <div className="card">
          <div style={{ fontWeight: 900 }}>Loading performance…</div>
          <div className="subtle">Pulling {days} day performance rows.</div>
        </div>
      ) : perf.error ? (
        <div className="card danger">
          <div style={{ fontWeight: 900 }}>Performance error</div>
          <div className="subtle pre">{perf.error}</div>
        </div>
      ) : (
        <PerformancePanel days={days} setDays={setDays} perf={perf.data} onRefresh={loadPerformance} />
      )}

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="panelHead">
          <div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>League Snapshots</div>
            <div className="subtle">Quick sanity check: games, picks, tier distribution, model name, response time.</div>
          </div>
        </div>

        <div className="grid">
          <SnapshotCard
            title="NBA — Premium v2"
            subtitle="Market-style contract: edge/tier/winProb + why"
            loading={nba.loading}
            error={nba.error}
            meta={nba.meta}
            counts={nba.counts}
            href={`/predict/nba?date=${date}&model=v2&windowDays=14`}
          />

          <SnapshotCard
            title="NCAAM — Premium"
            subtitle="ESPN slate + conservative picks"
            loading={ncaam.loading}
            error={ncaam.error}
            meta={ncaam.meta}
            counts={ncaam.counts}
            href={`/predict/ncaam?date=${date}&windowDays=45`}
          />
        </div>

        <div className="subtle" style={{ marginTop: 10 }}>
          NHL resumes <span className="mono">02-24-2026</span> — performance still displays scored picks for the last 30 days during
          the break.
        </div>
      </div>
    </div>
  );
}