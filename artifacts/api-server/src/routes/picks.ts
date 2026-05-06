import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  gameSnapshotsTable,
  candidateBetsTable,
  scoredPicksTable,
  evaluationResultsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, inArray, sql, isNull, or } from "drizzle-orm";
import {
  ScoreDateBody,
  ValidatePicksBody,
} from "@workspace/api-zod";
import {
  isOfficialCandidate,
  scorePicks,
  type GameMarketInput,
} from "../scoring/scorePicks";
import { computeOutcomeResult } from "../scoring/validatePicks";
import { computeClvWritebackValues } from "../scoring/clvWriteback";
import {
  deletePendingOfficialEvaluationResult,
  settleOfficialEvaluationResult,
  upsertOfficialCandidateEvaluation,
} from "../scoring/officialEvaluationWriter";
import type { League, MarketType } from "../config/scoringModelConfig";
import { ODDS_RANGE_GUARDRAIL_LEAGUES } from "../config/scoringModelConfig";
import { capAndSort, computeStaleScoredPicksKeys } from "../lib/pickUtils";
import { buildPreFixExclusionCondition } from "../lib/preFixCutoff";
import { buildPlausibleEventStartCondition } from "../lib/plausibleEventStart";
import { mergeOfficialPickRows } from "../scoring/officialPicksMerge";

// Leagues surfaced by default to subscribers. NCAAM is experimental (hash-noise
// pseudo-models) and must be requested explicitly via ?league=ncaam.
const DEFAULT_PRODUCTION_LEAGUES = ["nba", "nhl"] as const;

/**
 * Narrow allowlist of (league, market) pairs surfaced ONLY through the
 * candidates endpoint so the dashboard can render its existing Model Watch
 * row for transparency. These pairs are NOT in DEFAULT_PRODUCTION_LEAGUES
 * — they intentionally do not enter scored_picks, /performance, or
 * /history. They only need to be reachable from /picks/candidates so the
 * FallbackCandidateCard can pick them up alongside the existing
 * MARKET_MODEL_WATCH_ONLY treatment in scoring.
 *
 * Today this is a single entry: MLB moneyline. NHL spread is already
 * reachable because NHL is in DEFAULT_PRODUCTION_LEAGUES.
 */
const MODEL_WATCH_ONLY_CANDIDATE_PAIRS: ReadonlyArray<{
  league: string;
  market: string;
}> = [{ league: "mlb", market: "moneyline" }];

type CandidateSurfaceStatus =
  | "shadow"
  | "model_watch"
  | "official"
  | "suppressed";

function resolvePersistedCandidateSurfaceStatus(candidate: {
  surfaceStatus?: string | null;
  selectionReason?: string | null;
}): CandidateSurfaceStatus {
  if (
    candidate.surfaceStatus === "shadow" ||
    candidate.surfaceStatus === "model_watch" ||
    candidate.surfaceStatus === "official" ||
    candidate.surfaceStatus === "suppressed"
  ) {
    return candidate.surfaceStatus;
  }

  // Transitional fallback for rows written before candidate_bets.surface_status
  // existed or before the migration has been applied in a target environment.
  if (candidate.selectionReason === "model_watch_only") return "model_watch";
  if (candidate.selectionReason === "market_disabled") return "suppressed";
  return "shadow";
}

function isRenderableCandidateRow(candidate: {
  tier: string;
  selectionReason?: string | null;
  surfaceStatus?: string | null;
}): boolean {
  const surfaceStatus = resolvePersistedCandidateSurfaceStatus(candidate);
  if (surfaceStatus === "suppressed") return false;

  // PASS rows should only ever surface through the explicit Model Watch lane.
  if (candidate.tier === "PASS") {
    return (
      surfaceStatus === "model_watch" &&
      candidate.selectionReason === "model_watch_only"
    );
  }

  // Non-PASS rows are renderable for active surfaces. In the rebuild, that is
  // typically shadow/official; model_watch should already have been forced to
  // PASS at score time, but allowing it here keeps older rows from vanishing
  // unexpectedly during the transition.
  return (
    surfaceStatus === "shadow" ||
    surfaceStatus === "official" ||
    surfaceStatus === "model_watch"
  );
}

const router: IRouter = Router();

