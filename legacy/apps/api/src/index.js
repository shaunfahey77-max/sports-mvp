// legacy/apps/api/src/index.js
import "dotenv/config"; // ✅ loads legacy/apps/api/.env automatically
import express from "express";
import cors from "cors";

import adminPerformanceRouter from "./routes/adminPerformance.js";
import performanceRoutes from "./routes/performance.js";
import upsetsRouter from "./routes/upsets.js";
import scoreRouter from "./routes/score.js";
import gamesRouter from "./routes/games.js";
import ncaamPredictRouter from "./routes/ncaamPredict.js";
import predictRouter from "./routes/predict.js";

import { startDailyScoreJob } from "./cron/dailyScore.js";

const app = express();
const PORT = Number(process.env.PORT || 3001);

// ✅ allow disabling cron (useful for local dev / certain deploys)
const ENABLE_CRON = String(process.env.ENABLE_CRON || "true").toLowerCase() !== "false";

// ✅ optional guard for admin endpoints
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();
const isLocal = process.env.NODE_ENV !== "production";

// hardening
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ✅ sanity route (proves we’re running THIS file)
app.get("/__ping", (_req, res) => res.json({ ok: true, from: "legacy/apps/api/src/index.js" }));

/**
 * Health
 */
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "sports-mvp-api",
    time: new Date().toISOString(),
    version: "legacy-api-index-premium-stable",
    cronEnabled: ENABLE_CRON,
  })
);

/**
 * ✅ Admin guard helper
 */
function requireAdmin(req) {
  if (!ADMIN_KEY) return isLocal; // if no key set, allow only locally
  const key = String(req.query.key || req.headers["x-admin-key"] || "").trim();
  return Boolean(key && key === ADMIN_KEY);
}

/**
 * ✅ Optional routers (do not crash if missing)
 */
async function tryImport(defaultPath) {
  try {
    const mod = await import(defaultPath);
    return mod?.default || null;
  } catch {
    return null;
  }
}

// Optional: Premium NBA router
const nbaPremiumRouter = await tryImport("./routes/nbaPremium.js");

// Optional: Premium unified predictions router
const predictionsRouter = await tryImport("./routes/predictions.js");

// Optional: Admin run-cron router
const adminRunCronRouter = await tryImport("./routes/adminRunCron.js");

/**
 * ✅ Mount routers (ORDER MATTERS)
 */
app.use("/api", adminPerformanceRouter);
app.use("/api", performanceRoutes);

// ✅ premium unified predictions contract (if present)
if (predictionsRouter) app.use("/api", predictionsRouter);

// routes/upsets.js uses router.get("/") so mount it at /api/upsets
app.use("/api/upsets", upsetsRouter);

// score router
app.use("/api/score", scoreRouter);

// unified games router (includes /api/games and /api/ncaam/games)
app.use("/api", gamesRouter);

// ✅ ESPN NCAAM predictions — MUST COME BEFORE predictRouter
app.use("/api", ncaamPredictRouter);

// optional premium nba
if (nbaPremiumRouter) {
  app.use("/api/nba", nbaPremiumRouter);
}

/**
 * ✅ Admin run-cron
 * IMPORTANT: mount at /api (not /api/admin) to avoid double-prefixing,
 * because your current adminRunCron.js defines router.get("/admin/run-cron", ...)
 */
if (adminRunCronRouter) {
  app.use("/api", (req, res, next) => {
    // guard only /api/admin/*
    if (req.path.startsWith("/admin/") && !requireAdmin(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    return next();
  });
  app.use("/api", adminRunCronRouter);
} else {
  // fallback stub
  app.get("/api/admin/run-cron", (req, res) => {
    if (!requireAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
    res.json({ ok: true, note: "adminRunCron router not found (routes/adminRunCron.js missing)" });
  });
}

// ⚠️ generic predictions router LAST (avoid shadowing /api/ncaam/predict)
app.use("/api", predictRouter);

// ✅ 404 JSON
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Not found: ${req.method} ${req.path}` });
});

/**
 * ✅ Central error handler (headers-safe)
 */
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);

  const status = Number(err?.status) || 500;
  res.status(status).json({
    ok: false,
    error: String(err?.message || err),
    status,
  });
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
