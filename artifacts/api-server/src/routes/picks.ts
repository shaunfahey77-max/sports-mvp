import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  gameSnapshotsTable,
  candidateBetsTable,
  scoredPicksTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, inArray, sql, isNull, or } from "drizzle-orm";
import {
  ScoreDateBody,
  ValidatePicksBody,
} from "@workspace/api-zod";
import { scorePicks, type GameMarketInput } from "../scoring/scorePicks";
import { computeOutcomeResult } from "../scoring/validatePicks";
import { computeClvWritebackValues } from "../scoring/clvWriteback";
import type { League, MarketType } from "../config/scoringModelConfig";
import { ODDS_RANGE_GUARDRAIL_LEAGUES } from "../config/scoringModelConfig";
import { capAndSort, computeStaleScoredPicksKeys } from "../lib/pickUtils";
import { buildPreFixExclusionCondition } from "../lib/preFixCutoff";

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

const router: IRouter = Router();

router.get("/picks", async (req, res): Promise<void> => {
  const { date, league, market, tier, result } = req.query as Record<string, string | undefined>;
  const limit = parseInt((req.query.limit as string) ?? "200");
  const offset = parseInt((req.query.offset as string) ?? "0");

  const conditions = [];
  if (date) conditions.push(eq(scoredPicksTable.date, date));
  if (league) {
    conditions.push(eq(scoredPicksTable.league, league));
  } else {
    // No explicit league filter → serve production leagues only (exclude experimental NCAAM).
    conditions.push(inArray(scoredPicksTable.league, [...DEFAULT_PRODUCTION_LEAGUES]));
  }
  if (market) conditions.push(eq(scoredPicksTable.market, market));
  if (tier) conditions.push(eq(scoredPicksTable.tier, tier));
  if (result) conditions.push(eq(scoredPicksTable.result, result));

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

  // Fetch ordered by rankScore DESC so the cap selects the best picks per league/game
  const raw =
    conditions.length > 0
      ? await db
          .select()
          .from(scoredPicksTable)
          .where(and(...conditions))
          .orderBy(desc(scoredPicksTable.rankScore))
          .limit(limit)
          .offset(offset)
      : await db
          .select()
          .from(scoredPicksTable)
          .orderBy(desc(scoredPicksTable.rankScore))
          .limit(limit)
          .offset(offset);

  // When filtering by a single date, apply per-league cap and re-sort chronologically.
  // Historical queries (no date, or multi-day) are returned as-is sorted by rankScore.
  const picks = date && !league
    ? capAndSort(raw.map(p => ({ ...p, eventStart: p.eventStart ?? p.date })))
    : raw;

  res.json({ picks, total: picks.length, offset, limit });
});

router.get("/picks/candidates", async (req, res): Promise<void> => {
  const { date, gameDate, league, market, tier } = req.query as Record<string, string | undefined>;

  const conditions = [];
  // `date` filters by snapshotDate (legacy); `gameDate` filters by the date embedded in gameKey
  if (date) conditions.push(eq(candidateBetsTable.snapshotDate, date));
  if (gameDate) {
    conditions.push(sql`${candidateBetsTable.gameKey} LIKE ${'%_' + gameDate + '_%'}`);
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

  // Deduplicate: keep only the highest-EV candidate per (gameKey, marketType, side)
  const seen = new Map<string, typeof raw[0]>();
  for (const c of raw) {
    const key = `${c.gameKey}|${c.marketType}|${c.side}`;
    const existing = seen.get(key);
    if (!existing || parseFloat(c.ev) > parseFloat(existing.ev)) {
      seen.set(key, c);
    }
  }
  // Apply per-league cap then sort chronologically (best pick first within same game time)
  const candidates = capAndSort(
    Array.from(seen.values()).sort(
      (a, b) => parseFloat(b.rankScore) - parseFloat(a.rankScore)
    ).map(c => ({ ...c, eventStart: c.eventStart ?? new Date() }))
  );

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
        },
      });
  }

  const picks = candidates.filter((c) => c.tier !== "PASS");

  if (picks.length > 0) {
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
