import express from "express";
import {
  buildNbaPredictions,
  buildNhlPredictions,
  buildNcaamPredictions,
} from "./predict.js";

import { scoreCompletedGames } from "./score.js";

const router = express.Router();

/**
 * Normalize YYYY-MM-DD
 */
function normalizeDate(date) {
  if (!date) return new Date().toISOString().slice(0, 10);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return ok ? date : new Date().toISOString().slice(0, 10);
}

/**
 * TRUE backfill runner
 * - builds predictions
 * - calls scoreCompletedGames()
 * - writes to Supabase
 */
router.get("/admin/run-cron", async (req, res) => {
  const league = String(req.query.league || "nba").toLowerCase();
  const date = normalizeDate(req.query.date);

  try {
    let predictions;

    if (league === "nba") {
      predictions = await buildNbaPredictions(date, 14, {
        modelVersion: "v2",
      });
    } else if (league === "nhl") {
      predictions = await buildNhlPredictions(date, 60);
    } else if (league === "ncaam") {
      predictions = await buildNcaamPredictions(date, 45, {
        tournamentMode: false,
        modeLabel: "regular",
      });
    } else {
      return res.status(400).json({
        ok: false,
        error: "Unsupported league",
      });
    }

    // 🔥 THIS IS WHAT ACTUALLY WRITES TO SUPABASE
    const report = await scoreCompletedGames(
      league,
      date,
      predictions?.games || []
    );

    return res.json({
      ok: true,
      ranFor: date,
      league,
      report,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      ranFor: date,
      league,
      error: String(err?.message || err),
    });
  }
});

export default router;
