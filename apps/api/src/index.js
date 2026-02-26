// apps/api/src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";

import adminPerformanceRouter from "./routes/adminPerformance.js";
import predictRouter from "./routes/predict.js";
import performanceRoutes from "./routes/performance.js";
import upsetsRouter from "./routes/upsets.js";
import scoreRouter from "./routes/score.js";
import { startDailyScoreJob } from "./cron/dailyScore.js";

/**
 * Optional: Premium NBA router (safe import)
 */
let nbaPremiumRouter = null;
try {
  const mod = await import("./routes/nbaPremium.js");
  nbaPremiumRouter = mod?.default || null;
} catch {
  // safe ignore
}

const app = express();
const PORT = Number(process.env.PORT || 3001);

const ENABLE_CRON =
  String(process.env.ENABLE_CRON || "true").toLowerCase() !== "false";

const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();
const isLocal = process.env.NODE_ENV !== "production";

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* =============================
   Health + Ping
============================= */

app.get("/__ping", (_req, res) =>
  res.json({ ok: true, from: "apps/api/src/index.js" })
);

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "sports-mvp-api",
    time: new Date().toISOString(),
    version: "api-index-v11-stable-routing",
  })
);

/* =============================
   Core Routers
============================= */

// Admin + Performance
app.use("/api", adminPerformanceRouter);
app.use("/api", performanceRoutes);

// League utilities
app.use("/api/upsets", upsetsRouter);
app.use("/api/score", scoreRouter);

// Optional NBA premium router
if (nbaPremiumRouter) {
  app.use("/api/nba", nbaPremiumRouter);
}

// ✅ Canonical Predict Router Mount
app.use("/api/predict", predictRouter);

// ✅ Backward compatibility
// Allows older frontend calls like /api/predictions?league=nba
app.use("/api", predictRouter);

/* =============================
   Admin Guard Utilities
============================= */

function requireAdmin(req) {
  if (!ADMIN_KEY) return isLocal;
  const key = String(
    req.query.key || req.headers["x-admin-key"] || ""
  ).trim();
  return key && key === ADMIN_KEY;
}

function parseBool01(v) {
  const s = String(v ?? "").toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/* =============================
   Manual Cron Trigger
============================= */

app.get("/api/admin/run-cron", async (req, res) => {
  try {
    const date = String(req.query.date || "").slice(0, 10);
    if (!date || date.length !== 10) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing or invalid date (YYYY-MM-DD)" });
    }

    if (!requireAdmin(req)) {
      return res
        .status(403)
        .json({ ok: false, error: "Forbidden (admin key required)" });
    }

    const leaguesCsv = String(req.query.leagues || "").trim();
    const leagueSingle = String(req.query.league || "").trim();

    let leagues = [];
    if (leaguesCsv) {
      leagues = leaguesCsv
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (leagueSingle) {
      leagues = [leagueSingle.toLowerCase()];
    } else {
      leagues = ["nba", "ncaam", "nhl"];
    }

    leagues = Array.from(new Set(leagues));

    const force = parseBool01(req.query.force);
    const grade = String(req.query.grade || "all");

    const daily = await import("./cron/dailyScore.js");

    const fn =
      daily.runDailyScoreForDate ||
      daily.runDailyScore ||
      daily.scoreDate ||
      null;

    if (!fn) {
      return res.status(500).json({
        ok: false,
        error:
          "No valid scorer export found in ./cron/dailyScore.js",
      });
    }

    const out = await fn(date, { leagues, force, grade });

    return res.json({
      ok: true,
      ranFor: date,
      leagues,
      scoredGames:
        out?.scoredGames ??
        out?.scored ??
        out?.count ??
        0,
      results: out?.results ?? [],
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e?.message || e) });
  }
});

/* =============================
   404 + Error Handling
============================= */

app.use((req, res) =>
  res
    .status(404)
    .json({ ok: false, error: `Not found: ${req.method} ${req.path}` })
);

app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err?.status) || 500;
  res
    .status(status)
    .json({ ok: false, error: String(err?.message || err), status });
});

/* =============================
   Server Start
============================= */

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);

  if (ENABLE_CRON) {
    console.log("[CRON] Daily scoring job enabled");
    startDailyScoreJob();
  } else {
    console.log("[CRON] Disabled via ENABLE_CRON=false");
  }
});