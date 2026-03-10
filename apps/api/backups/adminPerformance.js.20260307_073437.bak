import express from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { buildNbaPredictions, buildNhlPredictions, buildNcaamPredictions } from "./predict.js";

const router = express.Router();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

/**
 * Simple sanity check (verifies router is mounted)
 * GET /api/admin/performance/ping
 */
router.get("/admin/performance/ping", (_req, res) => {
  res.json({ ok: true, route: "admin/performance" });
});

function normalizeDateParam(date) {
  const d = String(date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
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

/**
 * Auth: allow either:
 * - x-admin-token: <token>
 * - Authorization: Bearer <token>
 */
function requireAdmin(req, res, next) {
  const headerTok = String(req.headers["x-admin-token"] || "").trim();

  const auth = String(req.headers["authorization"] || "").trim();
  const bearer =
    auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  const tok = headerTok || bearer;

  if (!ADMIN_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "ADMIN_TOKEN is not set on the server (.env)",
    });
  }

  if (!tok || tok !== ADMIN_TOKEN) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
      hint: "Send x-admin-token: <ADMIN_TOKEN> (or Authorization: Bearer <ADMIN_TOKEN>)",
    });
  }

  next();
}

function getWinnerSide(homeScore, awayScore) {
  if (typeof homeScore !== "number" || typeof awayScore !== "number") return null;
  if (homeScore === awayScore) return "push";
  return homeScore > awayScore ? "home" : "away";
}

function getScoresFromGame(g) {
  const hs =
    typeof g?.homeScore === "number"
      ? g.homeScore
      : typeof g?.home?.score === "number"
      ? g.home.score
      : null;

  const as =
    typeof g?.awayScore === "number"
      ? g.awayScore
      : typeof g?.away?.score === "number"
      ? g.away.score
      : null;

  return { homeScore: hs, awayScore: as };
}

function isFinalStatus(g) {
  const s = String(g?.status || "").toLowerCase();
  return s === "final" || s === "post" || s === "completed";
}

async function buildPredictionsInternal(league, date) {
  if (league === "nba") return await buildNbaPredictions(date, 14);
  if (league === "nhl") return await buildNhlPredictions(date, 60);
  if (league === "ncaam") {
    return await buildNcaamPredictions(date, 45, {
      tournamentMode: false,
      modeLabel: "regular",
    });
  }
  return { meta: { league, date, error: "unsupported league" }, games: [] };
}

function scoreFromGames(games) {
  let picks = 0;
  let pass = 0;
  let completed = 0;
  let wins = 0;
  let losses = 0;
  let scored = 0;

  for (const g of games) {
    const pick = g?.market?.pick ?? null;
    if (!pick) pass++;
    else picks++;

    if (!isFinalStatus(g)) continue;

    const { homeScore, awayScore } = getScoresFromGame(g);
    const winner = getWinnerSide(homeScore, awayScore);
    if (!winner || winner === "push") continue;

    completed++;
    scored++;

    if (pick === winner) wins++;
    else if (pick === "home" || pick === "away") losses++;
  }

  const acc = scored ? wins / scored : null;
  return { games: games.length, picks, pass, completed, wins, losses, scored, acc };
}

// POST /api/admin/performance/run?date=YYYY-MM-DD&leagues=nba,nhl,ncaam
router.post("/admin/performance/run", requireAdmin, async (req, res) => {
  try {
    const leagues = String(req.query.leagues || "nba,nhl,ncaam")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const requestedDate = normalizeDateParam(req.query.date);
    const date = requestedDate || addDaysUTC(yyyymmddUTC(new Date()), -1);

    const results = [];
    const nowIso = new Date().toISOString();

    // Uncomment if you want quick server visibility:
    // console.log("[adminPerformance] run", { date, leagues });

    for (const league of leagues) {
      const out = await buildPredictionsInternal(league, date);
      const games = Array.isArray(out?.games) ? out.games : [];
      const scored = scoreFromGames(games);

      const row = {
        league,
        date,
        ...scored,
        created_at: nowIso,
        updated_at: nowIso,
      };

      const { error } = await supabaseAdmin
        .from("performance_daily")
        .upsert(row, { onConflict: "league,date" });

      if (error) throw new Error(`${league} upsert failed: ${error.message}`);

      results.push({ league, date, ...scored });
    }

    return res.json({ ok: true, date, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
