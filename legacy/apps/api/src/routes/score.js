// apps/api/src/routes/score.js
import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

/* =========================================================
   Supabase (service role for server-side writes)
   ========================================================= */
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const PERFORMANCE_TABLE = String(process.env.PERFORMANCE_TABLE || "performance_daily").trim();

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

function haveSupabase() {
  return Boolean(supabase && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

/* =========================================================
   Helpers
   ========================================================= */
function normalizeDateParam(date) {
  if (!date) return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(String(date));
  return ok ? String(date) : null;
}

function isFinalStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "final" || s === "post" || s === "completed" || s.includes("final");
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function getScoresFromGame(g) {
  const hs =
    safeNum(g?.homeScore) ??
    safeNum(g?.home?.score) ??
    safeNum(g?.homeTeam?.score) ??
    null;

  const as =
    safeNum(g?.awayScore) ??
    safeNum(g?.away?.score) ??
    safeNum(g?.awayTeam?.score) ??
    null;

  return { homeScore: hs, awayScore: as };
}

function getPickSide(g) {
  // unified contract: g.market.pick
  const p = g?.market?.pick ?? g?.pick ?? null;
  return p === "home" || p === "away" ? p : null;
}

function outcomeFromPick(pickSide, homeScore, awayScore) {
  if (!pickSide) return { result: "NOPICK", won: null };

  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
    return { result: "NOSCORE", won: null };
  }

  if (homeScore === awayScore) return { result: "PUSH", won: 0 };

  const homeWon = homeScore > awayScore;
  const pickHome = pickSide === "home";
  const won = (homeWon && pickHome) || (!homeWon && !pickHome);

  return { result: won ? "WIN" : "LOSS", won: won ? 1 : 0 };
}

/* =========================================================
   DB writer
   ========================================================= */
async function upsertPerformanceRow(row) {
  if (!haveSupabase()) {
    return {
      ok: false,
      error: "Supabase not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).",
      upserted: 0,
    };
  }

  // Hard guard: must include PK fields
  if (!row?.date || !row?.league) {
    return { ok: false, error: "Invalid row (missing date/league).", upserted: 0 };
  }

  const { data, error } = await supabase
    .from(PERFORMANCE_TABLE)
    .upsert(row, { onConflict: "date,league" })
    .select("date,league");

  if (error) {
    return { ok: false, error: String(error?.message || error), upserted: 0 };
  }

  return { ok: true, error: null, upserted: Array.isArray(data) ? data.length : 1 };
}

/* =========================================================
   ✅ Named export (cron/admin rely on this)
   - NOW writes to Supabase
   ========================================================= */
export async function scoreCompletedGames(league, dateYYYYMMDD, games = []) {
  const ymd = normalizeDateParam(dateYYYYMMDD) || new Date().toISOString().slice(0, 10);
  const rows = Array.isArray(games) ? games : [];

  let completed = 0;
  let picks = 0; // non-pass picks in completed games
  let graded = 0; // wins+losses+pushes
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let noPick = 0; // completed finals that were PASS/null

  let sumEdge = 0;
  let nEdge = 0;

  let sumWinProb = 0;
  let nWinProb = 0;

  let sumConf = 0;
  let nConf = 0;

  const details = [];

  for (const g of rows) {
    const status = g?.status ?? g?.state ?? "";
    if (!isFinalStatus(status)) continue;

    const { homeScore, awayScore } = getScoresFromGame(g);
    completed++;

    const pickSide = getPickSide(g);
    if (!pickSide) {
      noPick++;
      continue;
    }

    // must have numeric scores to grade
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    const { result } = outcomeFromPick(pickSide, homeScore, awayScore);

    picks++;
    graded++;

    if (result === "WIN") wins++;
    else if (result === "LOSS") losses++;
    else if (result === "PUSH") pushes++;

    const edge = safeNum(g?.market?.edge);
    if (Number.isFinite(edge)) {
      sumEdge += edge;
      nEdge++;
    }

    const winProb = safeNum(g?.market?.winProb);
    if (Number.isFinite(winProb)) {
      sumWinProb += winProb;
      nWinProb++;
    }

    const conf = safeNum(g?.market?.confidence);
    if (Number.isFinite(conf)) {
      sumConf += conf;
      nConf++;
    }

    details.push({
      gameId: g?.gameId ?? g?.id ?? null,
      date: g?.date ?? ymd,
      status,
      pickSide,
      homeScore,
      awayScore,
      result,
      edge: Number.isFinite(edge) ? edge : null,
      winProb: Number.isFinite(winProb) ? winProb : null,
      confidence: Number.isFinite(conf) ? conf : null,
    });
  }

  const winRate = wins + losses > 0 ? wins / (wins + losses) : null;

  // Build DB row
  const dbRow = {
    date: ymd,
    league: String(league || "").toLowerCase(),
    games: rows.length,
    picks,
    completed,
    wins,
    losses,
    pushes,
    pass: noPick, // treat "no pick on final" as pass for performance rollups
    win_rate: winRate,
    by_conf: {},
    by_edge: {},
    by_market: {},
    notes: null,
    error: null,
    updated_at: new Date().toISOString(),
  };

  // Write to DB
  const db = await upsertPerformanceRow(dbRow);

  return {
    ok: true,
    league: dbRow.league,
    date: ymd,
    db,
    counts: {
      inputGames: rows.length,
      completed,
      picks,
      graded,
      wins,
      losses,
      pushes,
      noPick,
    },
    metrics: {
      winRate,
      avgEdge: nEdge > 0 ? sumEdge / nEdge : null,
      avgWinProb: nWinProb > 0 ? sumWinProb / nWinProb : null,
      avgConfidence: nConf > 0 ? sumConf / nConf : null,
    },
    details, // keep for debugging; remove later if you want
  };
}

/* =========================================================
   Router (debug utilities)
   ========================================================= */
router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "score", version: "score-v3-db-write" });
});

router.get("/env", (_req, res) => {
  res.json({
    ok: true,
    SUPABASE_URL: Boolean(SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    PERFORMANCE_TABLE,
  });
});

// quick DB write test (no predictions needed)
router.get("/test-write", async (req, res) => {
  const league = String(req.query.league || "nba").toLowerCase();
  const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);

  const row = {
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
    by_conf: {},
    by_edge: {},
    by_market: {},
    notes: "test-write",
    error: null,
    updated_at: new Date().toISOString(),
  };

  try {
    const db = await upsertPerformanceRow(row);
    res.json({ ok: true, date, league, db });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
