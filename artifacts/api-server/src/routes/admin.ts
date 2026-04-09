import { Router } from "express";
import { runNightlyValidation, runOddsIngest } from "../services/cronService";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { startHistoricalIngest, getHistoricalIngestStatus } from "../services/historicalIngest";
import { db } from "@workspace/db";
import { gameSnapshotsTable, candidateBetsTable, scoredPicksTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

router.post("/admin/run-validation", async (_req, res) => {
  try {
    logger.info("Manual validation triggered via API");
    await runNightlyValidation();
    res.json({ ok: true, message: "Validation complete" });
  } catch (err) {
    logger.error({ err }, "Manual validation failed");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

router.post("/admin/run-ingest", async (_req, res) => {
  try {
    logger.info("Manual odds ingest triggered via API");
    await runOddsIngest();
    res.json({ ok: true, message: "Ingest complete" });
  } catch (err) {
    logger.error({ err }, "Manual ingest failed");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

router.post("/admin/set-tier", async (req, res) => {
  try {
    const { email, clerkUserId, tier, secret } = req.body;
    if (secret !== process.env.SESSION_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    if ((!email && !clerkUserId) || !tier) {
      return res.status(400).json({ ok: false, error: "email or clerkUserId, and tier required" });
    }
    let user;
    if (clerkUserId) {
      user = await storage.updateUserStripe(clerkUserId, { tier });
    } else {
      user = await storage.updateUserTierByEmail(email, tier);
    }
    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }
    logger.info({ email, clerkUserId, tier }, "Admin set user tier");
    res.json({ ok: true, user });
  } catch (err) {
    logger.error({ err }, "Admin set-tier failed");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Purge bad game keys from all three tables (scored_picks, candidate_bets, game_snapshots)
// ---------------------------------------------------------------------------
router.post("/admin/purge-games", async (req, res) => {
  try {
    const { secret, gameKeys } = req.body;
    if (secret !== process.env.SESSION_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    if (!Array.isArray(gameKeys) || gameKeys.length === 0) {
      return res.status(400).json({ ok: false, error: "gameKeys array required" });
    }

    const [sp, cb, gs] = await Promise.all([
      db.delete(scoredPicksTable).where(inArray(scoredPicksTable.gameKey, gameKeys)).returning({ gameKey: scoredPicksTable.gameKey }),
      db.delete(candidateBetsTable).where(inArray(candidateBetsTable.gameKey, gameKeys)).returning({ gameKey: candidateBetsTable.gameKey }),
      db.delete(gameSnapshotsTable).where(inArray(gameSnapshotsTable.gameKey, gameKeys)).returning({ gameKey: gameSnapshotsTable.gameKey }),
    ]);

    logger.info({ gameKeys, scoredPicks: sp.length, candidateBets: cb.length, snapshots: gs.length }, "Admin purge-games complete");
    res.json({ ok: true, deleted: { scoredPicks: sp.length, candidateBets: cb.length, snapshots: gs.length } });
  } catch (err) {
    logger.error({ err }, "Admin purge-games failed");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Historical Ingest — pull 3 years of NBA/NHL odds+scores, grade, store
// ---------------------------------------------------------------------------

router.post("/admin/historical-ingest", (req, res) => {
  try {
    const { startDate, endDate, leagues, secret, delayMs } = req.body;

    if (secret !== process.env.SESSION_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        ok: false,
        error: "startDate and endDate required (YYYY-MM-DD)",
      });
    }

    // Check no job already running
    const status = getHistoricalIngestStatus();
    if (status?.status === "running") {
      return res.status(409).json({
        ok: false,
        error: "A historical ingest is already running",
        progress: status,
      });
    }

    startHistoricalIngest({
      startDate,
      endDate,
      leagues: leagues ?? ["nba", "nhl"],
      delayMs: delayMs ?? 300,
    });

    logger.info({ startDate, endDate }, "Historical ingest triggered via admin endpoint");

    res.json({
      ok: true,
      message: `Historical ingest started for ${startDate} → ${endDate}. Check /admin/historical-ingest/status for progress.`,
    });
  } catch (err) {
    logger.error({ err }, "Failed to start historical ingest");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

router.post("/admin/historical-ingest/status", (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.SESSION_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const status = getHistoricalIngestStatus();
  if (!status) {
    return res.json({ ok: true, status: "idle", message: "No ingest has been run yet" });
  }

  const pctDone =
    status.datesTotal > 0
      ? ((status.datesProcessed / status.datesTotal) * 100).toFixed(1)
      : "0";

  res.json({
    ok: true,
    ...status,
    percentComplete: `${pctDone}%`,
  });
});

export default router;
