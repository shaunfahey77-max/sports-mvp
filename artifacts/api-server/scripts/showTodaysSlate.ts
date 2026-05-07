import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
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

function getPgErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "cause" in error
  ) {
    const cause = (error as { cause?: unknown }).cause;
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      typeof (cause as { code?: unknown }).code === "string"
    ) {
      return (cause as { code: string }).code;
    }
  }
  return null;
}

function getSlateDayET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(now);
}

function parseArgs(argv: string[]): { date?: string; from?: string; to?: string } {
  const parsed: { date?: string; from?: string; to?: string } = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--date=")) {
      const value = arg.slice("--date=".length).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`--date must be YYYY-MM-DD (got ${value})`);
      }
      parsed.date = value;
      continue;
    }
    if (arg.startsWith("--from=")) {
      const value = arg.slice("--from=".length).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`--from must be YYYY-MM-DD (got ${value})`);
      }
      parsed.from = value;
      continue;
    }
    if (arg.startsWith("--to=")) {
      const value = arg.slice("--to=".length).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`--to must be YYYY-MM-DD (got ${value})`);
      }
      parsed.to = value;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  if (parsed.date && (parsed.from || parsed.to)) {
    throw new Error("Use either --date or --from/--to, not both.");
  }
  if ((parsed.from && !parsed.to) || (!parsed.from && parsed.to)) {
    throw new Error("Both --from and --to are required for a range query.");
  }
  return parsed;
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

function formatDayHeader(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(dt);
}

