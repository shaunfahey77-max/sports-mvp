// apps/api/src/routes/performance.js
import express from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = express.Router();

const DEFAULT_DAYS = 180;
const MAX_DAYS = 365;
const MULTI_LEAGUE_MAX_DAYS = 365;

const PERF_CACHE_TTL_MS = 15_000;
const perfCache = new Map();

function getPerfCache(key) {
  const hit = perfCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > PERF_CACHE_TTL_MS) {
    perfCache.delete(key);
    return null;
  }
  return hit.value;
}

function setPerfCache(key, value) {
  perfCache.set(key, { time: Date.now(), value });
  if (perfCache.size > 80) {
    const entries = [...perfCache.entries()].sort((a, b) => a[1].time - b[1].time);
    for (let i = 0; i < Math.min(15, entries.length); i++) perfCache.delete(entries[i][0]);
  }
}


function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function yyyymmddUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function addDaysUTC(dateYYYYMMDD, deltaDays) {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return yyyymmddUTC(dt);
}

function parseLeaguesParam(v) {
  const raw = String(v || "").trim();
  if (!raw) return ["nba", "nhl", "ncaam"];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const DAILY_PICKS_TABLE_CANDIDATES = [
  process.env.DAILY_PICKS_TABLE || "daily_picks",
  "picks_daily",
].filter((v, i, arr) => arr.indexOf(v) === i);

async function fetchFromFirstAvailableTable(buildQuery) {
  let lastError = null;

  for (const table of DAILY_PICKS_TABLE_CANDIDATES) {
    const { data, error } = await buildQuery(table);
    if (!error) return { table, data };
    lastError = error;
  }

  throw new Error(`daily picks fetch failed: ${lastError?.message || "unknown error"}`);
}

async function fetchPerformanceDaily(leagues, start, end) {
  const { data, error } = await supabaseAdmin
    .from("performance_daily")
    .select("league,date,games,pass,completed,updated_at")
    .in("league", leagues)
    .gte("date", start)
    .lte("date", end);

  if (error) throw new Error(`performance_daily fetch failed: ${error.message}`);

  const byKey = new Map();
  for (const r of data || []) {
    byKey.set(`${r.league}:${r.date}`, r);
  }
  return byKey;
}

async function fetchPickResults(leagues, start, end) {
  const { table, data } = await fetchFromFirstAvailableTable((tableName) =>
    supabaseAdmin
      .from(tableName)
      .select("league,date,market,result,odds,clv_line_delta,clv_implied_delta")
      .in("league", leagues)
      .gte("date", start)
      .lte("date", end)
  );

  const byKey = new Map();
  const byMarket = {
    moneyline: { wins: 0, losses: 0, pushes: 0, scored: 0, winRate: null, avg_clv_line: null, avg_clv_implied: null, _clvLineSum: 0, _clvLineN: 0, _clvImpSum: 0, _clvImpN: 0 },
    spread: { wins: 0, losses: 0, pushes: 0, scored: 0, winRate: null, avg_clv_line: null, avg_clv_implied: null, _clvLineSum: 0, _clvLineN: 0, _clvImpSum: 0, _clvImpN: 0 },
    total: { wins: 0, losses: 0, pushes: 0, scored: 0, winRate: null, avg_clv_line: null, avg_clv_implied: null, _clvLineSum: 0, _clvLineN: 0, _clvImpSum: 0, _clvImpN: 0 },
  };

  for (const r of data || []) {
    const key = `${r.league}:${r.date}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        picks: 0, wins: 0, losses: 0, pushes: 0, pass: 0, scored: 0,
        avg_clv_line: null, avg_clv_implied: null,
        _clvLineSum: 0, _clvLineN: 0, _clvImpSum: 0, _clvImpN: 0,
      });
    }
    const row = byKey.get(key);

    const result = String(r.result || "").toUpperCase();
    const market = String(r.market || "moneyline").toLowerCase();
    const clvLine = num(r.clv_line_delta);
    const clvImp = num(r.clv_implied_delta);

    if (result === "WIN") {
      row.picks += 1;
      row.wins += 1;
      row.scored += 1;
      if (byMarket[market]) {
        byMarket[market].wins += 1;
        byMarket[market].scored += 1;
      }
    } else if (result === "LOSS") {
      row.picks += 1;
      row.losses += 1;
      row.scored += 1;
      if (byMarket[market]) {
        byMarket[market].losses += 1;
        byMarket[market].scored += 1;
      }
    } else if (result === "PUSH") {
      row.picks += 1;
      row.pushes += 1;
      row.scored += 1;
      if (byMarket[market]) {
        byMarket[market].pushes += 1;
        byMarket[market].scored += 1;
      }
    } else if (result === "PASS") {
      row.pass += 1;
    }

    if (clvLine != null) {
      row._clvLineSum += clvLine;
      row._clvLineN += 1;
      if (byMarket[market]) {
        byMarket[market]._clvLineSum += clvLine;
        byMarket[market]._clvLineN += 1;
      }
    }

    if (clvImp != null) {
      row._clvImpSum += clvImp;
      row._clvImpN += 1;
      if (byMarket[market]) {
        byMarket[market]._clvImpSum += clvImp;
        byMarket[market]._clvImpN += 1;
      }
    }
  }

  for (const row of byKey.values()) {
    row.avg_clv_line = row._clvLineN ? row._clvLineSum / row._clvLineN : null;
    row.avg_clv_implied = row._clvImpN ? row._clvImpSum / row._clvImpN : null;
  }

  for (const k of Object.keys(byMarket)) {
    const m = byMarket[k];
    m.winRate = m.scored ? m.wins / m.scored : null;
    m.avg_clv_line = m._clvLineN ? m._clvLineSum / m._clvLineN : null;
    m.avg_clv_implied = m._clvImpN ? m._clvImpSum / m._clvImpN : null;
    delete m._clvLineSum;
    delete m._clvLineN;
    delete m._clvImpSum;
    delete m._clvImpN;
  }

  return { byKey, byMarket, sourceTable: table };
}

async function fetchPerformanceWindow(days = 14, leagues = ["nba", "nhl", "ncaam"]) {
  const end = yyyymmddUTC(new Date());
  const start = addDaysUTC(end, -(days - 1));

  const perfByKey = await fetchPerformanceDaily(leagues, start, end);
  const { byKey: picksByKey } = await fetchPickResults(leagues, start, end);

  const rows = [];

  let cur = start;
  while (cur <= end) {
    for (const league of leagues) {
      const perf = perfByKey.get(`${league}:${cur}`) || null;
      const picks = picksByKey.get(`${league}:${cur}`) || null;
      if (!perf && !picks) continue;

      const wins = picks?.wins ?? 0;
      const losses = picks?.losses ?? 0;
      const scored = picks?.scored ?? 0;

      rows.push({
        date: cur,
        league,
        picks: picks?.picks ?? 0,
        wins,
        losses,
        pass: Math.max(perf?.pass ?? 0, picks?.pass ?? 0),
        scored,
        acc: scored > 0 ? wins / scored : null,
        avg_clv_line: picks?.avg_clv_line ?? null,
        avg_clv_implied: picks?.avg_clv_implied ?? null,
      });
    }
    cur = addDaysUTC(cur, 1);
  }

  return rows;
}

router.get("/performance", async (req, res) => {
  const leagues = parseLeaguesParam(req.query.leagues);
  const requestedDays = clamp(Number(req.query.days || DEFAULT_DAYS), 1, MAX_DAYS);
  const days = leagues.length > 1 ? Math.min(requestedDays, MULTI_LEAGUE_MAX_DAYS) : requestedDays;

  const cacheKey = `perf:v2:days=${days}:leagues=${leagues.join(",")}`;
  const cached = getPerfCache(cacheKey);
  if (cached) return res.json(cached);

  const startedAt = Date.now();

  try {
    const end = yyyymmddUTC(new Date());
    const start = addDaysUTC(end, -(days - 1));

    const dates = [];
    let cur = start;
    while (cur <= end) {
      dates.push(cur);
      cur = addDaysUTC(cur, 1);
    }

    const perfByKey = await fetchPerformanceDaily(leagues, start, end);
    const { byKey: picksByKey, byMarket, sourceTable } = await fetchPickResults(leagues, start, end);

    const rows = Object.fromEntries(leagues.map((l) => [l, []]));
    let missingCount = 0;

    for (const league of leagues) {
      rows[league] = dates.map((date) => {
        const perf = perfByKey.get(`${league}:${date}`) || null;
        const picks = picksByKey.get(`${league}:${date}`) || null;

        if (!perf && !picks) {
          missingCount++;
          return {
            date,
            games: 0,
            picks: 0,
            pass: 0,
            completed: 0,
            wins: 0,
            losses: 0,
            scored: 0,
            acc: null,
            error: "missing_db_row",
            updated_at: null,
          };
        }

        const wins = picks?.wins ?? 0;
        const losses = picks?.losses ?? 0;
        const scored = picks?.scored ?? 0;
        const pass = Math.max(perf?.pass ?? 0, picks?.pass ?? 0);
        const totalPicks = picks?.picks ?? 0;

        return {
          date,
          games: perf?.games ?? 0,
          picks: totalPicks,
          pass,
          completed: perf?.completed ?? 0,
          wins,
          losses,
          scored,
          acc: scored > 0 ? wins / scored : null,
          error: null,
          updated_at: perf?.updated_at ?? null,
        };
      });
    }

    const payload = {
      ok: true,
      start,
      end,
      leagues,
      meta: {
        source: `supabase:${sourceTable}+performance_daily`,
        elapsedMs: Date.now() - startedAt,
        requestedDays,
        effectiveDays: days,
        missingCount,
        partial: missingCount > 0,
      },
      rows,
      byMarket,
    };

    setPerfCache(cacheKey, payload);
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


router.get("/performance/kpis", async (_req, res) => {
  try {
    const rows = await fetchPerformanceWindow(14, ["nba", "nhl", "ncaam"]);
    const picks = rows.reduce((a, r) => a + (num(r.picks) || 0), 0);
    const wins = rows.reduce((a, r) => a + (num(r.wins) || 0), 0);
    const losses = rows.reduce((a, r) => a + (num(r.losses) || 0), 0);
    const pass = rows.reduce((a, r) => a + (num(r.pass) || 0), 0);
    const scored = rows.reduce((a, r) => a + (num(r.scored) || 0), 0);

    const clvRows = rows.filter((r) => num(r.avg_clv_line) != null);
    const clvImpRows = rows.filter((r) => num(r.avg_clv_implied) != null);

    const avg_clv_line = clvRows.length
      ? clvRows.reduce((a, r) => a + num(r.avg_clv_line), 0) / clvRows.length
      : null;

    const avg_clv_implied = clvImpRows.length
      ? clvImpRows.reduce((a, r) => a + num(r.avg_clv_implied), 0) / clvImpRows.length
      : null;

    return res.json({
      ok: true,
      data: {
        picks,
        wins,
        losses,
        pass,
        scored,
        acc: scored > 0 ? wins / scored : null,
        avg_clv_line,
        avg_clv_implied,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get("/performance/league", async (_req, res) => {
  try {
    const rows = await fetchPerformanceWindow(14, ["nba", "nhl", "ncaam"]);
    const bucket = new Map();

    for (const row of rows) {
      const lg = String(row.league || "").toLowerCase();
      if (!bucket.has(lg)) {
        bucket.set(lg, {
          league: lg,
          picks: 0,
          wins: 0,
          losses: 0,
          pass: 0,
          scored: 0,
          _clvLineSum: 0,
          _clvLineN: 0,
          _clvImpSum: 0,
          _clvImpN: 0,
        });
      }
      const cur = bucket.get(lg);
      cur.picks += num(row.picks) || 0;
      cur.wins += num(row.wins) || 0;
      cur.losses += num(row.losses) || 0;
      cur.pass += num(row.pass) || 0;
      cur.scored += num(row.scored) || 0;

      const clvLine = num(row.avg_clv_line);
      const clvImp = num(row.avg_clv_implied);
      if (clvLine != null) {
        cur._clvLineSum += clvLine;
        cur._clvLineN += 1;
      }
      if (clvImp != null) {
        cur._clvImpSum += clvImp;
        cur._clvImpN += 1;
      }
    }

    const data = [...bucket.values()].map((x) => ({
      league: x.league,
      picks: x.picks,
      wins: x.wins,
      losses: x.losses,
      pass: x.pass,
      scored: x.scored,
      acc: x.scored > 0 ? x.wins / x.scored : null,
      avg_clv_line: x._clvLineN ? x._clvLineSum / x._clvLineN : null,
      avg_clv_implied: x._clvImpN ? x._clvImpSum / x._clvImpN : null,
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get("/performance/recent", async (_req, res) => {
  try {
    const data = await fetchPerformanceWindow(14, ["nba", "nhl", "ncaam"]);
    data.sort((a, b) => {
      if (a.date === b.date) return String(a.league).localeCompare(String(b.league));
      return String(b.date).localeCompare(String(a.date));
    });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;
