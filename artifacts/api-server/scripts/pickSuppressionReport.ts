import { and, asc, desc, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { candidateBetsTable, db, scoredPicksTable } from "@workspace/db";
import { buildPreFixExclusionCondition } from "../src/lib/preFixCutoff";
import { buildPlausibleEventStartCondition } from "../src/lib/plausibleEventStart";

const DEFAULT_PRODUCTION_LEAGUES = ["nba", "nhl", "mlb"] as const;

type Args = {
  days: number;
  from?: string;
  to?: string;
};

type CandidateSurfaceStatus =
  | "shadow"
  | "model_watch"
  | "official"
  | "suppressed";

type ReportRow = {
  snapshotDate: string;
  league: string;
  marketType: string;
  side: string;
  publishOdds: string;
  publishLine: string | null;
  modelProbCalibrated: string;
  edge: string;
  ev: string;
  rankScore: string;
  tier: string;
  selectionReason: string | null;
  surfaceStatus: string | null;
  eventStart: Date;
};

type OfficialClvRow = {
  date: string;
  league: string;
  market: string;
  result: string;
  clvImpliedDelta: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { days: 14 };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--days=")) {
      const value = Number(arg.slice("--days=".length));
      if (!Number.isInteger(value) || value <= 0 || value > 60) {
        throw new Error(`--days must be an integer between 1 and 60 (got ${arg})`);
      }
      args.days = value;
      continue;
    }
    if (arg.startsWith("--from=")) {
      const value = arg.slice("--from=".length).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`--from must be YYYY-MM-DD (got ${value})`);
      }
      args.from = value;
      continue;
    }
    if (arg.startsWith("--to=")) {
      const value = arg.slice("--to=".length).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`--to must be YYYY-MM-DD (got ${value})`);
      }
      args.to = value;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }

  if ((args.from && !args.to) || (!args.from && args.to)) {
    throw new Error("Use both --from and --to together.");
  }

  return args;
}

function getSlateDayET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(now);
}