router.get("/picks", async (req, res): Promise<void> => {
  const { date, league, market, tier, result } = req.query as Record<string, string | undefined>;
  const limit = parseInt((req.query.limit as string) ?? "200");
  const offset = parseInt((req.query.offset as string) ?? "0");

  const conditions = [];
  const evaluationConditions = [];
  if (date) conditions.push(eq(scoredPicksTable.date, date));
  if (date) evaluationConditions.push(eq(evaluationResultsTable.date, date));
  if (league) {
    conditions.push(eq(scoredPicksTable.league, league));
    evaluationConditions.push(eq(evaluationResultsTable.league, league));
  } else {
    // No explicit league filter → serve production leagues only (exclude experimental NCAAM).
    conditions.push(inArray(scoredPicksTable.league, [...DEFAULT_PRODUCTION_LEAGUES]));
    evaluationConditions.push(
      inArray(evaluationResultsTable.league, [...DEFAULT_PRODUCTION_LEAGUES]),
    );
  }
  if (market) conditions.push(eq(scoredPicksTable.market, market));
  if (market) evaluationConditions.push(eq(evaluationResultsTable.market, market));
  if (tier) conditions.push(eq(scoredPicksTable.tier, tier));
  if (tier) evaluationConditions.push(eq(evaluationResultsTable.tier, tier));
  if (result) conditions.push(eq(scoredPicksTable.result, result));
  if (result) evaluationConditions.push(eq(evaluationResultsTable.result, result));

  // Public read surface: exclude pre-fix contaminated picks per
  // PUBLIC_TRACK_RECORD_CUTOFFS. Raw rows remain in scored_picks for audit;
  // only the public read filters them out. Mirrors the same exclusion
  // already applied by /performance and /performance/history so the
  // History page (which lists raw picks) cannot show picks that the
  // Performance page silently omits.
  const scoredPicksExclusion = buildPreFixExclusionCondition(
    scoredPicksTable.league,
    scoredPicksTable.date,
  );
  if (scoredPicksExclusion) conditions.push(scoredPicksExclusion);
  // Surgical exclusion: any row carrying a non-null data_quality label
  // (e.g. "contaminated_ingest" applied to specific stale-quote NHL games)
  // is hidden from the public surface. Mirrors /performance so the History
  // page cannot show picks that the Performance page silently omits.
  conditions.push(isNull(scoredPicksTable.dataQuality));
  // Plausible-commence-time guard. See `lib/plausibleEventStart.ts` for
  // the bug history. Hides any scored pick whose `eventStart` projects
  // to an ET hour outside its league's plausible window — defense in
  // depth alongside the matching ingest-time guard in `transformGame`.
  // NULL `eventStart` is admitted (legacy rows lack this column).
  // Leagues not in the registry default-allow.
  const plausibleScoredPicksCondition = buildPlausibleEventStartCondition(
    scoredPicksTable.league,
    scoredPicksTable.eventStart,
  );
  if (plausibleScoredPicksCondition) conditions.push(plausibleScoredPicksCondition);

  evaluationConditions.push(eq(evaluationResultsTable.surfaceStatus, "official"));

  const [scoredPickRows, evaluationRows] = await Promise.all([
    conditions.length > 0
      ? db
          .select()
          .from(scoredPicksTable)
          .where(and(...conditions))
          .orderBy(desc(scoredPicksTable.rankScore))
      : db
          .select()
          .from(scoredPicksTable)
          .orderBy(desc(scoredPicksTable.rankScore)),
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
        modelProbRaw: evaluationResultsTable.modelProbRaw,
        modelProbCalibrated: evaluationResultsTable.modelProbCalibrated,
        marketProbFair: evaluationResultsTable.marketProbFair,
        edge: evaluationResultsTable.edge,
        ev: evaluationResultsTable.ev,
        rankScore: evaluationResultsTable.rankScore,
        tier: evaluationResultsTable.tier,
        clvLineDelta: evaluationResultsTable.clvLineDelta,
        clvImpliedDelta: evaluationResultsTable.clvImpliedDelta,
        modelVersion: evaluationResultsTable.modelVersion,
        scoringVersion: evaluationResultsTable.scoringVersion,
      })
      .from(evaluationResultsTable)
      .where(and(...evaluationConditions))
      .orderBy(desc(evaluationResultsTable.rankScore)),
  ]);

  const evaluationRowKeys = evaluationRows.map((row) =>
    and(
      eq(candidateBetsTable.snapshotDate, row.date),
      eq(candidateBetsTable.gameKey, row.gameKey),
      eq(candidateBetsTable.marketType, row.market),
      eq(candidateBetsTable.side, row.pick),
    ),
  );
  const plausibleCandidateCondition = buildPlausibleEventStartCondition(
    candidateBetsTable.league,
    candidateBetsTable.eventStart,
  );
  const candidateRows = evaluationRowKeys.length > 0
    ? await db
        .select({
          date: candidateBetsTable.snapshotDate,
          gameKey: candidateBetsTable.gameKey,
          market: candidateBetsTable.marketType,
          pick: candidateBetsTable.side,
          eventStart: candidateBetsTable.eventStart,
          createdAt: candidateBetsTable.createdAt,
        })
        .from(candidateBetsTable)
        .where(
          and(
            or(...evaluationRowKeys)!,
            isNull(candidateBetsTable.dataQuality),
            plausibleCandidateCondition ?? sql`true`,
          ),
        )
    : [];

  const scoredPickKeys = new Set(
    scoredPickRows.map((row) => `${row.date}|${row.gameKey}|${row.market}|${row.pick}`),
  );
  const candidateKeys = new Set(
    candidateRows.map((row) => `${row.date}|${row.gameKey}|${row.market}|${row.pick}`),
  );
  const filteredEvaluationRows = evaluationRows.filter((row) => {
    const key = `${row.date}|${row.gameKey}|${row.market}|${row.pick}`;
    return scoredPickKeys.has(key) || candidateKeys.has(key);
  });

  const merged = mergeOfficialPickRows({
    evaluationRows: filteredEvaluationRows,
    scoredPickRows,
    candidateRows,
  }).sort((a, b) => Number(b.rankScore) - Number(a.rankScore));

  // When filtering by a single date, apply per-league cap and re-sort chronologically.
  // Historical queries (no date, or multi-day) are returned as-is sorted by rankScore.
  const picks = date && !league
    ? capAndSort(merged.map(p => ({ ...p, eventStart: p.eventStart ?? p.date })))
    : merged.slice(offset, offset + limit);

  res.json({ picks, total: picks.length, offset, limit });
});

