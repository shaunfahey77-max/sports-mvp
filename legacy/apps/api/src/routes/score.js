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
  const s = String(date).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeLeague(league) {
  const l = String(league || "").trim().toLowerCase();
  if (!l) return "nba";
  return l;
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
  const homeScore =
    safeNum(g?.homeScore) ??
    safeNum(g?.home?.score) ??
    safeNum(g?.homeTeam?.score) ??
    null;

  const awayScore =
    safeNum(g?.awayScore) ??
    safeNum(g?.away?.score) ??
    safeNum(g?.awayTeam?.score) ??
    null;

  return { homeScore, awayScore };
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

function confBucket(conf) {
  if (!Number.isFinite(conf)) return null;
  if (conf >= 0.75) return "0.75-1.00";
  if (conf >= 0.65) return "0.65-0.75";
  if (conf >= 0.55) return "0.55-0.65";
  return "0.00-0.55";
}

function edgeBucket(edge) {
  if (!Number.isFinite(edge)) return null;
  if (edge >= 0.08) return "0.08+";
  if (edge >= 0.05) return "0.05-0.08";
  if (edge >= 0.03) return "0.03-0.05";
  return "<0.03";
}

function initBucket() {
  return { picks: 0, wins: 0, losses: 0, pushes: 0, winRate: null };
}

function finalizeBucket(b) {
  const denom = b.wins + b.losses;
  b.winRate = denom > 0 ? b.wins / denom : null;
  return b;
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
   - premium rollups + resilient grading
   ========================================================= */
export async function scoreCompletedGames(league, dateYYYYMMDD, games = []) {
  const ymd = normalizeDateParam(dateYYYYMMDD) || new Date().toISOString().slice(0, 10);
  const lg = normalizeLeague(league);
  const rows = Array.isArray(games) ? games : [];

  // counts
  let completedFinals = 0;      // final status regardless of score presence
  let completedWithScore = 0;   // finals that have numeric scores
  let picks = 0;               // non-pass picks in scored finals
  let graded = 0;              // wins+losses+pushes
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let pass = 0;                // finals that were no-pick (PASS/null)

  // summary metrics
  let sumEdge = 0, nEdge = 0;
  let sumWinProb = 0, nWinProb = 0;
  let sumConf = 0, nConf = 0;

  // premium rollups
  const by_conf = {};
  const by_edge = {};
  const by_market = {
    pickSide: {
      home: initBucket(),
      away: initBucket(),
    },
  };

  const details = [];

  for (const g of rows) {
    const status = g?.status ?? g?.state ?? "";
    if (!isFinalStatus(status)) continue;

    completedFinals++;

    const { homeScore, awayScore } = getScoresFromGame(g);
    const hasScore = Number.isFinite(homeScore) && Number.isFinite(awayScore);
    if (!hasScore) {
      // premium: don't treat this as "completed" for grading/pick stats
      continue;
    }
    completedWithScore++;

    const pickSide = getPickSide(g);
    if (!pickSide) {
      pass++;
      continue;
    }

    const edge = safeNum(g?.market?.edge);
    const winProb = safeNum(g?.market?.winProb);
    const conf = safeNum(g?.market?.confidence);

    const { result } = outcomeFromPick(pickSide, homeScore, awayScore);

    picks++;
    graded++;

    if (result === "WIN") wins++;
    else if (result === "LOSS") losses++;
    else if (result === "PUSH") pushes++;

    // averages
    if (Number.isFinite(edge)) { sumEdge += edge; nEdge++; }
    if (Number.isFinite(winProb)) { sumWinProb += winProb; nWinProb++; }
    if (Number.isFinite(conf)) { sumConf += conf; nConf++; }

    // by_market pickSide
    const psBucket = by_market.pickSide[pickSide] || initBucket();
    psBucket.picks++;
    if (result === "WIN") psBucket.wins++;
    else if (result === "LOSS") psBucket.losses++;
    else if (result === "PUSH") psBucket.pushes++;
    by_market.pickSide[pickSide] = psBucket;

    // by_conf buckets
    const cb = confBucket(conf);
    if (cb) {
      by_conf[cb] = by_conf[cb] || initBucket();
      by_conf[cb].picks++;
      if (result === "WIN") by_conf[cb].wins++;
      else if (result === "LOSS") by_conf[cb].losses++;
      else if (result === "PUSH") by_conf[cb].pushes++;
    }

    // by_edge buckets
    const eb = edgeBucket(edge);
    if (eb) {
      by_edge[eb] = by_edge[eb] || initBucket();
      by_edge[eb].picks++;
      if (result === "WIN") by_edge[eb].wins++;
      else if (result === "LOSS") by_edge[eb].losses++;
      else if (result === "PUSH") by_edge[eb].pushes++;
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

  // finalize win rates for rollups
  by_market.pickSide.home = finalizeBucket(by_market.pickSide.home);
  by_market.pickSide.away = finalizeBucket(by_market.pickSide.away);
  for (const k of Object.keys(by_conf)) finalizeBucket(by_conf[k]);
  for (const k of Object.keys(by_edge)) finalizeBucket(by_edge[k]);

  const winRate = wins + losses > 0 ? wins / (wins + losses) : null;

  // Build DB row
  const dbRow = {
    date: ymd,
    league: lg,
    games: rows.length,
    picks,
    completed: completedWithScore, // premium: "completed" means "gradable finals"
    wins,
    losses,
    pushes,
    pass, // premium: explicit pass count
    win_rate: winRate,
    by_conf,
    by_edge,
    by_market,
    notes: null,
    error: null,
    updated_at: new Date().toISOString(),
  };

  // Write to DB (or return ok:false db if not configured)
  const db = await upsertPerformanceRow(dbRow);

  return {
    ok: true,
    league: dbRow.league,
    date: ymd,
    db,
    counts: {
      inputGames: rows.length,
      completedFinals,
      completedWithScore,
      picks,
      graded,
      wins,
      losses,
      pushes,
      pass,
    },
    metrics: {
      winRate,
      avgEdge: nEdge > 0 ? sumEdge / nEdge : null,
      avgWinProb: nWinProb > 0 ? sumWinProb / nWinProb : null,
      avgConfidence: nConf > 0 ? sumConf / nConf : null,
    },
    rollups: {
      by_conf,
      by_edge,
      by_market,
    },
    details, // keep for debugging; remove later if you want
  };
}

/* =========================================================
   Router (debug utilities)
   ========================================================= */
router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "score", version: "score-v4-premium-rollups" });
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
  const league = normalizeLeague(req.query.league || "nba");
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
