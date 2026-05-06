import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  candidateBetsTable,
  db,
  evaluationResultsTable,
  scoredPicksTable,
} from "@workspace/db";
import { buildPreFixExclusionCondition } from "../src/lib/preFixCutoff";
import { buildPlausibleEventStartCondition } from "../src/lib/plausibleEventStart";
import { mergeOfficialPickRows } from "../src/scoring/officialPicksMerge";

const DEFAULT_PRODUCTION_LEAGUES = ["nba", "nhl"] as const;
const MODEL_WATCH_ONLY_CANDIDATE_PAIRS: ReadonlyArray<{
  league: string;
  market: string;
}> = [{ league: "mlb", market: "moneyline" }];

type CandidateSurfaceStatus =
  | "shadow"
  | "model_watch"
  | "official"
  | "suppressed";

function getSlateDayET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(now);
}

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

  if (candidate.tier === "PASS") {
    return (
      surfaceStatus === "model_watch" &&
      candidate.selectionReason === "model_watch_only"
    );
  }

  return (
    surfaceStatus === "shadow" ||
    surfaceStatus === "official" ||
    surfaceStatus === "model_watch"
  );
}

function formatPercent(value: string | number | null | undefined): string {
  const num = Number(value ?? 0);
  return `${(num * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: string | number | null | undefined): string {
  const num = Number(value ?? 0);
  return `${num >= 0 ? "+" : ""}${(num * 100).toFixed(1)}%`;
}

function formatOdds(value: string | number | null | undefined): string {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return String(value ?? "");
  return num > 0 ? `+${num}` : `${num}`;
}

function formatEventStart(value: Date | string | null | undefined): string {
  if (!value) return "n/a";
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(dt);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Export it first, then rerun: pnpm --filter @workspace/api-server exec tsx scripts/showTodaysSlate.ts",
    );
    process.exitCode = 1;
    return;
  }

  const today = getSlateDayET();

  const officialConditions = [
    eq(scoredPicksTable.date, today),
    eq(scoredPicksTable.result, "pending"),
    inArray(scoredPicksTable.league, [...DEFAULT_PRODUCTION_LEAGUES]),
    isNull(scoredPicksTable.dataQuality),
  ];
  const scoredPicksExclusion = buildPreFixExclusionCondition(
    scoredPicksTable.league,
    scoredPicksTable.date,
  );
  if (scoredPicksExclusion) officialConditions.push(scoredPicksExclusion);
  const plausibleScoredPicksCondition = buildPlausibleEventStartCondition(
    scoredPicksTable.league,
    scoredPicksTable.eventStart,
  );
  if (plausibleScoredPicksCondition) officialConditions.push(plausibleScoredPicksCondition);

  const evaluationConditions = [
    eq(evaluationResultsTable.date, today),
    eq(evaluationResultsTable.result, "pending"),
    eq(evaluationResultsTable.surfaceStatus, "official"),
    inArray(evaluationResultsTable.league, [...DEFAULT_PRODUCTION_LEAGUES]),
  ];
  const evaluationExclusion = buildPreFixExclusionCondition(
    evaluationResultsTable.league,
    evaluationResultsTable.date,
  );
  if (evaluationExclusion) evaluationConditions.push(evaluationExclusion);

  const [scoredPickRows, evaluationRows] = await Promise.all([
    db.select().from(scoredPicksTable).where(and(...officialConditions)).orderBy(desc(scoredPicksTable.rankScore)),
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
  const candidateRowsForOfficial = evaluationRowKeys.length > 0
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
    candidateRowsForOfficial.map((row) => `${row.date}|${row.gameKey}|${row.market}|${row.pick}`),
  );
  const filteredEvaluationRows = evaluationRows.filter((row) => {
    const key = `${row.date}|${row.gameKey}|${row.market}|${row.pick}`;
    return scoredPickKeys.has(key) || candidateKeys.has(key);
  });

  const officialPicks = mergeOfficialPickRows({
    evaluationRows: filteredEvaluationRows,
    scoredPickRows,
    candidateRows: candidateRowsForOfficial,
  }).sort((a, b) => Number(b.rankScore) - Number(a.rankScore));

  const candidateConditions = [
    sql`${candidateBetsTable.gameKey} LIKE ${"%_" + today + "_%"}`,
    eq(candidateBetsTable.snapshotDate, today),
    isNull(candidateBetsTable.dataQuality),
    buildPlausibleEventStartCondition(candidateBetsTable.league, candidateBetsTable.eventStart) ?? sql`true`,
  ];

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
  candidateConditions.push(
    watchPairCondition
      ? or(productionLeagueCondition, watchPairCondition)!
      : productionLeagueCondition,
  );
  const candidatesExclusion = buildPreFixExclusionCondition(
    candidateBetsTable.league,
    candidateBetsTable.snapshotDate,
  );
  if (candidatesExclusion) candidateConditions.push(candidatesExclusion);

  const rawCandidates = await db
    .select()
    .from(candidateBetsTable)
    .where(and(...candidateConditions))
    .orderBy(desc(candidateBetsTable.rankScore));

  const renderableCandidates = rawCandidates.filter(isRenderableCandidateRow);
  const liveCandidates = renderableCandidates.filter((row) => row.tier !== "PASS");
  const fallbackCandidates = renderableCandidates.filter((row) => row.tier === "PASS");

  console.log(`\nSportsMVP slate for ${today} (ET)\n`);

  if (officialPicks.length === 0) {
    console.log("OFFICIAL PICKS: none\n");
  } else {
    console.log("OFFICIAL PICKS");
    for (const pick of officialPicks) {
      console.log(
        `- [${pick.tier}] ${pick.league.toUpperCase()} ${pick.market} ${pick.pick.toUpperCase()} ${pick.publishLine != null ? `${Number(pick.publishLine) > 0 ? "+" : ""}${pick.publishLine} ` : ""}${formatOdds(pick.publishOdds)} | edge ${formatSignedPercent(pick.edge)} | EV ${formatSignedPercent(pick.ev)} | model ${formatPercent(pick.modelProbCalibrated)} | ${formatEventStart(pick.eventStart)}`,
      );
    }
    console.log("");
  }

  if (liveCandidates.length === 0) {
    console.log("LIVE CANDIDATES: none\n");
  } else {
    console.log("LIVE CANDIDATES");
    for (const bet of liveCandidates) {
      console.log(
        `- [${bet.tier}] ${bet.league.toUpperCase()} ${bet.marketType} ${bet.side.toUpperCase()} ${bet.publishLine != null ? `${Number(bet.publishLine) > 0 ? "+" : ""}${bet.publishLine} ` : ""}${formatOdds(bet.publishOdds)} | ${resolvePersistedCandidateSurfaceStatus(bet)} | edge ${formatSignedPercent(bet.edge)} | EV ${formatSignedPercent(bet.ev)} | model ${formatPercent(bet.modelProbCalibrated)} | ${formatEventStart(bet.eventStart)}`,
      );
    }
    console.log("");
  }

  if (fallbackCandidates.length > 0) {
    console.log("MODEL WATCH FALLBACK");
    for (const bet of fallbackCandidates.slice(0, 5)) {
      console.log(
        `- [${bet.tier}] ${bet.league.toUpperCase()} ${bet.marketType} ${bet.side.toUpperCase()} ${bet.publishLine != null ? `${Number(bet.publishLine) > 0 ? "+" : ""}${bet.publishLine} ` : ""}${formatOdds(bet.publishOdds)} | ${resolvePersistedCandidateSurfaceStatus(bet)} | edge ${formatSignedPercent(bet.edge)} | EV ${formatSignedPercent(bet.ev)} | ${formatEventStart(bet.eventStart)}`,
      );
    }
    console.log("");
  }

  console.log(
    `Summary: ${officialPicks.length} official, ${liveCandidates.length} live candidates, ${fallbackCandidates.length} fallback/watch rows`,
  );
}

void main();
