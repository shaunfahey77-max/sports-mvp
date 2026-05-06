import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  scoredPicksTable,
  candidateBetsTable,
  evaluationResultsTable,
} from "@workspace/db";
import { eq, and, gte, desc, ne, count, inArray, or, isNull } from "drizzle-orm";
import { GetPerformanceModelWatchQueryParams } from "@workspace/api-zod";
import { computeValidationMetrics, type PickWithFullData } from "../scoring/validatePicks";
import { mergeOfficialPerformanceRows } from "../scoring/officialPerformanceMerge";
import {
  buildOfficialHistoryRecords,
  mergeOfficialHistoryRows,
} from "../scoring/officialHistoryRecords";
import { americanToDecimal } from "../scoring/marketProb";
import {
  DATA_QUALITY_PRE_FIX,
  MARKET_MODEL_WATCH_ONLY,
  PUBLIC_TRACK_RECORD_CUTOFFS,
} from "../config/scoringModelConfig";
import { resolveMarketKeysForSurfaceStatus } from "../scoring/marketRegistryResolver";
import { buildPreFixExclusionCondition } from "../lib/preFixCutoff";
import {
  summarizeModelWatchRows,
  type AggregatorRow,
} from "../scoring/modelWatchAggregator";

/**
 * Compute the effective public-track-record floor for a window.
 *
 * The public read filter excludes any pick before its league's pre-fix
 * cutoff (`PUBLIC_TRACK_RECORD_CUTOFFS`). When that cutoff is later than
 * the requested `windowDays` cutoff, the actual measurable span is
 * shorter than the requested window — which silently inflates or
 * deflates per-day rates (notably `picksPerDay`). To keep rate metrics
 * honest we surface both the start date and the day-count of the
 * effective window so the same divisor can be used server-side and the
 * UI can disclose the truncation.
 *
 * For multi-league responses we take the EARLIEST per-league effective
 * start, because the dataset includes any league from its own floor
 * onward — so the union starts whenever the earliest one starts.
 */
export function computeEffectiveWindow(
  windowDays: number,
  includedLeagues: readonly string[],
  now: Date = new Date(),
): { effectiveStartDate: string; effectiveDays: number } {
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windowStart = new Date(todayUtc);
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);

  const perLeagueStarts: Date[] = includedLeagues.map((l) => {
    const cutoff = PUBLIC_TRACK_RECORD_CUTOFFS[l];
    if (!cutoff) return windowStart;
    const cutoffDate = new Date(`${cutoff}T00:00:00Z`);
    return cutoffDate > windowStart ? cutoffDate : windowStart;
  });

  const effectiveStart = perLeagueStarts.length === 0
    ? windowStart
    : perLeagueStarts.reduce((a, b) => (a < b ? a : b));

  const msPerDay = 86_400_000;
  const rawDays = Math.round((todayUtc.getTime() - effectiveStart.getTime()) / msPerDay);
  // Clamp to [1, windowDays]: never report 0 (would divide by zero
  // downstream) and never report longer than the requested window
  // (would lie about the measurable span in the other direction).
  const effectiveDays = Math.max(1, Math.min(windowDays, rawDays));

  return {
    effectiveStartDate: effectiveStart.toISOString().split("T")[0]!,
    effectiveDays,
  };
}

// Production leagues surfaced in performance metrics by default.
// NCAAM is experimental (hash-noise models) and must be opted into explicitly.
const DEFAULT_PRODUCTION_LEAGUES = ["nba", "nhl"] as const;

// Re-export so existing callers that imported the helper from this module
// continue to compile. New callers should import from "../lib/preFixCutoff".
export { buildPreFixExclusionCondition };

const router: IRouter = Router();

