import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  gameSnapshotsTable,
  candidateBetsTable,
  scoredPicksTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  ScoreDateBody,
  ValidatePicksBody,
} from "@workspace/api-zod";
import { scorePicks, type GameMarketInput } from "../scoring/scorePicks";
import { computeOutcomeResult } from "../scoring/validatePicks";
import type { League, MarketType } from "../config/scoringModelConfig";
import { capAndSort } from "../lib/pickUtils";

const router: IRouter = Router();

router.get("/picks", async (req, res): Promise<void> => {
  const { date, league, market, tier, result } = req.query as Record<string, string | undefined>;
  const limit = parseInt((req.query.limit as string) ?? "200");
  const offset = parseInt((req.query.offset as string) ?? "0");

  const conditions = [];
  if (date) conditions.push(eq(scoredPicksTable.date, date));
  if (league) conditions.push(eq(scoredPicksTable.league, league));
  if (market) conditions.push(eq(scoredPicksTable.market, market));
  if (tier) conditions.push(eq(scoredPicksTable.tier, tier));
  if (result) conditions.push(eq(scoredPicksTable.result, result));

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
    const { sql: sqlRaw } = await import("drizzle-orm");
    conditions.push(sqlRaw`${candidateBetsTable.gameKey} LIKE ${'%_' + gameDate + '_%'}`);
  }
  if (league) conditions.push(eq(candidateBetsTable.league, league));
  if (market) conditions.push(eq(candidateBetsTable.marketType, market));
  if (tier) conditions.push(eq(candidateBetsTable.tier, tier));

  const raw =
    conditions.length > 0
      ? await db
          .select()
          .from(candidateBetsTable)
          .where(and(...conditions))
          .orderBy(desc(candidateBetsTable.rankScore))
      : await db
          .select()
          .from(candidateBetsTable)
          .orderBy(desc(candidateBetsTable.rankScore))
          .limit(200);

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
    leagues = ["nba", "nhl", "ncaam"],
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
    publishTotal: s.publishTotal ? parseFloat(s.publishTotal) : null,
    publishOverLine: s.publishOverLine ? parseFloat(s.publishOverLine) : null,
    publishUnderLine: s.publishUnderLine ? parseFloat(s.publishUnderLine) : null,
    snapshotDate: date,
  }));

  const candidates = await scorePicks(gameInputs, markets as MarketType[], modelVersion);

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
      .onConflictDoNothing();
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
          modelVersion,
          scoringVersion,
        }))
      )
      .onConflictDoNothing();
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
      spread: pick.publishLine ? parseFloat(pick.publishLine) : null,
      total: pick.publishLine ? parseFloat(pick.publishLine) : null,
    });

    const closeOdds =
      pick.market === "moneyline"
        ? pick.pick === "home"
          ? game.homeCloseMl
          : game.awayCloseMl
        : null;

    try {
      await db
        .update(scoredPicksTable)
        .set({
          result,
          closeOdds: closeOdds ?? undefined,
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
