// legacy/apps/api/src/routes/performance.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ""
).trim();
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();

const PERFORMANCE_TABLE = String(process.env.PERFORMANCE_TABLE || "performance_daily").trim();

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function asInt(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function parseLeagues(raw) {
  const s = String(raw || "").trim();
  if (!s) return ["nba", "nhl", "ncaam"];
  return s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}
function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}
function addDaysUTC(ymd, deltaDays) {
  const [Y, M, D] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(Y, M - 1, D));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}
function makeMissingRow(league, date) {
  return {
    date,
    league,
    games: 0,
    picks: 0,
    completed: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    pass: 0,
    win_rate: null,
    roi: null,
    by_conf: {},
    by_edge: {},
    by_market: {},
    updated_at: null,
    notes: null,
    error: "missing_db_row",
  };
}
function getSupabase() {
  if (!SUPABASE_URL) return null;
  const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!key) return null;

  try {
    return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  } catch {
    return null;
  }
}

router.get("/performance/ping", (_req, res) => {
  res.json({
    ok: true,
    route: "performance",
    table: PERFORMANCE_TABLE,
    hasUrl: Boolean(SUPABASE_URL),
    hasKey: Boolean(SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY),
  });
});

/**
 * GET /api/performance?leagues=nba,nhl,ncaam&days=7|14|30
 *
 * ✅ Premium behavior:
 * - NEVER throws
 * - ALWAYS returns stable shape: rows.{league} is an array
 * - If Supabase missing, returns placeholder rows (so UI still renders)
 */
router.get("/performance", async (req, res) => {
  const t0 = Date.now();
  try {
    const leagues = parseLeagues(req.query.leagues);
    const days = clamp(asInt(req.query.days, 7), 1, 90);

    const end = todayUTCYYYYMMDD();
    const start = addDaysUTC(end, -(days - 1));
    const expectedDates = Array.from({ length: days }, (_, i) => addDaysUTC(start, i));

    const supabase = getSupabase();

    // ✅ DEMO-SAFE: return placeholders instead of crashing
    if (!supabase) {
      const rows = Object.fromEntries(
        leagues.map((lg) => [lg, expectedDates.map((dt) => makeMissingRow(lg, dt))])
      );

      return res.json({
        ok: true,
        meta: {
          source: "supabase:disabled",
          requestedDays: days,
          effectiveDays: days,
          start,
          end,
          missingCount: leagues.length * days,
          partial: true,
          elapsedMs: Date.now() - t0,
          warning:
            "Supabase not configured for /api/performance; returning placeholder rows so UI remains usable.",
        },
        rows,
      });
    }

    const { data, error } = await supabase
      .from(PERFORMANCE_TABLE)
      .select("*")
      .in("league", leagues)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true });

    if (error) {
      // ✅ still demo-safe
      const rows = Object.fromEntries(
        leagues.map((lg) => [lg, expectedDates.map((dt) => makeMissingRow(lg, dt))])
      );

      return res.json({
        ok: true,
        meta: {
          source: `supabase:${PERFORMANCE_TABLE}:error`,
          requestedDays: days,
          effectiveDays: days,
          start,
          end,
          missingCount: leagues.length * days,
          partial: true,
          elapsedMs: Date.now() - t0,
          warning: String(error.message || error),
        },
        rows,
      });
    }

    const rowsIn = Array.isArray(data) ? data : [];
    const index = new Map();
    for (const r of rowsIn) {
      const lg = String(r?.league || "").toLowerCase();
      const dt = String(r?.date || "");
      if (!lg || !dt) continue;
      index.set(`${lg}__${dt}`, r);
    }

    let missingCount = 0;
    const byLeague = Object.fromEntries(
      leagues.map((lg) => {
        const out = expectedDates.map((dt) => {
          const hit = index.get(`${lg}__${dt}`);
          if (hit) return hit;
          missingCount += 1;
          return makeMissingRow(lg, dt);
        });
        return [lg, out];
      })
    );

    return res.json({
      ok: true,
      meta: {
        source: `supabase:${PERFORMANCE_TABLE}`,
        requestedDays: days,
        effectiveDays: days,
        start,
        end,
        missingCount,
        partial: missingCount > 0,
        elapsedMs: Date.now() - t0,
      },
      rows: byLeague,
    });
  } catch (e) {
    // ✅ last-resort safe response shape
    const leagues = parseLeagues(req.query.leagues);
    const days = clamp(asInt(req.query.days, 7), 1, 90);
    const end = todayUTCYYYYMMDD();
    const start = addDaysUTC(end, -(days - 1));
    const expectedDates = Array.from({ length: days }, (_, i) => addDaysUTC(start, i));
    const rows = Object.fromEntries(leagues.map((lg) => [lg, expectedDates.map((dt) => makeMissingRow(lg, dt))]));

    return res.json({
      ok: true,
      meta: {
        source: "performance:exception",
        requestedDays: days,
        effectiveDays: days,
        start,
        end,
        missingCount: leagues.length * days,
        partial: true,
        elapsedMs: Date.now() - t0,
        warning: String(e?.message || e),
      },
      rows,
    });
  }
});

export default router;