router.get("/picks/candidates", async (req, res): Promise<void> => {
  const { date, gameDate, league, market, tier } = req.query as Record<string, string | undefined>;

  const conditions = [];
  // `date` filters by snapshotDate (legacy); `gameDate` filters by the date embedded in gameKey
  if (date) conditions.push(eq(candidateBetsTable.snapshotDate, date));
  if (gameDate) {
    conditions.push(sql`${candidateBetsTable.gameKey} LIKE ${'%_' + gameDate + '_%'}`);
    // Stale-game-key guard: a candidate may only render on a slate if it was
    // re-evaluated by THAT slate's scoring run. Without this, stale game_keys
    // from earlier ingests (e.g. nhl_2026-05-04_min_col, last scored on
    // 2026-05-01, for a game the schedule later moved/dropped) continue to
    // surface on today's board even though today's ingest no longer believes
    // in them. Today's ingest is the source of truth for today's slate.
    conditions.push(eq(candidateBetsTable.snapshotDate, gameDate));
  }
  if (league) {
    conditions.push(eq(candidateBetsTable.league, league));
  } else {
    // No explicit league filter → serve production leagues by default, plus
    // the narrow set of (league, market) pairs that are Model-Watch-only.
    // MLB moneyline is admitted here (not in DEFAULT_PRODUCTION_LEAGUES)
    // so the dashboard can render its existing Model Watch row. NHL spread
    // is already reachable because NHL is in DEFAULT_PRODUCTION_LEAGUES.
    // Performance / History are unaffected because they read scored_picks,
    // not candidate_bets, and Model-Watch-only candidates never get
    // promoted into scored_picks.
    const watchPairCondition = or(
      ...MODEL_WATCH_ONLY_CANDIDATE_PAIRS.map((p) =>
        and(
          eq(candidateBetsTable.league, p.league),
          eq(candidateBetsTable.marketType, p.market),
        ),
      ),
    );
    const productionLeagueCondition = inArray(
      candidateBetsTable.league,
      [...DEFAULT_PRODUCTION_LEAGUES],
    );
    conditions.push(
      watchPairCondition
        ? or(productionLeagueCondition, watchPairCondition)!
        : productionLeagueCondition,
    );
  }
  if (market) conditions.push(eq(candidateBetsTable.marketType, market));
  if (tier) conditions.push(eq(candidateBetsTable.tier, tier));

  // Same public-cutoff exclusion as /picks above: pre-fix candidates
  // are still in candidate_bets for audit but should not surface here.
  const candidatesExclusion = buildPreFixExclusionCondition(
    candidateBetsTable.league,
    candidateBetsTable.snapshotDate,
  );
  if (candidatesExclusion) conditions.push(candidatesExclusion);
  // Surgical exclusion: any candidate carrying a non-null data_quality
  // label is hidden from the public surface. Mirrors /picks above.
  conditions.push(isNull(candidateBetsTable.dataQuality));
  // Plausible-commence-time guard. See `lib/plausibleEventStart.ts`
  // for the bug history. Hides any candidate whose `eventStart`
  // projects to an ET hour outside its league's plausible window.
  // This is the primary read-side defense for the documented NHL
  // 11:00 AM ET phantom (`nhl_2026-05-01_phi_car`, snapshot id 35681)
  // — without it, the row would continue to win the top board slot
  // until a destructive backfill ran. With it, the existing phantom
  // row stays in `candidate_bets` for audit but never surfaces on
  // `/picks/candidates`.
  const plausibleCandidatesCondition = buildPlausibleEventStartCondition(
    candidateBetsTable.league,
    candidateBetsTable.eventStart,
  );
  if (plausibleCandidatesCondition) conditions.push(plausibleCandidatesCondition);

  // Apply a hard cap so an unfiltered call (now always carrying the default
  // league filter) cannot return unbounded rows. Callers can pass ?limit to
  // widen it; we default to 200 to match the prior fallback behavior.
  const candidateLimit = parseInt((req.query.limit as string) ?? "200");
  const raw = await db
    .select()
    .from(candidateBetsTable)
    .where(and(...conditions))
    .orderBy(desc(candidateBetsTable.rankScore))
    .limit(candidateLimit);

  // Deduplicate: keep only the freshest candidate per (gameKey, marketType, side).
  // Multiple scoring runs (snapshot dates) produce rows for the same game;
  // prefer the latest snapshot so the board reflects current odds/edges.
  // Within the same snapshot date, break ties with highest EV.
  const seen = new Map<string, typeof raw[0]>();
  for (const c of raw) {
    const key = `${c.gameKey}|${c.marketType}|${c.side}`;
    const existing = seen.get(key);
    if (
      !existing ||
      c.snapshotDate > existing.snapshotDate ||
      (c.snapshotDate === existing.snapshotDate &&
        parseFloat(c.ev) > parseFloat(existing.ev))
    ) {
      seen.set(key, c);
    }
  }

  const deduped = Array.from(seen.values())
    .filter((c) => isRenderableCandidateRow(c))
    .sort((a, b) => parseFloat(b.rankScore) - parseFloat(a.rankScore))
    .map((c) => ({ ...c, eventStart: c.eventStart ?? new Date() }));

  const candidates = capAndSort(deduped);

  res.json(candidates);
});

