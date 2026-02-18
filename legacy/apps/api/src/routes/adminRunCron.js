// src/routes/adminRunCron.js
import express from "express";
import { runDailyScoreOnce } from "../cron/dailyScore.js";

const router = express.Router();

/**
 * Admin guard (same behavior as index.js)
 * - If ADMIN_KEY is not set, allow only in non-production.
 */
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();
const isLocal = process.env.NODE_ENV !== "production";

function requireAdmin(req) {
  if (!ADMIN_KEY) return isLocal;
  const key = String(req.query.key || req.headers["x-admin-key"] || "").trim();
  return Boolean(key && key === ADMIN_KEY);
}

function normalizeDateParam(date) {
  if (!date) return null;
  const s = String(date).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseLeagues(raw, fallback = ["nba"]) {
  const s = String(raw || "").trim();
  if (!s) return fallback;
  return s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * GET /api/admin/run-cron?date=YYYY-MM-DD&league=nba
 * GET /api/admin/run-cron?date=YYYY-MM-DD&leagues=nba,nhl,ncaam
 */
router.get("/run-cron", async (req, res) => {
  const t0 = Date.now();
  try {
    if (!requireAdmin(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const date = normalizeDateParam(req.query.date) || null;

    // allow either league= or leagues=
    const requestedLeague = String(req.query.league || "").trim().toLowerCase();
    const leagues = requestedLeague ? [requestedLeague] : parseLeagues(req.query.leagues, ["nba"]);

    const reports = [];
    for (const lg of leagues) {
      try {
        const result = await runDailyScoreOnce({ date, league: lg });
        reports.push({ league: lg, ok: true, ...result });
      } catch (e) {
        reports.push({ league: lg, ok: false, error: String(e?.message || e) });
      }
    }

    return res.json({
      ok: true,
      ranFor: date || "default(yesterday UTC in runner)",
      requestedLeague: requestedLeague || null,
      reports,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
