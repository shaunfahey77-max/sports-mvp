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
import { and, desc, gte, inArray, sql } from "drizzle-orm";
import { backfillModelWatchResults } from "../scoring/modelWatchGrader";
import {
  aggregateByLeagueMarket,
  renderMarkdownReport,
  type AggregatorRow,
} from "../scoring/modelWatchAggregator";
import {
  summarizeCohorts,
  type CohortInputRow,
} from "../scoring/cohortAnalysis";
import { renderCohortReportMarkdown } from "../scoring/cohortReportMarkdown";
import {
  MARKET_MODEL_WATCH_ONLY,
  PUBLIC_TRACK_RECORD_CUTOFFS,
} from "../config/scoringModelConfig";

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

const DEFAULT_RECENT_LIMIT = 25;
const MAX_RECENT_LIMIT = 200;

router.post("/admin/model-watch/performance", async (req, res) => {
  try {
    const { secret, backfill, since, format, includeRecent, recentLimit } =
      req.body ?? {};
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

    if (
      includeRecent !== undefined &&
      includeRecent !== null &&
      typeof includeRecent !== "boolean"
    ) {
      return res.status(400).json({
        ok: false,
        error: "includeRecent must be a boolean",
      });
    }
    const wantsRecent = includeRecent === true;

    let recentLimitN = DEFAULT_RECENT_LIMIT;
    if (recentLimit !== undefined && recentLimit !== null) {
      const n = Number(recentLimit);
      if (
        !Number.isInteger(n) ||
        n < 1 ||
        n > MAX_RECENT_LIMIT
      ) {
        return res.status(400).json({
          ok: false,
          error: `recentLimit must be an integer in [1, ${MAX_RECENT_LIMIT}]`,
        });
      }
      recentLimitN = n;
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

    // Order so the per-bucket "recent" slice is genuinely the most recent rows.
    // Stable across calls for identical data via the id tiebreaker.
    const orderBy = [
      desc(modelWatchResultsTable.date),
      desc(modelWatchResultsTable.eventStart),
      desc(modelWatchResultsTable.id),
    ] as const;
    const rows = since
      ? await db
          .select()
          .from(modelWatchResultsTable)
          .where(sql`${modelWatchResultsTable.date} >= ${since}`)
          .orderBy(...orderBy)
      : await db
          .select()
          .from(modelWatchResultsTable)
          .orderBy(...orderBy);

    const aggRows: AggregatorRow[] = rows.map((r) => ({
      league: r.league,
      market: r.market,
      tier: r.tier,
      publishOdds: r.publishOdds,
      edge: r.edge,
      ev: r.ev,
      result: r.result,
      clvImpliedDelta: r.clvImpliedDelta,
      date: r.date,
      gameKey: r.gameKey,
      pick: r.pick,
    }));

    const registryKeys = Object.entries(MARKET_MODEL_WATCH_ONLY)
      .filter(([, enabled]) => enabled)
      .map(([k]) => k);

    const buckets = aggregateByLeagueMarket(
      aggRows,
      registryKeys,
      wantsRecent ? { recentLimit: recentLimitN } : {}
    );

    if (format === "markdown") {
      return res.type("text/markdown").send(renderMarkdownReport(buckets));
    }

    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      since: since ?? null,
      registry: registryKeys,
      backfill: backfillResult,
      recentLimit: wantsRecent ? recentLimitN : null,
      buckets,
    });
  } catch (err) {
    logger.error({ err }, "Admin model-watch performance failed");
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Internal calibration-review tool
// ---------------------------------------------------------------------------
// Read-only analyst surface that BYPASSES the public PUBLIC_TRACK_RECORD_CUTOFFS
// filter and the data_quality filter, so the analyst sees every scored pick:
//   - PRE / POST cohort split per row, derived from PUBLIC_TRACK_RECORD_CUTOFFS
//     (rows for leagues without a cutoff are all POST).
//   - clean / flagged split per row, derived from `data_quality` (null = clean,
//     any non-null label = flagged). Flagged rows are SHOWN as their own
//     bucket, not silently removed — that is the entire point of this tool.
//
// Per (league_market, cohort, quality) bucket, reports the standard scoreboard
// stats (CLV / ROI / win rate / avg edge / avg EV) plus Brier(model),
// Brier(market_prob_fair), Brier skill, and an edge-bucket monotonicity panel.
//
// Auth: SESSION_SECRET in body, mirroring every other admin endpoint. This
// endpoint NEVER feeds public read paths or pricing/product surfaces — it is
// a pure read of `scored_picks` for internal calibration review.
//
// Body fields:
//   - secret      (required) — must equal process.env.SESSION_SECRET.
//   - format      "json" | "markdown" — default "json".
//   - sinceDays   number  — restrict to rows with date >= today - N days.
//                           Default 180. Pass 0 or a very large value to
//                           include the full history.
//   - leagues     string[] — restrict to these leagues.
//   - markets     string[] — restrict to these market types ("spread", ...).
//   - buckets     number   — equal-frequency edge buckets for monotonicity.
//                            Default 4. Min 2.
router.post("/admin/calibration-review", async (req, res) => {
  try {
    const { secret, format, sinceDays, leagues, markets, buckets } = req.body ?? {};
    const expected = process.env.SESSION_SECRET;
    if (!expected || !secret || secret !== expected) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (format !== undefined && format !== "json" && format !== "markdown") {
      return res.status(400).json({
        ok: false,
        error: "format must be 'json' or 'markdown'",
      });
    }

    const sinceDaysN =
      sinceDays === undefined || sinceDays === null
        ? 180
        : Number(sinceDays);
    if (!Number.isFinite(sinceDaysN) || sinceDaysN < 0) {
      return res.status(400).json({
        ok: false,
        error: "sinceDays must be a non-negative number",
      });
    }

    const bucketCount =
      buckets === undefined || buckets === null ? 4 : Number(buckets);
    if (!Number.isInteger(bucketCount) || bucketCount < 2 || bucketCount > 20) {
      return res.status(400).json({
        ok: false,
        error: "buckets must be an integer in [2, 20]",
      });
    }

    const isStringArray = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);
    if (leagues !== undefined && !isStringArray(leagues)) {
      return res.status(400).json({
        ok: false,
        error: "leagues must be an array of non-empty strings when provided",
      });
    }
    if (markets !== undefined && !isStringArray(markets)) {
      return res.status(400).json({
        ok: false,
        error: "markets must be an array of non-empty strings when provided",
      });
    }

    // Compute the `since` date string. sinceDaysN of 0 means "no date floor".
    const sinceDate =
      sinceDaysN > 0
        ? new Date(Date.now() - sinceDaysN * 86400_000)
            .toISOString()
            .slice(0, 10)
        : null;

    const conditions = [] as ReturnType<typeof gte>[];
    if (sinceDate) {
      conditions.push(gte(scoredPicksTable.date, sinceDate));
    }
    if (Array.isArray(leagues) && leagues.length > 0) {
      conditions.push(inArray(scoredPicksTable.league, leagues as string[]) as any);
    }
    if (Array.isArray(markets) && markets.length > 0) {
      conditions.push(inArray(scoredPicksTable.market, markets as string[]) as any);
    }

    // CRITICAL: NO isNull(dataQuality) filter here. NO PUBLIC_TRACK_RECORD_CUTOFFS
    // filter here. The whole point of this endpoint is to see EVERYTHING and
    // let the cohort analyzer label it. Public read paths are unaffected.
    const baseQuery = db.select().from(scoredPicksTable);
    const rows = await (conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery);

    const cohortRows: CohortInputRow[] = rows.map((r) => ({
      league: r.league,
      market: r.market,
      tier: r.tier,
      date: r.date,
      publishOdds: r.publishOdds,
      edge: r.edge,
      ev: r.ev,
      result: r.result,
      clvImpliedDelta: r.clvImpliedDelta,
      modelProbCalibrated: r.modelProbCalibrated,
      marketProbFair: r.marketProbFair,
      dataQuality: r.dataQuality,
    }));

    const report = summarizeCohorts(cohortRows, {
      cutoffs: PUBLIC_TRACK_RECORD_CUTOFFS,
      monotonicityBuckets: bucketCount,
    });

    if (format === "markdown") {
      return res
        .type("text/markdown")
        .send(renderCohortReportMarkdown(report));
    }

    return res.json({
      ok: true,
      sinceDays: sinceDaysN,
      sinceDate,
      leaguesFilter: Array.isArray(leagues) ? leagues : null,
      marketsFilter: Array.isArray(markets) ? markets : null,
      bucketCount,
      report,
    });
  } catch (err) {
    logger.error({ err }, "Admin calibration-review failed");
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// /admin/clv-health — verify the CLV pipeline is producing real signal.
//
// Three signals reported per (league, market) over the trailing window:
//
//   capture_rate     — % of final game_snapshots in the window with non-null
//                      home_close_ml. Below ~95% = the closing-odds cron is
//                      missing games; check logs for clv_capture_failed.
//
//   writeback_rate   — % of settled scored_picks (result in {win, loss, push})
//                      with non-null clv_implied_delta. Below ~95% = a
//                      validation path is failing to call
//                      computeClvWritebackValues — usually a market the
//                      writeback helper doesn't yet handle.
//
//   publish_eq_close — % of settled picks where close_odds == publish_odds.
//                      The smoking-gun signal for the pre-fix bug: if this
//                      is near 100%, the publish→close copy is still active
//                      somewhere. Real markets move on most games, so a
//                      healthy value is ~10-30% (depending on market and
//                      lead time). 50%+ is a structural problem.
//
// Plus a clv distribution (n / mean / std / p10 / p50 / p90) so the
// operator can sanity-check that clv_implied_delta isn't degenerate.
//
// Auth: same SESSION_SECRET POST-body pattern as the other admin routes.
// Window: configurable via `sinceDays` (default 14, max 365).
// ---------------------------------------------------------------------------
router.post("/admin/clv-health", async (req, res) => {
  try {
    const { secret, sinceDays } = req.body ?? {};
    const expected = process.env.SESSION_SECRET;
    if (!expected || !secret || secret !== expected) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const sinceDaysN =
      sinceDays === undefined || sinceDays === null ? 14 : Number(sinceDays);
    if (!Number.isFinite(sinceDaysN) || sinceDaysN <= 0 || sinceDaysN > 365) {
      return res.status(400).json({
        ok: false,
        error: "sinceDays must be a positive number <= 365",
      });
    }

    const sinceDate = new Date(Date.now() - sinceDaysN * 86400_000)
      .toISOString()
      .slice(0, 10);

    // Capture rate: per (league) — % of final snapshots with close odds set.
    // Limited to status='final' so we only count games where capture *should*
    // have happened by now (excludes future-scheduled games sitting in the
    // window with close_* legitimately still null).
    const captureRows = await db
      .select({
        league: gameSnapshotsTable.league,
        total: sql<number>`count(*)::int`,
        withClose: sql<number>`count(${gameSnapshotsTable.homeCloseMl})::int`,
      })
      .from(gameSnapshotsTable)
      .where(
        and(
          gte(gameSnapshotsTable.snapshotDate, sinceDate),
          sql`${gameSnapshotsTable.status} = 'final'`,
        ),
      )
      .groupBy(gameSnapshotsTable.league);

    // Writeback + publish-equals-close + CLV distribution: per (league, market).
    // Only settled picks (win/loss/push); pending picks legitimately have null
    // CLV until the validation cron runs.
    //
    // publishEqClose conditions on close_odds NOT NULL in BOTH the numerator
    // and the denominator (architect review fix). The earlier divisor of "all
    // settled picks" understated copy-bug prevalence whenever capture was
    // incomplete: a pick with null close_odds was treated like a non-equal
    // sample, so a 100%-equal-and-50%-captured cohort scored 50% instead of
    // 100%. The conditioned ratio cleanly separates "we have the data and it
    // says copy" from "we don't have the data" (covered by capture_rate /
    // writeback_rate).
    const wbRows = await db
      .select({
        league: scoredPicksTable.league,
        market: scoredPicksTable.market,
        total: sql<number>`count(*)::int`,
        withClv: sql<number>`count(${scoredPicksTable.clvImpliedDelta})::int`,
        withClose: sql<number>`count(${scoredPicksTable.closeOdds})::int`,
        publishEqCloseAmongCaptured: sql<number>`sum(case when ${scoredPicksTable.closeOdds} is not null and abs(${scoredPicksTable.publishOdds}::numeric - ${scoredPicksTable.closeOdds}::numeric) < 0.5 then 1 else 0 end)::int`,
        clvCount: sql<number>`count(${scoredPicksTable.clvImpliedDelta})::int`,
        clvMean: sql<number | null>`avg(${scoredPicksTable.clvImpliedDelta}::numeric)::float`,
        clvStd: sql<number | null>`stddev_pop(${scoredPicksTable.clvImpliedDelta}::numeric)::float`,
        clvP10: sql<number | null>`percentile_cont(0.10) within group (order by ${scoredPicksTable.clvImpliedDelta}::numeric)::float`,
        clvP50: sql<number | null>`percentile_cont(0.50) within group (order by ${scoredPicksTable.clvImpliedDelta}::numeric)::float`,
        clvP90: sql<number | null>`percentile_cont(0.90) within group (order by ${scoredPicksTable.clvImpliedDelta}::numeric)::float`,
      })
      .from(scoredPicksTable)
      .where(
        and(
          gte(scoredPicksTable.date, sinceDate),
          inArray(scoredPicksTable.result, ["win", "loss", "push"]),
        ),
      )
      .groupBy(scoredPicksTable.league, scoredPicksTable.market);

    const captureByLeague = captureRows.map((r) => ({
      league: r.league,
      finalSnapshots: r.total,
      withClose: r.withClose,
      captureRate: r.total > 0 ? r.withClose / r.total : 0,
    }));

    const writebackByLeagueMarket = wbRows.map((r) => ({
      league: r.league,
      market: r.market,
      settledPicks: r.total,
      withClv: r.withClv,
      withClose: r.withClose,
      writebackRate: r.total > 0 ? r.withClv / r.total : 0,
      // Both rates are exposed (architect review fix). The "AmongCaptured"
      // rate is the honest copy-bug detector — it's only meaningful where
      // we actually captured a close, and conditioning on that prevents
      // capture gaps from masking copy-bug prevalence. The "Overall" rate
      // is kept so a single number still signals "rate of contaminated
      // CLV across all settled picks" for at-a-glance dashboards.
      publishEqualsCloseRateAmongCaptured:
        r.withClose > 0 ? r.publishEqCloseAmongCaptured / r.withClose : 0,
      publishEqualsCloseRateOverall: r.total > 0 ? r.publishEqCloseAmongCaptured / r.total : 0,
      clv: {
        n: r.clvCount,
        mean: r.clvMean,
        std: r.clvStd,
        p10: r.clvP10,
        p50: r.clvP50,
        p90: r.clvP90,
      },
    }));

    return res.json({
      ok: true,
      sinceDays: sinceDaysN,
      sinceDate,
      captureByLeague,
      writebackByLeagueMarket,
    });
  } catch (err) {
    logger.error({ err }, "Admin clv-health failed");
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
