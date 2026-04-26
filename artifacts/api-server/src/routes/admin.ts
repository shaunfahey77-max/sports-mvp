import { Router } from "express";
import { runNightlyValidation, runOddsIngest, backfillSettlementEspn } from "../services/cronService";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { startHistoricalIngest, getHistoricalIngestStatus } from "../services/historicalIngest";
import { db } from "@workspace/db";
import {
  gameSnapshotsTable,
  candidateBetsTable,
  scoredPicksTable,
  modelWatchResultsTable,
} from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { backfillModelWatchResults } from "../scoring/modelWatchGrader";
import {
  aggregateByLeagueMarket,
  renderMarkdownReport,
  type AggregatorRow,
} from "../scoring/modelWatchAggregator";
import { MARKET_MODEL_WATCH_ONLY } from "../config/scoringModelConfig";

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

router.post("/admin/backfill-settlement", async (req, res) => {
  try {
    const { startDate, endDate, leagues, secret } = req.body;
    const expected = process.env.SESSION_SECRET;
    // Fail closed: require both configured secret and provided secret,
    // and reject if they don't match. Prevents unintentional fail-open
    // when SESSION_SECRET is missing in misconfigured environments.
    if (!expected || !secret || secret !== expected) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ ok: false, error: "startDate and endDate required (YYYY-MM-DD)" });
    }
    const validLeagues: Array<"nba" | "nhl"> = ["nba", "nhl"];
    let leaguesArg: Array<"nba" | "nhl"> | undefined;
    if (leagues !== undefined) {
      if (!Array.isArray(leagues) || !leagues.every((l) => validLeagues.includes(l))) {
        return res.status(400).json({ ok: false, error: "leagues must be an array of 'nba'|'nhl'" });
      }
      leaguesArg = leagues;
    }
    logger.info({ startDate, endDate, leagues: leaguesArg }, "Admin backfill-settlement triggered");
    const result = await backfillSettlementEspn(startDate, endDate, leaguesArg);
    res.json({ ok: true, result });
  } catch (err) {
    logger.error({ err }, "Admin backfill-settlement failed");
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

// ---------------------------------------------------------------------------
// Model-Watch internal scoreboard
// ---------------------------------------------------------------------------
// Reports W-L-Push, ROI, CLV, sample size for every market in
// MARKET_MODEL_WATCH_ONLY (currently nhl_spread, mlb_moneyline) so we
// can decide when to promote a market back to Official picks. The
// underlying rows live in `model_watch_results`, which is NEVER read
// from any public surface (/picks, /performance, /performance/history).
//
// Auth: SESSION_SECRET in body, mirroring the other admin endpoints.
//
// Optional body fields:
//   - backfill: { startDate, endDate }  → grade all final snapshots in
//        that window before reporting. Idempotent.
//   - since:    string (YYYY-MM-DD)     → only include rows on/after
//        this date in the report. Defaults to all rows.
//   - format:   "json" | "markdown"     → response shape. Default JSON.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidIsoDate = (s: unknown): s is string =>
  typeof s === "string" && ISO_DATE_RE.test(s) && !Number.isNaN(Date.parse(s));

router.post("/admin/model-watch/performance", async (req, res) => {
  try {
    const { secret, backfill, since, format } = req.body ?? {};
    const expected = process.env.SESSION_SECRET;
    if (!expected || !secret || secret !== expected) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (since !== undefined && since !== null && !isValidIsoDate(since)) {
      return res.status(400).json({
        ok: false,
        error: "since must be a YYYY-MM-DD date string",
      });
    }

    let backfillResult: Awaited<ReturnType<typeof backfillModelWatchResults>> | null = null;
    if (backfill && typeof backfill === "object") {
      const { startDate, endDate } = backfill as {
        startDate?: string;
        endDate?: string;
      };
      if (!startDate || !endDate) {
        return res.status(400).json({
          ok: false,
          error: "backfill requires startDate and endDate (YYYY-MM-DD)",
        });
      }
      if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
        return res.status(400).json({
          ok: false,
          error: "backfill startDate and endDate must be YYYY-MM-DD date strings",
        });
      }
      if (startDate > endDate) {
        return res.status(400).json({
          ok: false,
          error: "backfill startDate must be <= endDate",
        });
      }
      logger.info({ startDate, endDate }, "Admin model-watch backfill triggered");
      backfillResult = await backfillModelWatchResults(startDate, endDate);
    }

    const rows = since
      ? await db
          .select()
          .from(modelWatchResultsTable)
          .where(sql`${modelWatchResultsTable.date} >= ${since}`)
      : await db.select().from(modelWatchResultsTable);

    const aggRows: AggregatorRow[] = rows.map((r) => ({
      league: r.league,
      market: r.market,
      tier: r.tier,
      publishOdds: r.publishOdds,
      edge: r.edge,
      ev: r.ev,
      result: r.result,
      clvImpliedDelta: r.clvImpliedDelta,
    }));

    const registryKeys = Object.entries(MARKET_MODEL_WATCH_ONLY)
      .filter(([, enabled]) => enabled)
      .map(([k]) => k);

    const buckets = aggregateByLeagueMarket(aggRows, registryKeys);

    if (format === "markdown") {
      return res.type("text/markdown").send(renderMarkdownReport(buckets));
    }

    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      since: since ?? null,
      registry: registryKeys,
      backfill: backfillResult,
      buckets,
    });
  } catch (err) {
    logger.error({ err }, "Admin model-watch performance failed");
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
