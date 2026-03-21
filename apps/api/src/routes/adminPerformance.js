import express from "express";
import { runScoringForLeague } from "../services/scoring/scoringIndex.js";

const router = express.Router();

function requireAdmin(req, res, next) {
  const expected = String(process.env.ADMIN_TOKEN || "");
  const got = String(req.header("x-admin-token") || "");

  if (!expected || got !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  next();
}

/**
 * GET /api/admin/performance/ping
 */
router.get("/admin/performance/ping", (_req, res) => {
  res.json({ ok: true, route: "admin/performance" });
});

/**
 * POST /api/admin/performance/run?date=YYYY-MM-DD&leagues=nba,nhl,ncaam
 */
router.post("/admin/performance/run", requireAdmin, async (req, res) => {
  try {
    const date = String(req.query.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: "date must be YYYY-MM-DD" });
    }

    const leagues = String(req.query.leagues || "nba,nhl,ncaam")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const allowed = new Set(["nba", "nhl", "ncaam"]);
    const targetLeagues = leagues.filter((l) => allowed.has(l));

    if (!targetLeagues.length) {
      return res.status(400).json({ ok: false, error: "no valid leagues supplied" });
    }

    const results = [];
    for (const league of targetLeagues) {
      const row = await runScoringForLeague(date, league);
      results.push(row);
    }

    return res.json({ ok: true, date, results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
