// legacy/apps/api/src/index.js
import dotenv from "dotenv";
dotenv.config({ path: new URL("../.env", import.meta.url) });

import express from "express";
import cors from "cors";

import adminPerformanceRouter from "./routes/adminPerformance.js";
import predictRouter from "./routes/predict.js";
import performanceRoutes from "./routes/performance.js";
import upsetsRouter from "./routes/upsets.js";
import scoreRouter from "./routes/score.js";

import gamesRouter from "./routes/games.js"; // ✅ unified /api/games + /api/ncaam/games (ESPN)
import ncaamPredictEspnRouter from "./routes/ncaamPredictEspn.js"; // ✅ overrides /api/ncaam/predict

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

const app = express();
const PORT = Number(process.env.PORT || 3001);

// ✅ allow disabling cron (useful for local dev / certain deploys)
const ENABLE_CRON = String(process.env.ENABLE_CRON || "true").toLowerCase() !== "false";

// ✅ optional guard for admin endpoints (recommended for any non-local deploy)
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();
const isLocal = process.env.NODE_ENV !== "production";

// small hardening
app.disable("x-powered-by");

// ✅ light request hardening
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
    version: "api-index-v11-espn-ncaam-predict-override",
  })
);

/**
 * ✅ Mount routers (ONLY ONCE)
 */
app.use("/api", adminPerformanceRouter);
app.use("/api", performanceRoutes);

// routes/upsets.js uses router.get("/") so mount it at /api/upsets
app.use("/api/upsets", upsetsRouter);

// ✅ score router (ping/debug)
app.use("/api/score", scoreRouter);

// ✅ unified games + ESPN NCAAM games
app.use("/api", gamesRouter);

// ✅ IMPORTANT: override NCAAM predict BEFORE predictRouter
app.use("/api", ncaamPredictEspnRouter);

if (nbaPremiumRouter) {
  app.use("/api/nba", nbaPremiumRouter);
}

// existing prediction router (NBA/NHL + legacy endpoints)
app.use("/api", predictRouter);

/**
 * ✅ Admin guard helper
 * - In production: requires ?key=ADMIN_KEY or header x-admin-key
 * - In local dev: allows if ADMIN_KEY not set
 */
function requireAdmin(req) {
  if (!ADMIN_KEY) return isLocal;
  const key = String(req.query.key || req.headers["x-admin-key"] || "").trim();
  return key && key === ADMIN_KEY;
}

function normalizeDateParam(date) {
  if (!date) return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return ok ? date : null;
}

function yesterdayUTCYYYYMMDD() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * ✅ Safe in-file cron runner (fallback)
 */
async function runDailyScoreOnceFallback({ date } = {}) {
  const ymd = normalizeDateParam(date) || yesterdayUTCYYYYMMDD();

  const { buildNbaPredictions } = await import("./routes/predict.js");
  const { scoreCompletedGames } = await import("./routes/score.js");

  const nba = await buildNbaPredictions(ymd, 14, { modelVersion: "v2" });
  const report = await scoreCompletedGames("nba", ymd, nba?.games || []);

  return {
    ranFor: ymd,
    scoredGames: Array.isArray(nba?.games) ? nba.games.length : 0,
    report,
  };
}

/**
 * ✅ Manual cron trigger (for testing)
 */
app.get("/api/admin/run-cron", async (req, res) => {
  try {
    if (!requireAdmin(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const date = String(req.query.date || "").trim() || undefined;

    let out = null;
    try {
      const cronMod = await import("./cron/dailyScore.js");
      if (typeof cronMod?.runDailyScoreOnce === "function") {
        out = await cronMod.runDailyScoreOnce({ date });
      }
    } catch {
      // ignore
    }

    if (!out) {
      out = await runDailyScoreOnceFallback({ date });
    }

    return res.json({
      ok: true,
      ranFor: out.ranFor,
      scoredGames: out.scoredGames,
      report: out.report,
    });
  } catch (e) {
    console.error("[ADMIN CRON ERROR]", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ✅ 404 JSON
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Not found: ${req.method} ${req.path}` });
});

/**
 * ✅ Central error handler
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
