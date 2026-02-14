// apps/api/src/routes/performance.js
import express from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = express.Router();

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const MULTI_LEAGUE_MAX_DAYS = 30; // DB is cheap — no need to cap hard anymore

// Small response cache (avoids repeating the same DB query)
const PERF_CACHE_TTL_MS = 15_000;
const perfCache = new Map(); // key -> { time, value }

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
  if (!raw) return ["nba"];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Fetch performance rows from Supabase and index by league:date
 */
async function fetchPerfRowsFromDb(leagues, start, end) {
  const { data, error } = await supabaseAdmin
    .from("performance_daily")
    .select("league,date,games,picks,pass,completed,wins,losses,scored,acc,updated_at")
    .in("league", leagues)
    .gte("date", start)
    .lte("date", end);

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);

  const byKey = new Map();
  for (const r of data || []) byKey.set(`${r.league}:${r.date}`, r);
  return byKey;
}

/**
 * GET /api/performance?days=7&leagues=nba,nhl,ncaam
 *
 * DB-backed, fast, stable.
 * Missing dates return rows with error="missing_db_row"
 */
router.get("/performance", async (req, res) => {
  const leagues = parseLeaguesParam(req.query.leagues);

  const requestedDays = clamp(Number(req.query.days || DEFAULT_DAYS), 1, MAX_DAYS);
  const days = leagues.length > 1 ? Math.min(requestedDays, MULTI_LEAGUE_MAX_DAYS) : requestedDays;

  const cacheKey = `perf:db:v1:days=${days}:leagues=${leagues.join(",")}`;
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

    const byKey = await fetchPerfRowsFromDb(leagues, start, end);

    const rows = Object.fromEntries(leagues.map((l) => [l, []]));

    let missingCount = 0;

    for (const league of leagues) {
      rows[league] = dates.map((date) => {
        const hit = byKey.get(`${league}:${date}`);
        if (hit) {
          return {
            date: hit.date,
            games: hit.games ?? 0,
            picks: hit.picks ?? 0,
            pass: hit.pass ?? 0,
            completed: hit.completed ?? 0,
            wins: hit.wins ?? 0,
            losses: hit.losses ?? 0,
            scored: hit.scored ?? 0,
            acc: typeof hit.acc === "number" ? hit.acc : null,
            error: null,
            updated_at: hit.updated_at ?? null,
          };
        }
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
      });
    }

    const elapsedMs = Date.now() - startedAt;

    const payload = {
      ok: true,
      start,
      end,
      leagues,
      meta: {
        source: "supabase:performance_daily",
        elapsedMs,
        requestedDays,
        effectiveDays: days,
        missingCount,
        partial: missingCount > 0,
      },
      rows,
    };

    setPerfCache(cacheKey, payload);
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
