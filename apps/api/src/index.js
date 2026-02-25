// apps/api/src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";

import adminPerformanceRouter from "./routes/adminPerformance.js";
import predictRouter from "./routes/predict.js";
import performanceRoutes from "./routes/performance.js";
import upsetsRouter from "./routes/upsets.js";
import scoreRouter from "./routes/score.js";

import { startDailyScoreJob } from "./cron/dailyScore.js";

/**
 * Optional: Premium NBA router (safe)
 */
let nbaPremiumRouter = null;
try {
  const mod = await import("./routes/nbaPremium.js");
  nbaPremiumRouter = mod?.default || null;
} catch {
  // ignore
}

const app = express();
const PORT = Number(process.env.PORT || 3001);

// allow disabling cron (local dev / deploy safety)
const ENABLE_CRON = String(process.env.ENABLE_CRON || "true").toLowerCase() !== "false";

// optional admin guard
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();
const isLocal = process.env.NODE_ENV !== "production";

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/__ping", (_req, res) => res.json({ ok: true, from: "apps/api/src/index.js" }));

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "sports-mvp-api",
    time: new Date().toISOString(),
    version: "api-index-v9-premium-cron-multi-league",
  })
);

/**
 * Routers (mounted ONCE)
 */
app.use("/api", adminPerformanceRouter);
app.use("/api", performanceRoutes);
app.use("/api/upsets", upsetsRouter);
app.use("/api/score", scoreRouter);
if (nbaPremiumRouter) app.use("/api/nba", nbaPremiumRouter);
app.use("/api", predictRouter);

/**
 * Admin guard
 * - Prod: requires ?key=ADMIN_KEY or header x-admin-key
 * - Local: allowed when ADMIN_KEY not set
 */
function requireAdmin(req) {
  if (!ADMIN_KEY) return isLocal;
  const key = String(req.query.key || req.headers["x-admin-key"] || "").trim();
  return key && key === ADMIN_KEY;
}

function normalizeDateParam(date) {
  if (!date) return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return ok ? date : null;
}

function yesterdayUTCYYYYMMDD() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function parseLeagues(req) {
  // supports: ?league=ncaam OR ?leagues=nba,ncaam,nhl
  const one = String(req.query.league || "").trim().toLowerCase();
  const manyRaw = String(req.query.leagues || "").trim().toLowerCase();

  let leagues = [];
  if (manyRaw) leagues = manyRaw.split(",").map((s) => s.trim()).filter(Boolean);
  else if (one) leagues = [one];
  else leagues = ["nba"]; // default

  // normalize + allow only known
  const allowed = new Set(["nba", "ncaam", "nhl"]);
  leagues = leagues.filter((l) => allowed.has(l));
  if (!leagues.length) leagues = ["nba"];

  // de-dupe keep order
  return [...new Set(leagues)];
}

