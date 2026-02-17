// apps/api/src/routes/picks.js
import express from "express";
import { clearPicks, listPicks, upsertPicks } from "../store/picksStore.js";

const router = express.Router();

// GET /api/picks?league=nba&date=YYYY-MM-DD&days=7
router.get("/", (req, res) => {
  const league = req.query.league || null;
  const date = req.query.date || null;
  const days = req.query.days ? Number(req.query.days) : null;

  const picks = listPicks({ league, date, days: Number.isFinite(days) ? days : null });
  res.json({ ok: true, count: picks.length, picks });
});

// POST /api/picks  { picks: [...] }
router.post("/", (req, res) => {
  const body = req.body || {};
  const picks = Array.isArray(body.picks) ? body.picks : [];

  // Minimal validation
  const cleaned = picks
    .map((p) => ({
      league: String(p.league || "").toLowerCase(),
      date: String(p.date || ""),
      gameId: String(p.gameId || ""),
      predictedTeamId: p.predictedTeamId ?? null,
      predictedTeamName: p.predictedTeamName ?? null,
      confidence: Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : null,
      tier: p.tier ?? null,

      // scoring fields
      scored: Boolean(p.scored ?? false),
      correct: p.correct ?? null,
      winnerTeamId: p.winnerTeamId ?? null,
      winnerTeamName: p.winnerTeamName ?? null,
      status: p.status ?? null,
    }))
    .filter((p) => p.league && p.date && p.gameId);

  const merged = upsertPicks(cleaned);
  res.json({ ok: true, upserted: cleaned.length, total: merged.length });
});

// DELETE /api/picks (clears all picks)
router.delete("/", (_req, res) => {
  clearPicks();
  res.json({ ok: true });
});

export default router;