router.get("/performance", async (req, res): Promise<void> => {
  const { league, market } = req.query as Record<string, string | undefined>;
  const window = parseInt((req.query.window as string) ?? "30");

  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - window);
  const cutoff = cutoffDate.toISOString().split("T")[0];

  const scoredPicksConditions = [gte(scoredPicksTable.date, cutoff)];
  if (league) {
    scoredPicksConditions.push(eq(scoredPicksTable.league, league));
  } else {
    scoredPicksConditions.push(inArray(scoredPicksTable.league, [...DEFAULT_PRODUCTION_LEAGUES]));
  }
  if (market) scoredPicksConditions.push(eq(scoredPicksTable.market, market));
  // Public surface: exclude pre-fix contaminated picks per
  // PUBLIC_TRACK_RECORD_CUTOFFS. Raw rows remain in scored_picks for audit;
  // only the public read filters them out.
  const scoredPicksExclusion = buildPreFixExclusionCondition(
    scoredPicksTable.league,
    scoredPicksTable.date,
  );
  if (scoredPicksExclusion) scoredPicksConditions.push(scoredPicksExclusion);
  // Surgical exclusion: any row carrying a non-null data_quality label
  // (e.g. "contaminated_ingest" applied to specific stale-quote NHL games)
  // is hidden from the public surface. Raw rows remain in scored_picks
  // for audit. NULL = clean / publishable.
  scoredPicksConditions.push(isNull(scoredPicksTable.dataQuality));

  const evaluationConditions = [
    gte(evaluationResultsTable.date, cutoff),
    eq(evaluationResultsTable.surfaceStatus, "official"),
  ];
  if (league) {
    evaluationConditions.push(eq(evaluationResultsTable.league, league));
  } else {
    evaluationConditions.push(
      inArray(evaluationResultsTable.league, [...DEFAULT_PRODUCTION_LEAGUES]),
    );
  }
  if (market) evaluationConditions.push(eq(evaluationResultsTable.market, market));
  const evaluationExclusion = buildPreFixExclusionCondition(
    evaluationResultsTable.league,
    evaluationResultsTable.date,
  );
  if (evaluationExclusion) evaluationConditions.push(evaluationExclusion);

  const [evaluationRows, scoredPickRows] = await Promise.all([
    db
      .select({
        date: evaluationResultsTable.date,
        gameKey: evaluationResultsTable.gameKey,
        league: evaluationResultsTable.league,
        market: evaluationResultsTable.market,
        pick: evaluationResultsTable.pick,
        result: evaluationResultsTable.result,
        publishOdds: evaluationResultsTable.publishOdds,
        publishLine: evaluationResultsTable.publishLine,
        closeOdds: evaluationResultsTable.closeOdds,
        closeLine: evaluationResultsTable.closeLine,
        modelProbCalibrated: evaluationResultsTable.modelProbCalibrated,
        edge: evaluationResultsTable.edge,
        ev: evaluationResultsTable.ev,
        clvImpliedDelta: evaluationResultsTable.clvImpliedDelta,
        tier: evaluationResultsTable.tier,
      })
      .from(evaluationResultsTable)
      .where(and(...evaluationConditions)),
    db
    .select()
    .from(scoredPicksTable)
    .where(and(...scoredPicksConditions)),
  ]);

  const picksForValidation = mergeOfficialPerformanceRows({
    evaluationRows,
    scoredPickRows,
  });

  const candidateConditions = [gte(candidateBetsTable.snapshotDate, cutoff)];
  if (league) {
    candidateConditions.push(eq(candidateBetsTable.league, league));
  } else {
    candidateConditions.push(inArray(candidateBetsTable.league, [...DEFAULT_PRODUCTION_LEAGUES]));
  }
  if (market) candidateConditions.push(eq(candidateBetsTable.marketType, market));
  // Pass-rate is also a public statistic — apply the same cutoff to
  // candidate_bets so pre-fix candidate volume doesn't drag the published
  // pass-rate up or down.
  const candidatesExclusion = buildPreFixExclusionCondition(
    candidateBetsTable.league,
    candidateBetsTable.snapshotDate,
  );
  if (candidatesExclusion) candidateConditions.push(candidatesExclusion);
  // Mirror the surgical scored_picks exclusion: any candidate carrying a
  // non-null data_quality label is hidden from the public pass-rate.
  candidateConditions.push(isNull(candidateBetsTable.dataQuality));

  const [totalCandidatesRow, publishedCandidatesRow] = await Promise.all([
    db
      .select({ total: count() })
      .from(candidateBetsTable)
      .where(and(...candidateConditions))
      .then((r) => r[0]),
    db
      .select({ total: count() })
      .from(candidateBetsTable)
      .where(and(...candidateConditions, ne(candidateBetsTable.tier, "PASS")))
      .then((r) => r[0]),
  ]);

  const totalCandidates = totalCandidatesRow?.total ?? 0;
  const publishedCandidates = publishedCandidatesRow?.total ?? 0;
  const passRate = totalCandidates > 0 ? publishedCandidates / totalCandidates : 0;

  // Determine the effective public-track-record window. The pre-fix
  // cutoff can be stricter than the requested `window` cutoff, in which
  // case the actual measurable span is shorter and `picksPerDay` must
  // use that shorter span as its divisor — otherwise the rate silently
  // changes between windows that admit the exact same pick set.
  const includedLeagues = league ? [league] : [...DEFAULT_PRODUCTION_LEAGUES];
  const { effectiveStartDate, effectiveDays } = computeEffectiveWindow(
    window,
    includedLeagues,
  );

  const metrics = computeValidationMetrics(picksForValidation, effectiveDays);

  res.json({
    windowDays: window,
    effectiveStartDate,
    effectiveDays,
    league: league ?? null,
    market: market ?? null,
    ...metrics,
    passRate,
  });
});