function parseBool01(v) {
  const s = String(v ?? "").toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/**
 * Normalize any cron module output to a stable response:
 * { ok, ranFor, leagues, scoredGames, results:[{league, ok, report}] }
 */
function normalizeCronResult(out, fallbackLeagues, ranFor) {
  // Case A: already new multi format
  if (out && Array.isArray(out.results)) {
    const scoredGames =
      typeof out.scoredGames === "number"
        ? out.scoredGames
        : out.results.reduce((a, r) => a + (r?.scoredGames || r?.report?.counts?.inputGames || 0), 0);
    return {
      ok: true,
      ranFor: out.ranFor || ranFor,
      leagues: out.leagues || fallbackLeagues,
      scoredGames,
      results: out.results,
    };
  }

  // Case B: old single format { ranFor, scoredGames, report }
  if (out && out.report && out.report.league) {
    const lg = String(out.report.league).toLowerCase();
    return {
      ok: true,
      ranFor: out.ranFor || ranFor,
      leagues: [lg],
      scoredGames: out.scoredGames ?? (out.report?.counts?.inputGames || 0),
      results: [{ league: lg, ok: true, report: out.report }],
    };
  }

  // Case C: minimal format (what you're seeing): { ranFor, leagues, scoredGames } with no results
  // -> treat as "ok but missing results"
  return {
    ok: true,
    ranFor: out?.ranFor || ranFor,
    leagues: out?.leagues || fallbackLeagues,
    scoredGames: out?.scoredGames ?? 0,
    results: out?.results ?? [],
    warning: "cron_returned_no_results",
  };
}

/**
 * Fallback: run predictions builders + scoreCompletedGames for each league
 * (Used when cron module doesn't support multi-league or returns incomplete payload.)
 */
async function runCronFallback({ date, leagues, force, grade } = {}) {
  const ymd = normalizeDateParam(date) || yesterdayUTCYYYYMMDD();
  const results = [];

  const { buildNbaPredictions, buildNcaamPredictions, buildNhlPredictions } = await import("./routes/predict.js");
  const { scoreCompletedGames } = await import("./routes/score.js");

  for (const league of leagues) {
    try {
      let pred = { games: [], meta: {} };

      if (league === "nba") {
        pred = await buildNbaPredictions(ymd, 14, { modelVersion: "v2" });
      } else if (league === "ncaam") {
        pred = await buildNcaamPredictions(ymd, 45, { tournamentMode: false, modeLabel: "regular" });
      } else if (league === "nhl") {
        // NHL paused; builder returns empty slate cleanly
        pred = await buildNhlPredictions(ymd, 60);
      }

      const report = await scoreCompletedGames(league, ymd, Array.isArray(pred?.games) ? pred.games : [], {
        force,
        grade,
      });

      results.push({ league, ok: true, report, scoredGames: Array.isArray(pred?.games) ? pred.games.length : 0 });
    } catch (e) {
      results.push({ league, ok: false, error: String(e?.message || e), report: null, scoredGames: 0 });
    }
  }

  return {
    ranFor: ymd,
    leagues,
    scoredGames: results.reduce((a, r) => a + (r.scoredGames || 0), 0),
    results,
  };
}

/**
 * ✅ Manual cron trigger (multi-league + consistent response)
 *
 * Examples:
 *  curl -s "http://127.0.0.1:3001/api/admin/run-cron?date=2026-02-22&league=ncaam&force=1&grade=all" | jq
 *  curl -s "http://127.0.0.1:3001/api/admin/run-cron?date=2026-02-22&leagues=nba,ncaam,nhl&force=1&grade=all" | jq
 */
app.get("/api/admin/run-cron", async (req, res) => {
  try {
    const date = String(req.query.date || "").slice(0, 10);
    if (!date || date.length !== 10) {
      return res.status(400).json({ ok: false, error: "Missing or invalid date (YYYY-MM-DD)" });
    }

    // Accept either ?league=nba OR ?leagues=nba,ncaam,nhl
    const leagueSingle = String(req.query.league || "").trim();
    const leaguesCsv = String(req.query.leagues || "").trim();

    let leagues = [];
    if (leaguesCsv) {
      leagues = leaguesCsv.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    } else if (leagueSingle) {
      leagues = [leagueSingle.toLowerCase()];
    } else {
      // Default to all three (even if 0 games) — required for backfill consistency
      leagues = ["nba", "ncaam", "nhl"];
    }

    // de-dupe
    leagues = Array.from(new Set(leagues));

    // Flags
    const force = String(req.query.force || "0") === "1";
    const grade = String(req.query.grade || "all");

    // IMPORTANT:
    // We call the scorer the same way daily cron does.
    // dailyScore.js already mentions it supports the manual endpoint.
    const daily = await import("./cron/dailyScore.js");

    // Try to locate a scorer function in dailyScore.js without guessing too hard.
    const candidates = [
      "runDailyScoreForDate",
      "runDailyScore",
      "scoreDate",
      "runScoreForDate",
      "runDailyScoreOnce",
      "scoreDay",
      "scoreForDate",
    ];
    let fn = null;
    for (const name of candidates) {
      if (typeof daily[name] === "function") { fn = daily[name]; break; }
    }

    if (!fn) {
      return res.status(500).json({
        ok: false,
        error: "Could not find a scorer function export in ./cron/dailyScore.js",
        hint: "Open apps/api/src/cron/dailyScore.js and export one of: runDailyScoreForDate(date, opts) / runDailyScore(date, opts) / scoreDate(date, opts)."
      });
    }

    // Call it with a consistent options object.
    // (Most of our versions accept (date, {leagues, force, grade}) or (date, leagues, opts).)
    let out = null
    try {
      out = await fn(date, { leagues, force, grade });
    } catch (e1) {
      try {
        out = await fn(date, leagues, { force, grade });
      } catch (e2) {
        // Surface the first error; second is just signature mismatch attempt
        throw e1;
      }
    }

    // Normalize response for the web UI even if scorer returns a different shape
    // If scorer already returns the new shape, just pass it through.
    if (out && typeof out === "object" && out.ok !== undefined) {
      return res.json(out);
    }

    return res.json({
      ok: true,
      ranFor: date,
      leagues,
      scoredGames: out?.scoredGames ?? out?.scored ?? out?.count ?? 0,
      results: out?.results ?? out ?? [],
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


// 404 JSON
app.use((req, res) => res.status(404).json({ ok: false, error: `Not found: ${req.method} ${req.path}` }));

// Error handler
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err?.status) || 500;
  res.status(status).json({ ok: false, error: String(err?.message || err), status });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  if (ENABLE_CRON) {
    console.log("[CRON] Daily scoring job enabled");
    startDailyScoreJob();
  } else {
    console.log("[CRON] Disabled via ENABLE_CRON=false");
  }
});