function formatResult(result: string): string {
  switch (result) {
    case "win":
      return "WIN";
    case "loss":
      return "LOSS";
    case "push":
      return "PUSH";
    default:
      return result.toUpperCase();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Export it first, then rerun the today:slate command.",
    );
    process.exitCode = 1;
    return;
  }

  const today = args.date ?? getSlateDayET();

  if (args.from && args.to) {
    const rangeConditions = [
      gte(scoredPicksTable.date, args.from),
      lte(scoredPicksTable.date, args.to),
      inArray(scoredPicksTable.league, [...DEFAULT_PRODUCTION_LEAGUES]),
      isNull(scoredPicksTable.dataQuality),
    ];
    const rangeExclusion = buildPreFixExclusionCondition(
      scoredPicksTable.league,
      scoredPicksTable.date,
    );
    if (rangeExclusion) rangeConditions.push(rangeExclusion);
    const plausibleRangeCondition = buildPlausibleEventStartCondition(
      scoredPicksTable.league,
      scoredPicksTable.eventStart,
    );
    if (plausibleRangeCondition) rangeConditions.push(plausibleRangeCondition);

    const rangeRows = await db
      .select()
      .from(scoredPicksTable)
      .where(and(...rangeConditions))
      .orderBy(desc(scoredPicksTable.date), desc(scoredPicksTable.rankScore));

    console.log(`\nSportsMVP official picks from ${args.from} to ${args.to} (ET)\n`);

    if (rangeRows.length === 0) {
      console.log("No official picks found in this date range.\n");
      return;
    }

    const grouped = new Map<string, typeof rangeRows>();
    for (const row of rangeRows) {
      const bucket = grouped.get(row.date) ?? [];
      bucket.push(row);
      grouped.set(row.date, bucket);
    }

    for (const [date, rows] of grouped) {
      console.log(`${formatDayHeader(date)} · ${date}`);
      for (const row of rows) {
        printBullet([
          `[${row.tier}] ${row.league.toUpperCase()} ${describeMarketPick({
            market: row.market,
            side: row.pick,
            publishLine: row.publishLine,
            publishOdds: row.publishOdds,
          })}`,
          `result ${formatResult(row.result)} | edge ${formatSignedPercent(row.edge)} | EV ${formatSignedPercent(row.ev)} | model ${formatPercent(row.modelProbCalibrated)}`,
          `starts ${formatEventStart(row.eventStart)}`,
        ]);
      }
      console.log("");
    }

    const summary = rangeRows.reduce(
      (acc, row) => {
        if (row.result === "win") acc.wins += 1;
        else if (row.result === "loss") acc.losses += 1;
        else if (row.result === "push") acc.pushes += 1;
        else acc.pending += 1;
        return acc;
      },
      { wins: 0, losses: 0, pushes: 0, pending: 0 },
    );

    console.log(
      `Summary: ${rangeRows.length} official picks | ${summary.wins}W-${summary.losses}L-${summary.pushes}P | ${summary.pending} pending`,
    );
    return;
  }

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

  const scoredPickRows = await db
    .select()
    .from(scoredPicksTable)
    .where(and(...officialConditions))
    .orderBy(desc(scoredPicksTable.rankScore));

  let evaluationRows: Array<{
    date: string;
    gameKey: string;
    league: string;
    market: string;
    pick: string;
    result: string;
    publishOdds: string;
    publishLine: string | null;
    closeOdds: string | null;
    closeLine: string | null;
    modelProbRaw: string;
    modelProbCalibrated: string;
    marketProbFair: string;
    edge: string;
    ev: string;
    rankScore: string;
    tier: string;
    clvLineDelta: string | null;
    clvImpliedDelta: string | null;
    modelVersion: string;
    scoringVersion: string;
  }> = [];

  try {
    evaluationRows = await db
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
      .orderBy(desc(evaluationResultsTable.rankScore));
  } catch (error) {
    const code = getPgErrorCode(error);
    if (code === "42P01") {
      console.warn(
        "evaluation_results is not present in this database yet; falling back to legacy scored_picks-only official slate.",
      );
    } else {
      throw error;
    }
  }

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

  let rawCandidates: Array<{
    id: number;
    gameKey: string;
    league: string;
    marketType: string;
    side: string;
    eventStart: Date;
    publishOdds: string;
    publishLine: string | null;
    modelProbCalibrated: string;
    edge: string;
    ev: string;
    rankScore: string;
    tier: string;
    selectionReason: string | null;
    surfaceStatus: string | null;
    snapshotDate: string;
  }> = [];

  try {
    rawCandidates = await db
      .select({
        id: candidateBetsTable.id,
        gameKey: candidateBetsTable.gameKey,
        league: candidateBetsTable.league,
        marketType: candidateBetsTable.marketType,
        side: candidateBetsTable.side,
        eventStart: candidateBetsTable.eventStart,
        publishOdds: candidateBetsTable.publishOdds,
        publishLine: candidateBetsTable.publishLine,
        modelProbCalibrated: candidateBetsTable.modelProbCalibrated,
        edge: candidateBetsTable.edge,
        ev: candidateBetsTable.ev,
        rankScore: candidateBetsTable.rankScore,
        tier: candidateBetsTable.tier,
        selectionReason: candidateBetsTable.selectionReason,
        surfaceStatus: candidateBetsTable.surfaceStatus,
        snapshotDate: candidateBetsTable.snapshotDate,
      })
      .from(candidateBetsTable)
      .where(and(...candidateConditions))
      .orderBy(desc(candidateBetsTable.rankScore));
  } catch (error) {
    const code = getPgErrorCode(error);
    if (code === "42703") {
      console.warn(
        "candidate_bets.surface_status is not present in this database yet; falling back to selection_reason-based candidate visibility.",
      );
      rawCandidates = await db
        .select({
          id: candidateBetsTable.id,
          gameKey: candidateBetsTable.gameKey,
          league: candidateBetsTable.league,
          marketType: candidateBetsTable.marketType,
          side: candidateBetsTable.side,
          eventStart: candidateBetsTable.eventStart,
          publishOdds: candidateBetsTable.publishOdds,
          publishLine: candidateBetsTable.publishLine,
          modelProbCalibrated: candidateBetsTable.modelProbCalibrated,
          edge: candidateBetsTable.edge,
          ev: candidateBetsTable.ev,
          rankScore: candidateBetsTable.rankScore,
          tier: candidateBetsTable.tier,
          selectionReason: candidateBetsTable.selectionReason,
          snapshotDate: candidateBetsTable.snapshotDate,
        })
        .from(candidateBetsTable)
        .where(and(...candidateConditions))
        .orderBy(desc(candidateBetsTable.rankScore))
        .then((rows) => rows.map((row) => ({ ...row, surfaceStatus: null })));
    } else {
      throw error;
    }
  }

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