router.get("/performance/history", async (req, res): Promise<void> => {
  const { league, market } = req.query as Record<string, string | undefined>;
  const days = parseInt((req.query.days as string) ?? "45");

  const scoredConditions = [];
  const evaluationConditions = [];
  if (league) {
    scoredConditions.push(eq(scoredPicksTable.league, league));
    evaluationConditions.push(eq(evaluationResultsTable.league, league));
  } else {
    // Gate NCAAM (experimental) off the default history surface.
    scoredConditions.push(inArray(scoredPicksTable.league, [...DEFAULT_PRODUCTION_LEAGUES]));
    evaluationConditions.push(
      inArray(evaluationResultsTable.league, [...DEFAULT_PRODUCTION_LEAGUES]),
    );
  }
  if (market) {
    scoredConditions.push(eq(scoredPicksTable.market, market));
    evaluationConditions.push(eq(evaluationResultsTable.market, market));
  }

  // Public surface: exclude rows labeled as contaminated. We filter on the
  // explicit data_quality label on scored_picks AND defensively re-apply the
  // date cutoff to both legacy and rebuilt rows so unlabeled-but-pre-fix data
  // cannot leak onto the public history surface.
  scoredConditions.push(isNull(scoredPicksTable.dataQuality));
  const scoredHistoryExclusion = buildPreFixExclusionCondition(
    scoredPicksTable.league,
    scoredPicksTable.date,
  );
  if (scoredHistoryExclusion) scoredConditions.push(scoredHistoryExclusion);
  const evaluationHistoryExclusion = buildPreFixExclusionCondition(
    evaluationResultsTable.league,
    evaluationResultsTable.date,
  );
  if (evaluationHistoryExclusion) evaluationConditions.push(evaluationHistoryExclusion);
  evaluationConditions.push(eq(evaluationResultsTable.surfaceStatus, "official"));

  const [scoredPickRows, evaluationRows] = await Promise.all([
    db
      .select()
      .from(scoredPicksTable)
      .where(and(...scoredConditions))
      .orderBy(desc(scoredPicksTable.date), desc(scoredPicksTable.rankScore)),
    db
      .select({
        date: evaluationResultsTable.date,
        gameKey: evaluationResultsTable.gameKey,
        league: evaluationResultsTable.league,
        market: evaluationResultsTable.market,
        pick: evaluationResultsTable.pick,
        result: evaluationResultsTable.result,
        publishOdds: evaluationResultsTable.publishOdds,
        publishLine: evaluationResultsTable.publishLine,
        closeOdds: evaluationResultsTable.closeOdds,
        closeLine: evaluationResultsTable.closeLine,
        modelProbCalibrated: evaluationResultsTable.modelProbCalibrated,
        edge: evaluationResultsTable.edge,
        ev: evaluationResultsTable.ev,
        clvImpliedDelta: evaluationResultsTable.clvImpliedDelta,
        tier: evaluationResultsTable.tier,
      })
      .from(evaluationResultsTable)
      .where(and(...evaluationConditions))
      .orderBy(desc(evaluationResultsTable.date), desc(evaluationResultsTable.updatedAt)),
  ]);

  const mergedRows = mergeOfficialHistoryRows({
    evaluationRows,
    scoredPickRows,
  });

  const records = buildOfficialHistoryRecords({
    rows: mergedRows,
    league,
    market,
    limit: days,
  });

  res.json(records);
});