function resolveSurfaceStatus(row: {
  surfaceStatus?: string | null;
  selectionReason?: string | null;
}): CandidateSurfaceStatus {
  if (
    row.surfaceStatus === "shadow" ||
    row.surfaceStatus === "model_watch" ||
    row.surfaceStatus === "official" ||
    row.surfaceStatus === "suppressed"
  ) {
    return row.surfaceStatus;
  }
  if (row.selectionReason === "model_watch_only") return "model_watch";
  if (row.selectionReason === "market_disabled") return "suppressed";
  return "shadow";
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

function describePick(row: Pick<ReportRow, "marketType" | "side" | "publishLine" | "publishOdds">): string {
  const line =
    row.publishLine != null
      ? ` ${Number(row.publishLine) > 0 ? "+" : ""}${row.publishLine}`
      : "";
  return `${row.marketType.toUpperCase()} ${row.side.toUpperCase()}${line} ${formatOdds(row.publishOdds)}`;
}

function getDateRange(args: Args): { from: string; to: string } {
  if (args.from && args.to) return { from: args.from, to: args.to };
  const to = getSlateDayET();
  const end = new Date(`${to}T00:00:00-04:00`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (args.days - 1));
  const from = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(start);
  return { from, to };
}

function printTopRejected(rows: ReportRow[]): void {
  const rejected = rows
    .filter((row) => row.tier === "PASS")
    .sort((a, b) => Number(b.rankScore) - Number(a.rankScore))
    .slice(0, 3);

  if (rejected.length === 0) {
    console.log("  top rejected: none");
    return;
  }

  console.log("  top rejected:");
  for (const row of rejected) {
    console.log(
      `    - ${describePick(row)} | rank ${Number(row.rankScore).toFixed(3)} | edge ${formatSignedPercent(row.edge)} | EV ${formatSignedPercent(row.ev)} | reason ${row.selectionReason ?? "unknown"} | surface ${resolveSurfaceStatus(row)}`,
    );
  }
}

function summarizeClv(rows: OfficialClvRow[]): string {
  if (rows.length === 0) return "no settled official picks";
  const settled = rows.filter((row) => row.result === "win" || row.result === "loss" || row.result === "push");
  if (settled.length === 0) return "no settled official picks";

  const wins = settled.filter((row) => row.result === "win").length;
  const losses = settled.filter((row) => row.result === "loss").length;
  const pushes = settled.filter((row) => row.result === "push").length;
  const clvRows = settled.filter((row) => row.clvImpliedDelta != null).map((row) => Number(row.clvImpliedDelta));
  if (clvRows.length === 0) {
    return `${wins}W-${losses}L-${pushes}P | no CLV sample`;
  }
  const avgClv = clvRows.reduce((sum, value) => sum + value, 0) / clvRows.length;
  const positiveRate =
    clvRows.filter((value) => value > 0).length / clvRows.length;
  return `${wins}W-${losses}L-${pushes}P | avg CLV ${formatSignedPercent(avgClv)} | CLV+ ${formatSignedPercent(positiveRate).replace("+", "")} | n=${clvRows.length}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const range = getDateRange(args);

  const conditions = [
    gte(candidateBetsTable.snapshotDate, range.from),
    sql`${candidateBetsTable.snapshotDate} <= ${range.to}`,
    inArray(candidateBetsTable.league, [...DEFAULT_PRODUCTION_LEAGUES]),
    isNull(candidateBetsTable.dataQuality),
    buildPlausibleEventStartCondition(candidateBetsTable.league, candidateBetsTable.eventStart) ?? sql`true`,
  ];

  const candidatesExclusion = buildPreFixExclusionCondition(
    candidateBetsTable.league,
    candidateBetsTable.snapshotDate,
  );
  if (candidatesExclusion) conditions.push(candidatesExclusion);

  let rows: ReportRow[] = [];
  try {
    rows = await db
      .select({
        snapshotDate: candidateBetsTable.snapshotDate,
        league: candidateBetsTable.league,
        marketType: candidateBetsTable.marketType,
        side: candidateBetsTable.side,
        publishOdds: candidateBetsTable.publishOdds,
        publishLine: candidateBetsTable.publishLine,
        modelProbCalibrated: candidateBetsTable.modelProbCalibrated,
        edge: candidateBetsTable.edge,
        ev: candidateBetsTable.ev,
        rankScore: candidateBetsTable.rankScore,
        tier: candidateBetsTable.tier,
        selectionReason: candidateBetsTable.selectionReason,
        surfaceStatus: candidateBetsTable.surfaceStatus,
        eventStart: candidateBetsTable.eventStart,
      })
      .from(candidateBetsTable)
      .where(and(...conditions))
      .orderBy(asc(candidateBetsTable.snapshotDate), asc(candidateBetsTable.league), asc(candidateBetsTable.marketType), desc(candidateBetsTable.rankScore));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("surface_status")) throw error;

    console.warn("candidate_bets.surface_status is not present in this database yet; falling back to selection_reason-based surface grouping.");
    rows = await db
      .select({
        snapshotDate: candidateBetsTable.snapshotDate,
        league: candidateBetsTable.league,
        marketType: candidateBetsTable.marketType,
        side: candidateBetsTable.side,
        publishOdds: candidateBetsTable.publishOdds,
        publishLine: candidateBetsTable.publishLine,
        modelProbCalibrated: candidateBetsTable.modelProbCalibrated,
        edge: candidateBetsTable.edge,
        ev: candidateBetsTable.ev,
        rankScore: candidateBetsTable.rankScore,
        tier: candidateBetsTable.tier,
        selectionReason: candidateBetsTable.selectionReason,
        eventStart: candidateBetsTable.eventStart,
      })
      .from(candidateBetsTable)
      .where(and(...conditions))
      .orderBy(asc(candidateBetsTable.snapshotDate), asc(candidateBetsTable.league), asc(candidateBetsTable.marketType), desc(candidateBetsTable.rankScore))
      .then((fallbackRows) =>
        fallbackRows.map((row) => ({
          ...row,
          surfaceStatus: null,
        })),
      );
  }

  const officialConditions = [
    gte(scoredPicksTable.date, range.from),
    lte(scoredPicksTable.date, range.to),
    inArray(scoredPicksTable.league, [...DEFAULT_PRODUCTION_LEAGUES]),
    isNull(scoredPicksTable.dataQuality),
  ];
  const officialExclusion = buildPreFixExclusionCondition(
    scoredPicksTable.league,
    scoredPicksTable.date,
  );
  if (officialExclusion) officialConditions.push(officialExclusion);
  const plausibleOfficialCondition = buildPlausibleEventStartCondition(
    scoredPicksTable.league,
    scoredPicksTable.eventStart,
  );
  if (plausibleOfficialCondition) officialConditions.push(plausibleOfficialCondition);

  const officialRows = await db
    .select({
      date: scoredPicksTable.date,
      league: scoredPicksTable.league,
      market: scoredPicksTable.market,
      result: scoredPicksTable.result,
      clvImpliedDelta: scoredPicksTable.clvImpliedDelta,
    })
    .from(scoredPicksTable)
    .where(and(...officialConditions))
    .orderBy(asc(scoredPicksTable.date), asc(scoredPicksTable.league), asc(scoredPicksTable.market));

  console.log(`\nSportsMVP pick suppression report (${range.from} to ${range.to})\n`);

  if (rows.length === 0) {
    console.log("No candidate rows found in this range.\n");
    return;
  }

  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = `${row.snapshotDate}|${row.league}|${row.marketType}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  const officialGroups = new Map<string, OfficialClvRow[]>();
  for (const row of officialRows) {
    const key = `${row.date}|${row.league}|${row.market}`;
    const bucket = officialGroups.get(key) ?? [];
    bucket.push(row);
    officialGroups.set(key, bucket);
  }

  for (const [key, bucket] of groups) {
    const [date, league, market] = key.split("|");
    const byTier = bucket.reduce<Record<string, number>>((acc, row) => {
      acc[row.tier] = (acc[row.tier] ?? 0) + 1;
      return acc;
    }, {});
    const bySelectionReason = bucket.reduce<Record<string, number>>((acc, row) => {
      const reason = row.selectionReason ?? "null";
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});
    const bySurfaceStatus = bucket.reduce<Record<string, number>>((acc, row) => {
      const status = resolveSurfaceStatus(row);
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {});
    const officialish = bucket.filter((row) => row.tier !== "PASS" && resolveSurfaceStatus(row) !== "suppressed").length;

    console.log(`${date} · ${league.toUpperCase()} ${market}`);
    console.log(`  candidates generated: ${bucket.length}`);
    console.log(`  non-PASS rows: ${officialish}`);
    console.log(`  by tier: ${Object.entries(byTier).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`  by selectionReason: ${Object.entries(bySelectionReason).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`  by surfaceStatus: ${Object.entries(bySurfaceStatus).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`  official CLV/result: ${summarizeClv(officialGroups.get(key) ?? [])}`);
    printTopRejected(bucket);
    console.log("");
  }
}

void main();