router.post("/picks/score", async (req, res): Promise<void> => {
  const parsed = ScoreDateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    date,
    // NCAAM gated off by default — explicitly request via leagues: ["ncaam"] for inspection.
    leagues = [...DEFAULT_PRODUCTION_LEAGUES],
    markets = ["moneyline", "spread", "total"],
    modelVersion = "v1",
    scoringVersion = "v1",
  } = parsed.data;

  const snapshots = await db
    .select()
    .from(gameSnapshotsTable)
    .where(eq(gameSnapshotsTable.snapshotDate, date));

  const filtered = snapshots.filter((s) => (leagues as string[]).includes(s.league));

  if (filtered.length === 0) {
    res.json({
      date,
      totalCandidates: 0,
      picksGenerated: 0,
      tierBreakdown: {},
      leagueBreakdown: {},
      candidates: [],
    });
    return;
  }

  const gameInputs: GameMarketInput[] = filtered.map((s) => ({
    gameKey: s.gameKey,
    league: s.league as League,
    eventStart: s.eventStart,
    homeTeam: s.homeTeam,
    awayTeam: s.awayTeam,
    homePublishMl: parseFloat(s.homePublishMl),
    awayPublishMl: parseFloat(s.awayPublishMl),
    publishSpread: s.publishSpread ? parseFloat(s.publishSpread) : null,
    publishSpreadLine: s.publishSpreadLine ? parseFloat(s.publishSpreadLine) : null,
    publishAwaySpreadLine: s.publishAwaySpreadLine ? parseFloat(s.publishAwaySpreadLine) : null,
    publishTotal: s.publishTotal ? parseFloat(s.publishTotal) : null,
    publishOverLine: s.publishOverLine ? parseFloat(s.publishOverLine) : null,
    publishUnderLine: s.publishUnderLine ? parseFloat(s.publishUnderLine) : null,
    snapshotDate: date,
  }));

  const candidates = await scorePicks(gameInputs, markets as MarketType[], modelVersion, {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
  });

  const tierBreakdown: Record<string, number> = {};
  const leagueBreakdown: Record<string, number> = {};

  for (const c of candidates) {
    tierBreakdown[c.tier] = (tierBreakdown[c.tier] ?? 0) + 1;
    leagueBreakdown[c.league] = (leagueBreakdown[c.league] ?? 0) + 1;
  }

  if (candidates.length > 0) {
    await db
      .insert(candidateBetsTable)
      .values(
        candidates.map((c) => ({
          gameKey: c.gameKey,
          league: c.league,
          marketType: c.marketType,
          side: c.side,
          eventStart: c.eventStart,
          publishOdds: String(c.publishOdds),
          publishLine: c.publishLine != null ? String(c.publishLine) : undefined,
          modelProbRaw: String(c.modelProbRaw),
          modelProbCalibrated: String(c.modelProbCalibrated),
          marketProbFair: String(c.marketProbFair),
          edge: String(c.edge),
          ev: String(c.ev),
          rankScore: String(c.rankScore),
          tier: c.tier,
          calibrationMethod: c.calibrationMethod,
          calibrationVersion: c.calibrationVersion,
          marketQuality: String(c.marketQuality),
          selectionReason: c.selectionReason,
          surfaceStatus: c.surfaceStatus ?? "shadow",
          snapshotDate: date,
          modelVersion,
        }))
      )
      // Keep /picks/score idempotent the same way the cron does: on rerun,
      // overwrite scoring fields so line movements / model changes propagate.
      .onConflictDoUpdate({
        target: [
          candidateBetsTable.snapshotDate,
          candidateBetsTable.gameKey,
          candidateBetsTable.marketType,
          candidateBetsTable.side,
        ],
        set: {
          publishOdds: sql`EXCLUDED.publish_odds`,
          publishLine: sql`EXCLUDED.publish_line`,
          modelProbRaw: sql`EXCLUDED.model_prob_raw`,
          modelProbCalibrated: sql`EXCLUDED.model_prob_calibrated`,
          marketProbFair: sql`EXCLUDED.market_prob_fair`,
          edge: sql`EXCLUDED.edge`,
          ev: sql`EXCLUDED.ev`,
          rankScore: sql`EXCLUDED.rank_score`,
          tier: sql`EXCLUDED.tier`,
          selectionReason: sql`EXCLUDED.selection_reason`,
          surfaceStatus: sql`EXCLUDED.surface_status`,
        },
      });
  }

  const picks = candidates.filter((c) => isOfficialCandidate(c));

  if (picks.length > 0) {
    for (const c of picks) {
      await upsertOfficialCandidateEvaluation(c);
    }
    await db
      .insert(scoredPicksTable)
      .values(
        picks.map((c) => ({
          date,
          gameKey: c.gameKey,
          league: c.league,
          market: c.marketType,
          pick: c.side,
          result: "pending",
          publishOdds: String(c.publishOdds),
          publishLine: c.publishLine != null ? String(c.publishLine) : undefined,
          modelProbRaw: String(c.modelProbRaw),
          modelProbCalibrated: String(c.modelProbCalibrated),
          marketProbFair: String(c.marketProbFair),
          edge: String(c.edge),
          ev: String(c.ev),
          rankScore: String(c.rankScore),
          tier: c.tier,
          eventStart: c.eventStart,
          modelVersion,
          scoringVersion,
        }))
      )
      // Match cron semantics: refresh scoring/odds on rerun; never touch
      // result or closeOdds (those belong to the validation job).
      .onConflictDoUpdate({
        target: [
          scoredPicksTable.date,
          scoredPicksTable.gameKey,
          scoredPicksTable.market,
          scoredPicksTable.pick,
        ],
        set: {
          publishOdds: sql`EXCLUDED.publish_odds`,
          publishLine: sql`EXCLUDED.publish_line`,
          modelProbRaw: sql`EXCLUDED.model_prob_raw`,
          modelProbCalibrated: sql`EXCLUDED.model_prob_calibrated`,
          marketProbFair: sql`EXCLUDED.market_prob_fair`,
          edge: sql`EXCLUDED.edge`,
          ev: sql`EXCLUDED.ev`,
          rankScore: sql`EXCLUDED.rank_score`,
          tier: sql`EXCLUDED.tier`,
          eventStart: sql`EXCLUDED.event_start`,
          updatedAt: new Date(),
        },
      });
  }

  // Reconcile: if a candidate that was previously A/B/C flips to PASS on
  // this run (e.g. new odds guardrail, line movement), the prior row would
  // otherwise remain visible. Delete only pending rows; settled results
  // are immutable truth.
  const staleKeys = computeStaleScoredPicksKeys(candidates);
  if (staleKeys.length > 0) {
    for (const k of staleKeys) {
      await deletePendingOfficialEvaluationResult({
        date,
        gameKey: k.gameKey,
        market: k.market,
        pick: k.pick,
      });
      await db
        .delete(scoredPicksTable)
        .where(
          and(
            eq(scoredPicksTable.date, date),
            eq(scoredPicksTable.gameKey, k.gameKey),
            eq(scoredPicksTable.market, k.market),
            eq(scoredPicksTable.pick, k.pick),
            eq(scoredPicksTable.result, "pending")
          )
        );
    }
  }

  const formattedCandidates = candidates.map((c) => ({
    id: 0,
    gameKey: c.gameKey,
    league: c.league,
    marketType: c.marketType,
    side: c.side,
    eventStart: c.eventStart.toISOString(),
    publishOdds: c.publishOdds,
    publishLine: c.publishLine,
    modelProbRaw: c.modelProbRaw,
    modelProbCalibrated: c.modelProbCalibrated,
    marketProbFair: c.marketProbFair,
    edge: c.edge,
    ev: c.ev,
    rankScore: c.rankScore,
    tier: c.tier,
    calibrationMethod: c.calibrationMethod,
    calibrationVersion: c.calibrationVersion,
    marketQuality: c.marketQuality,
    selectionReason: c.selectionReason,
    surfaceStatus: c.surfaceStatus ?? "shadow",
    snapshotDate: date,
    modelVersion,
    createdAt: new Date().toISOString(),
  }));

  res.json({
    date,
    totalCandidates: candidates.length,
    picksGenerated: picks.length,
    tierBreakdown,
    leagueBreakdown,
    candidates: formattedCandidates,
  });
});