// NOTE: We deliberately do NOT expose an HTTP audit endpoint that would
// return contaminated rows. Raw rows remain in the `validation_metrics`
// table (with the `data_quality` label distinguishing pre-fix rows) and
// are accessible only via internal database tooling — keeping the public
// HTTP surface free of any path that could leak the contaminated history.

// ---------------------------------------------------------------------------
// Public Model-Watch summary
// ---------------------------------------------------------------------------
//
// Read-only summary strip surfaced on the public Performance page. The
// scored_picks / validation_metrics queries above stay untouched —
// Model-Watch data flows ONLY through this endpoint and the wall between
// Official and Watch is preserved (separate table, separate query,
// separate visual lane in the UI).
//
// Math is shared with the admin scoreboard via `aggregateRows` so the
// public surface and the admin surface can never disagree.

router.get("/performance/model-watch", async (req, res): Promise<void> => {
  // Express delivers query params as strings (e.g. `?window=30` →
  // `req.query.window === "30"`). The generated Zod schema uses literal
  // numbers (14 / 30 / 45), so coerce a present `window` to a number
  // before validation. A missing `window` falls through to the schema
  // default (30).
  const rawWindow = req.query.window;
  const queryForParse: Record<string, unknown> = { ...req.query };
  if (typeof rawWindow === "string" && rawWindow.length > 0) {
    const asNum = Number(rawWindow);
    if (Number.isFinite(asNum)) {
      queryForParse.window = asNum;
    }
  }
  const parsed = GetPerformanceModelWatchQueryParams.safeParse(queryForParse);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const window = parsed.data.window;

  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - window);
  const cutoff = cutoffDate.toISOString().split("T")[0];

  // Filter to resolved rows only — the public strip reports "Leans graded",
  // not pending. This matches the way the Official Performance numbers are
  // built (validate-then-aggregate).
  // gameKey + modelProbCalibrated are required by summarizeModelWatchRows
  // to dedup the home/away pair down to the model-favored side per game.
  // Without them the public win-rate is structurally pinned at ~50%.
  const fallbackRegistryKeys = Object.entries(MARKET_MODEL_WATCH_ONLY)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  const registryResolution = await resolveMarketKeysForSurfaceStatus(
    "model_watch",
    fallbackRegistryKeys,
  );
  const modelWatchRegistry: Partial<Record<string, boolean>> = Object.fromEntries(
    registryResolution.keys.map((key) => [key, true]),
  );

  const rows = await db
    .select({
      league: evaluationResultsTable.league,
      market: evaluationResultsTable.market,
      tier: evaluationResultsTable.tier,
      publishOdds: evaluationResultsTable.publishOdds,
      edge: evaluationResultsTable.edge,
      ev: evaluationResultsTable.ev,
      result: evaluationResultsTable.result,
      clvImpliedDelta: evaluationResultsTable.clvImpliedDelta,
      gameKey: evaluationResultsTable.gameKey,
      pick: evaluationResultsTable.pick,
      date: evaluationResultsTable.date,
      modelProbCalibrated: evaluationResultsTable.modelProbCalibrated,
    })
    .from(evaluationResultsTable)
    .where(
      and(
        gte(evaluationResultsTable.date, cutoff),
        eq(evaluationResultsTable.surfaceStatus, "model_watch"),
        inArray(evaluationResultsTable.result, ["win", "loss", "push"]),
      ),
    )
    // Deterministic order so the favored-side dedup's tie-break (first
    // row wins on equal modelProbCalibrated) is stable across calls. id
    // is the primary key, guaranteeing total ordering.
    .orderBy(
      desc(evaluationResultsTable.date),
      desc(evaluationResultsTable.updatedAt),
      evaluationResultsTable.gameKey,
      evaluationResultsTable.market,
      evaluationResultsTable.pick,
    );

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
    modelProbCalibrated: r.modelProbCalibrated,
  }));

  const summary = summarizeModelWatchRows(aggRows, modelWatchRegistry);

  res.json({
    windowDays: window,
    ...summary,
  });
});

export default router;
