// apps/api/src/routes/ncaaPredictions.js
import express from "express";
const router = express.Router();

router.get("/", async (req, res) => {
  const date = String(req.query.date || "").trim() || new Date().toISOString().slice(0, 10);

  const windowDaysRaw = req.query.windowDays ?? req.query.window ?? 45;
  const windowDays = Math.max(14, Math.min(90, Number(windowDaysRaw) || 45));

  const modeRaw = String(req.query.mode || "").toLowerCase();
  const tRaw = String(req.query.tournament || "").toLowerCase();
  const tournament =
    modeRaw === "tournament" || tRaw === "1" || tRaw === "true" || tRaw === "yes";

  try {
    const mod = await import("./predict.js");
    const build =
      mod?.buildNcaamPredictions ||
      mod?.buildNcaabPredictions ||
      null;

    if (typeof build !== "function") {
      return res.status(500).json({
        ok: false,
        error: "Missing buildNcaamPredictions export from routes/predict.js",
        meta: { league: "ncaam", date, windowDays, mode: tournament ? "tournament" : "regular" },
        games: [],
        predictions: [],
      });
    }

    const out = await build(date, windowDays, {
      tournamentMode: tournament,
      modeLabel: tournament ? "tournament" : "regular",
    });

    const games = Array.isArray(out?.games) ? out.games : [];

    return res.json({
      ok: true,
      meta: out?.meta || { league: "ncaam", date, windowDays, mode: tournament ? "tournament" : "regular" },
      games,
      predictions: games, // ✅ backward compat
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
      meta: { league: "ncaam", date, windowDays, mode: tournament ? "tournament" : "regular" },
      games: [],
      predictions: [],
    });
  }
});

export default router;