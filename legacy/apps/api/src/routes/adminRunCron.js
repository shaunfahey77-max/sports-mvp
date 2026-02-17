// apps/api/src/routes/adminRunCron.js
import "dotenv/config";
import express from "express";
import { createClient } from "@supabase/supabase-js";

// Use the same builders your performance route should already use
import { buildNbaPredictions, buildNhlPredictions, buildNcaamPredictions } from "./predict.js";

const router = express.Router();

/**
 * ENV (service role is required to upsert reliably)
 */
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

const TABLE = process.env.PERFORMANCE_TABLE || "performance_daily";

function mustEnv(name, val) {
  if (!val) throw new Error(`Missing ${name} in apps/api/.env`);
}

function normalizeDateParam(date) {
  if (!date) return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return ok ? date : null;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function parseLeagues(raw) {
  const s = String(raw || "").trim();
  if (!s) return ["nba", "nhl", "ncaam"];
  return s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function isFinalLike(status) {
  const v = String(status || "").toLowerCase();
  return v === "final" || v === "post" || v === "completed" || v.includes("final");
}

/**
 * Score a slate from the unified contract games[]
 * - games: total slate size
 * - completed: has winner or final status
 * - picks: has market.pick
 * - graded: pick + winner => win/loss
 */
function scoreFromGames(games) {
  const arr = Array.isArray(games) ? games : [];
  let total = arr.length;
  let completed = 0;
  let picks = 0;
  let graded = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;

  for (const g of arr) {
    const pick = g?.market?.pick || null;
    const hasPick = Boolean(pick);
    if (hasPick) picks++;

    const winnerId = g?.result?.winnerTeamId || null;
    const done = Boolean(winnerId) || isFinalLike(g?.status);
    if (done) completed++;

    const predictedId = g?.market?.recommendedTeamId || null;

    if (hasPick && predictedId && winnerId) {
      graded++;
      if (predictedId === winnerId) wins++;
      else losses++;
    }
  }

  const denom = wins + losses;
  const win_rate = denom ? wins / denom : null;

  return {
    inputGames: total,
    completed,
    picks,
    graded,
    wins,
    losses,
    pushes,
    win_rate,
  };
}

function emptyJson() {
  return {};
}

/**
 * Build predictions for a given league/date using your predict.js builders.
 * NHL picks are paused but schedule should still return games (count > 0 on days with games).
 */
async function getSlate(league, date) {
  if (league === "nba") {
    // same default as your /predictions route (14-day window typical)
    const out = await buildNbaPredictions(date, 14, { modelVersion: "v1" });
    return out?.games || [];
  }
  if (league === "nhl") {
    const out = await buildNhlPredictions(date, 60);
    return out?.games || [];
  }
  if (league === "ncaam") {
    const out = await buildNcaamPredictions(date, 45, { tournamentMode: false, modeLabel: "regular" });
    return out?.games || [];
  }
  throw new Error(`Unsupported league: ${league}`);
}

router.get("/admin/run-cron", async (req, res) => {
  try {
    mustEnv("SUPABASE_URL", SUPABASE_URL);
    mustEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);

    const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);

    // allow `leagues=nba` or `league=nba`
    const requestedLeague = String(req.query.league || "").toLowerCase().trim();
    const leagues = requestedLeague ? [requestedLeague] : parseLeagues(req.query.leagues);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const reports = [];

    for (const league of leagues) {
      const games = await getSlate(league, date);
      const counts = scoreFromGames(games);

      // We persist “picks” as graded picks (scorable) to match your performance logic
      const picks = counts.graded;
      const pass = Math.max(0, counts.inputGames - picks);

      const row = {
        date,
        league,
        games: counts.inputGames,
        picks,
        pass,
        completed: counts.completed,
        wins: counts.wins,
        losses: counts.losses,
        pushes: counts.pushes,
        win_rate: counts.win_rate,
        roi: null,
        by_conf: emptyJson(),
        by_edge: emptyJson(),
        by_market: emptyJson(),
        notes: null,
        error: null,
        // updated_at handled by DB default/trigger
      };

      // ✅ KEY: upsert by (date, league)
      const { data, error } = await supabase
        .from(TABLE)
        .upsert(row, { onConflict: "date,league" })
        .select("date,league,updated_at,games,picks,completed,wins,losses,win_rate,error")
        .single();

      if (error) {
        reports.push({ league, ok: false, error: error.message, counts });
        continue;
      }

      reports.push({ league, ok: true, counts, persisted: data });
    }

    return res.json({
      ok: true,
      ranFor: date,
      requestedLeague: requestedLeague || null,
      reports,
      table: TABLE,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
