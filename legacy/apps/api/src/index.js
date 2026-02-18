// legacy/apps/api/src/index.js
import dotenv from "dotenv";
dotenv.config({ path: new URL("../.env", import.meta.url) });

import express from "express";
import cors from "cors";

// Routers (make sure these paths exist in legacy/apps/api/src/routes/)
import adminPerformanceRouter from "./routes/adminPerformance.js";
import predictRouter from "./routes/predict.js";
import performanceRoutes from "./routes/performance.js";
import upsetsRouter from "./routes/upsets.js";
import scoreRouter from "./routes/score.js";
import gamesRouter from "./routes/games.js";

import { startDailyScoreJob } from "./cron/dailyScore.js";

const app = express();
const PORT = Number(process.env.PORT || 3001);

// allow disabling cron
const ENABLE_CRON = String(process.env.ENABLE_CRON || "true").toLowerCase() !== "false";

// hardening
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// proves we’re running THIS file
app.get("/__ping", (_req, res) => res.json({ ok: true, from: "legacy/apps/api/src/index.js" }));

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "sports-mvp-api",
    time: new Date().toISOString(),
    version: "legacy-api-index-stable",
  })
);

/**
 * Mount routers
 * - gamesRouter provides /api/games and /api/ncaam/games
 * - upsetsRouter expects to be mounted at /api/upsets
 */
app.use("/api", adminPerformanceRouter);
app.use("/api", performanceRoutes);
app.use("/api/upsets", upsetsRouter);
app.use("/api/score", scoreRouter);
app.use("/api", gamesRouter);
app.use("/api", predictRouter);

// 404 JSON
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Not found: ${req.method} ${req.path}` });
});

// error handler
app.use((err, _req, res, _next) => {
  const status = Number(err?.status) || 500;
  res.status(status).json({ ok: false, error: String(err?.message || err), status });
});

// ✅ THIS is what keeps Node alive
app.listen(PORT, () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);

  if (ENABLE_CRON) {
    console.log("[CRON] Daily scoring job enabled");
    try {
      startDailyScoreJob();
    } catch (e) {
      console.error("[CRON] Failed to start:", e);
    }
  } else {
    console.log("[CRON] Disabled via ENABLE_CRON=false");
  }
});
