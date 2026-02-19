// legacy/apps/api/src/index.js
import dotenv from "dotenv";

/**
 * ✅ Premium env loading (bulletproof)
 * Your repo has used BOTH:
 * - legacy/apps/api/.env
 * - legacy/apps/.env
 *
 * This tries both paths so the API never “half boots” with missing env.
 */
const ENV_CANDIDATES = [
  // legacy/apps/api/.env  (from src/)
  new URL("../.env", import.meta.url),
  // legacy/apps/.env      (from src/)
  new URL("../../.env", import.meta.url),
];

let envLoaded = false;
for (const u of ENV_CANDIDATES) {
  try {
    const out = dotenv.config({ path: u.pathname });
    if (!out?.error) {
      envLoaded = true;
      break;
    }
  } catch {
    // ignore
  }
}
if (!envLoaded) dotenv.config();

import express from "express";
import cors from "cors";

import adminPerformanceRouter from "./routes/adminPerformance.js";
import performanceRoutes from "./routes/performance.js";
import upsetsRouter from "./routes/upsets.js";
import scoreRouter from "./routes/score.js";

// ✅ Premium unified predictions contract (/api/predictions?league=...&date=...)
import predictionsRouter from "./routes/predictions.js";

// ✅ unified /api/games + ESPN slates
import gamesRouter from "./routes/games.js";

// ✅ ESPN NCAAM predictions (/api/ncaam/predict) — MUST BE BEFORE predictRouter
import ncaamPredictRouter from "./routes/ncaamPredict.js";

// ⚠️ generic predictions router LAST
import predictRouter from "./routes/predict.js";

import { startDailyScoreJob } from "./cron/dailyScore.js";

// ✅ Always-mount admin backfill router
import adminRunCronRouter from "./routes/adminRunCron.js";

/**
 * Optional: Premium NBA router
 * - Do NOT crash if file doesn't exist
 */
let nbaPremiumRouter = null;
try {
  const mod = await import("./routes/nbaPremium.js");
  nbaPremiumRouter = mod?.default || null;
} catch {
  // ignore
}

const app = express();
const PORT = Number(process.env.PORT || 3001);

// ✅ allow disabling cron
const ENABLE_CRON = String(process.env.ENABLE_CRON || "true").toLowerCase() !== "false";

// hardening
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// sanity route
app.get("/__ping", (_req, res) => res.json({ ok: true, from: "legacy/apps/api/src/index.js" }));

// health
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "sports-mvp-api",
    time: new Date().toISOString(),
    version: "legacy-api-index-premium-scoring-upsets-v3",
  })
);

/**
 * ✅ Mount routers (ORDER MATTERS)
 */
app.use("/api", adminPerformanceRouter);
app.use("/api", performanceRoutes);

// ✅ unified predictions (used by Upsets + UI)
app.use("/api", predictionsRouter);

// upsets
app.use("/api/upsets", upsetsRouter);

// scoring utilities + scorer export uses Supabase safely
app.use("/api/score", scoreRouter);

// games (NBA/NHL/NCAAM slate endpoints)
app.use("/api", gamesRouter);

// ✅ NCAAM ESPN predict must come before generic predict
app.use("/api", ncaamPredictRouter);

// optional premium nba
if (nbaPremiumRouter) app.use("/api/nba", nbaPremiumRouter);

// ✅ admin backfill runner (writes performance rows)
app.use("/api/admin", adminRunCronRouter);

// generic predict LAST
app.use("/api", predictRouter);

// 404 JSON
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Not found: ${req.method} ${req.path}` });
});

// central error handler
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err?.status) || 500;
  res.status(status).json({ ok: false, error: String(err?.message || err), status });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);

  if (ENABLE_CRON) {
    console.log("[CRON] Daily scoring job enabled");
    startDailyScoreJob();
  } else {
    console.log("[CRON] Disabled via ENABLE_CRON=false");
  }
});