router.post("/picks/validate", async (req, res): Promise<void> => {
  const parsed = ValidatePicksBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { date } = parsed.data;
  const errors: string[] = [];
  let count = 0;

  const picks = await db
    .select()
    .from(scoredPicksTable)
    .where(and(eq(scoredPicksTable.date, date), eq(scoredPicksTable.result, "pending")));

  for (const pick of picks) {
    const snap = await db
      .select()
      .from(gameSnapshotsTable)
      .where(eq(gameSnapshotsTable.gameKey, pick.gameKey))
      .limit(1);

    const game = snap[0];
    if (!game || game.homeScore == null || game.awayScore == null) {
      continue;
    }

    const result = computeOutcomeResult({
      market: pick.market,
      pick: pick.pick,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      // Canonical home-team spread from the game snapshot (not pick.publishLine,
      // which is team-signed and would double-negate for away picks).
      homeSpread: game.publishSpread ? parseFloat(game.publishSpread) : null,
      total: game.publishTotal ? parseFloat(game.publishTotal) : null,
    });

    // CLV-integrity fix (2026-04-26): previously this route only wrote close_odds
    // for moneyline picks and never wrote close_line / clv_implied_delta /
    // clv_line_delta for any market. Spread/total picks settled through this
    // path silently lost CLV signal. Now uses the same centralized writeback
    // helper as the nightly validation and ESPN backstop paths.
    const clv = computeClvWritebackValues(pick, game);

    try {
      await db
        .update(scoredPicksTable)
        .set({
          result,
          closeOdds: clv.closeOdds,
          closeLine: clv.closeLine,
          clvImpliedDelta: clv.clvImpliedDelta,
          clvLineDelta: clv.clvLineDelta,
          updatedAt: new Date(),
        })
        .where(eq(scoredPicksTable.id, pick.id));
      await settleOfficialEvaluationResult({
        date: pick.date,
        gameKey: pick.gameKey,
        market: pick.market,
        pick: pick.pick,
        result,
        closeOdds: clv.closeOdds,
        closeLine: clv.closeLine,
        clvImpliedDelta: clv.clvImpliedDelta,
        clvLineDelta: clv.clvLineDelta,
      });
      count++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`pick ${pick.id}: ${msg}`);
    }
  }

  res.json({
    success: errors.length === 0,
    message: `Validated ${count} pick(s) for ${date}`,
    count,
    errors,
  });
});

export default router;
