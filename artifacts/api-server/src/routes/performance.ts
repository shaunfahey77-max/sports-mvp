import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { scoredPicksTable, validationMetricsTable, candidateBetsTable } from "@workspace/db";
import { eq, and, gte, desc, ne, count, inArray, or, isNull } from "drizzle-orm";
import { computeValidationMetrics, type PickWithFullData } from "../scoring/validatePicks";
import { americanToDecimal } from "../scoring/marketProb";
import { DATA_QUALITY_PRE_FIX } from "../config/scoringModelConfig";
import { buildPreFixExclusionCondition } from "../lib/preFixCutoff";

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

  const conditions = [gte(scoredPicksTable.date, cutoff)];
  if (league) {
    conditions.push(eq(scoredPicksTable.league, league));
  } else {
    conditions.push(inArray(scoredPicksTable.league, [...DEFAULT_PRODUCTION_LEAGUES]));
  }
  if (market) conditions.push(eq(scoredPicksTable.market, market));
  // Public surface: exclude pre-fix contaminated picks per
  // PUBLIC_TRACK_RECORD_CUTOFFS. Raw rows remain in scored_picks for audit;
  // only the public read filters them out.
  const scoredPicksExclusion = buildPreFixExclusionCondition(
    scoredPicksTable.league,
    scoredPicksTable.date,
  );
  if (scoredPicksExclusion) conditions.push(scoredPicksExclusion);

  const picks = await db
    .select()
    .from(scoredPicksTable)
    .where(and(...conditions));

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

  const picksForValidation: PickWithFullData[] = picks.map((p) => ({
    id: p.id,
    league: p.league,
    market: p.market,
    pick: p.pick,
    publishOdds: parseFloat(p.publishOdds),
    closeOdds: p.closeOdds ? parseFloat(p.closeOdds) : null,
    closeLine: p.closeLine ? parseFloat(p.closeLine) : null,
    publishLine: p.publishLine ? parseFloat(p.publishLine) : null,
    modelProbCalibrated: parseFloat(p.modelProbCalibrated),
    result: p.result as "win" | "loss" | "push" | "pending",
    ev: parseFloat(p.ev),
    edge: parseFloat(p.edge),
    clvImpliedDelta: p.clvImpliedDelta ? parseFloat(p.clvImpliedDelta) : null,
    tier: p.tier,
  }));

  const metrics = computeValidationMetrics(picksForValidation, window);

  res.json({
    windowDays: window,
    league: league ?? null,
    market: market ?? null,
    ...metrics,
    passRate,
  });
});

router.get("/performance/history", async (req, res): Promise<void> => {
  const { league, market } = req.query as Record<string, string | undefined>;
  const days = parseInt((req.query.days as string) ?? "45");

  const conditions = [];
  if (league) {
    conditions.push(eq(validationMetricsTable.league, league));
  } else {
    // Gate NCAAM (experimental) off the default history surface.
    conditions.push(inArray(validationMetricsTable.league, [...DEFAULT_PRODUCTION_LEAGUES]));
  }
  if (market) conditions.push(eq(validationMetricsTable.market, market));

  // Public surface: exclude rows labeled as contaminated. We filter on the
  // explicit data_quality label (set by scripts/label-pre-fix-validation-metrics.ts
  // from the same PUBLIC_TRACK_RECORD_CUTOFFS source of truth) AND defensively
  // re-apply the date cutoff so any unlabeled-but-pre-fix row (e.g. a fresh
  // backfill that ran before label) is also excluded. Both expressions point
  // at the same underlying cutoff, so they always agree once labels are in sync.
  conditions.push(
    or(
      isNull(validationMetricsTable.dataQuality),
      ne(validationMetricsTable.dataQuality, DATA_QUALITY_PRE_FIX),
    )!,
  );
  const historyExclusion = buildPreFixExclusionCondition(
    validationMetricsTable.league,
    validationMetricsTable.runDate,
  );
  if (historyExclusion) conditions.push(historyExclusion);

  const records = await db
    .select()
    .from(validationMetricsTable)
    .where(and(...conditions))
    .orderBy(desc(validationMetricsTable.runDate))
    .limit(days);

  res.json(records);
});

// NOTE: We deliberately do NOT expose an HTTP audit endpoint that would
// return contaminated rows. Raw rows remain in the `validation_metrics`
// table (with the `data_quality` label distinguishing pre-fix rows) and
// are accessible only via internal database tooling — keeping the public
// HTTP surface free of any path that could leak the contaminated history.

export default router;
