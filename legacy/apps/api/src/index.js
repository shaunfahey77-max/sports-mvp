// legacy/apps/api/src/index.js
import dotenv from "dotenv";
dotenv.config({ path: new URL("../.env", import.meta.url) });

import express from "express";
import cors from "cors";

import adminPerformanceRouter from "./routes/adminPerformance.js";
import performanceRoutes from "./routes/performance.js";
import upsetsRouter from "./routes/upsets.js";
import scoreRouter from "./routes/score.js";

// ✅ Premium unified predictions contract (/api/predictions?league=...&date=...)
import predictionsRouter from "./routes/predictions.js";

// ✅ unified /api/games + /api/ncaam/games
import gamesRouter from "./routes/games.js";

// ✅ ESPN NCAAM predictions (/api/ncaam/predict) — MUST BE MOUNTED BEFORE predictRouter
import ncaamPredictRouter from "./routes/ncaamPredict.js";

// ⚠️ generic predictions router (can shadow /ncaam/predict if mounted first)
import predictRouter from "./routes/predict.js";

import { startDailyScoreJob } from "./cron/dailyScore.js";

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

/**
 * Optional: Admin run-cron router (premium scoring trigger)
 * - Prefer router if present; otherwise keep fallback endpoint below
 */
let adminRunCronRouter = null;
try {
  const mod = await import("./routes/adminRunCron.js");
  adminRunCronRouter = mod?.default || null;
} catch {
  // ignore
}

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
    version: "legacy-api-index-premium-scoring-upsets",
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
 * ✅ Mount routers (ORDER MATTERS)
 *
 * Premium fixes included here:
 * - Ensure /api/predictions router is mounted (used by Upsets + performance UIs)
 * - Keep /api/upsets mounted explicitly at /api/upsets
 * - Keep scoring router mounted at /api/score
 * - Mount ncaamPredictRouter BEFORE predictRouter to prevent shadowing
 * - Prefer adminRunCron router when present for premium scoring runs
 */
app.use("/api", adminPerformanceRouter);
app.use("/api", performanceRoutes);

// ✅ premium unified predictions router
app.use("/api", predictionsRouter);

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

// ✅ premium admin scoring trigger router (if you created it)
if (adminRunCronRouter) {
  app.use("/api/admin", adminRunCronRouter);
} else {
  /**
   * ✅ Manual cron trigger (fallback)
   * If you have apps/api/src/routes/adminRunCron.js, it will be used instead.
   */
  app.get("/api/admin/run-cron", async (req, res) => {
    try {
      if (!requireAdmin(req)) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
      return res.json({
        ok: true,
        note:
          "adminRunCron router not found. Create routes/adminRunCron.js for premium scoring runs, or wire run logic here.",
      });
    } catch (e) {
      console.error("[ADMIN CRON ERROR]", e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}

// ⚠️ generic predictions router LAST (avoid shadowing /api/ncaam/predict)
app.use("/api", predictRouter);

// ✅ 404 JSON (prevents confusing hangs / HTML)
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
