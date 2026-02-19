// legacy/apps/api/src/routes/adminRunCron.js
import express from "express";
import { runDailyScoreOnce } from "../cron/dailyScore.js";

const router = express.Router();

function normalizeDate(date) {
  const s = String(date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date().toISOString().slice(0, 10);
}

function parseLeagues(raw) {
  const s = String(raw || "").trim();
  if (!s) return ["nba", "nhl", "ncaam"];
  return s.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "adminRunCron", version: "v3-multi-league" });
});

/**
 * Mounted at /api/admin
 * So this is reachable at:
 *   GET /api/admin/run-cron?date=YYYY-MM-DD&leagues=nba,nhl,ncaam
 * Also supports:
 *   GET /api/admin/run-cron?date=...&league=nba
 */
router.get("/run-cron", async (req, res) => {
  const date = normalizeDate(req.query.date);
  const requestedLeague = String(req.query.league || "").trim().toLowerCase();
  const leagues = requestedLeague ? [requestedLeague] : parseLeagues(req.query.leagues);

  try {
    const reports = [];

    for (const league of leagues) {
      try {
        const out = await runDailyScoreOnce({ date, league });
        reports.push({
          league,
          ok: true,
          ranFor: out?.ranFor || date,
          scoredGames: out?.scoredGames ?? null,
          source: out?.source || null,
          report: out?.report || null,
        });
      } catch (e) {
        reports.push({
          league,
          ok: false,
          ranFor: date,
          error: String(e?.message || e),
        });
      }
    }

    return res.json({
      ok: reports.every(r => r.ok),
      ranFor: date,
      leagues,
      reports,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
