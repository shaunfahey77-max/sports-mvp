import { and, asc, gte, inArray, lte, sql } from "drizzle-orm";
import { db, gameSnapshotsTable } from "@workspace/db";
import type { GameMarketInput, CandidateOutput } from "../src/scoring/scorePicks";
import { scorePicks, isOfficialCandidate } from "../src/scoring/scorePicks";
import { ODDS_RANGE_GUARDRAIL_LEAGUES } from "../src/config/scoringModelConfig";
import { computeClvWritebackValues } from "../src/scoring/clvWriteback";
import { computeOutcomeResult, computeValidationMetrics, type PickWithFullData } from "../src/scoring/validatePicks";
import { buildPreFixExclusionCondition } from "../src/lib/preFixCutoff";
import { buildPlausibleEventStartCondition } from "../src/lib/plausibleEventStart";

const DEFAULT_PRODUCTION_LEAGUES = ["nba", "nhl", "mlb"] as const;
const MARKETS = ["moneyline", "spread", "total"] as const;
const MODEL_VERSION = "v1";
const REPLAY_SURFACE_STATUS: Record<string, "shadow"> = {
  nba_moneyline: "shadow",
  nba_spread: "shadow",
  nba_total: "shadow",
  nhl_moneyline: "shadow",
  nhl_spread: "shadow",
  nhl_total: "shadow",
  mlb_moneyline: "shadow",
};

type Args = {
  from: string;
  to: string;
  profile: OfficialProfile;
};

type OfficialProfile =
  | "baseline"
  | "r5_disciplined_officials"
  | "r6_spread_discipline"
  | "r7_tier_a_discipline"
  | "r8_no_a";

type SnapshotRow = {
  gameKey: string;
  league: string;
  eventStart: Date;
  homeTeam: string;
  awayTeam: string;
  homePublishMl: string;
  awayPublishMl: string;
  homeCloseMl: string | null;
  awayCloseMl: string | null;
  publishSpread: string | null;
  publishSpreadLine: string | null;
  publishAwaySpreadLine: string | null;
  closeSpread: string | null;
  closeSpreadLine: string | null;
  closeAwaySpreadLine: string | null;
  publishTotal: string | null;
  publishOverLine: string | null;
  publishUnderLine: string | null;
  closeTotal: string | null;
  closeOverLine: string | null;
  closeUnderLine: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  snapshotDate: string;
};

type ReplayPick = PickWithFullData & {
  date: string;
  gameKey: string;
  eventStart: Date;
};

type OutcomeBucket = {
  picks: number;
  decided: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  units: number;
  clvRows: number[];
};

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {
    profile: "baseline",
  };
  for (const arg of argv.slice(2)) {
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
    if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length).trim();
      if (
        value !== "baseline" &&
        value !== "r5_disciplined_officials" &&
        value !== "r6_spread_discipline" &&
        value !== "r7_tier_a_discipline" &&
        value !== "r8_no_a"
      ) {
        throw new Error(
          `--profile must be one of baseline, r5_disciplined_officials, r6_spread_discipline, r7_tier_a_discipline, r8_no_a (got ${value})`,
        );
      }
      args.profile = value;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  if (!args.from || !args.to) {
    throw new Error("Use both --from and --to.");
  }
  return args as Args;
}

function asNum(value: string | null | undefined): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toGameInput(row: SnapshotRow): GameMarketInput {
  return {
    gameKey: row.gameKey,
    league: row.league as GameMarketInput["league"],
    eventStart: row.eventStart,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    homePublishMl: Number(row.homePublishMl),
    awayPublishMl: Number(row.awayPublishMl),
    publishSpread: asNum(row.publishSpread),
    publishSpreadLine: asNum(row.publishSpreadLine),
    publishAwaySpreadLine: asNum(row.publishAwaySpreadLine),
    publishTotal: asNum(row.publishTotal),
    publishOverLine: asNum(row.publishOverLine),
    publishUnderLine: asNum(row.publishUnderLine),
    snapshotDate: row.snapshotDate,
  };
}

function formatOdds(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function formatEventStart(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function describePick(candidate: CandidateOutput): string {
  const line =
    candidate.publishLine != null
      ? ` ${candidate.publishLine > 0 ? "+" : ""}${candidate.publishLine}`
      : "";
  return `${candidate.marketType.toUpperCase()} ${candidate.side.toUpperCase()}${line} ${formatOdds(candidate.publishOdds)}`;
}

function summarizeDayPicks(picks: ReplayPick[]) {
  const wins = picks.filter((p) => p.result === "win").length;
  const losses = picks.filter((p) => p.result === "loss").length;
  const pushes = picks.filter((p) => p.result === "push").length;
  const clvRows = picks.filter((p) => p.clvImpliedDelta != null).map((p) => p.clvImpliedDelta as number);
  const avgClv =
    clvRows.length > 0 ? clvRows.reduce((sum, value) => sum + value, 0) / clvRows.length : null;
  return { wins, losses, pushes, avgClv, clvN: clvRows.length };
}

function applyOfficialProfile(candidates: CandidateOutput[], profile: OfficialProfile): CandidateOutput[] {
  if (profile === "baseline") {
    return candidates;
  }

  return candidates.filter((candidate) => {
    if (candidate.publishOdds > 150) return false;

    if (candidate.marketType === "spread" && candidate.publishOdds > 120) return false;

    if (
      candidate.league === "nba" &&
      candidate.marketType === "spread" &&
      candidate.publishLine != null &&
      Math.abs(candidate.publishLine) > 12.5
    ) {
      return false;
    }

    if (profile === "r6_spread_discipline") {
      // R6: keep all markets modeled, but make the surfaced spread lane more
      // conservative after the R5 replay showed spreads still dragging ROI.
      if (candidate.marketType === "spread" && candidate.publishOdds > 100) return false;
    }

    if (profile === "r7_tier_a_discipline" || profile === "r8_no_a") {
      // R7 builds on R6's spread discipline, then leaves the official lane
      // intact while we test a more selective Tier A label. The actual
      // relabeling happens in a second pass so we don't remove picks.
      if (candidate.marketType === "spread" && candidate.publishOdds > 100) return false;
    }

    return true;
  });
}

function applyTierProfile(candidates: CandidateOutput[], profile: OfficialProfile): CandidateOutput[] {
  if (profile === "r8_no_a") {
    return candidates.map((candidate) =>
      candidate.tier === "A"
        ? {
            ...candidate,
            tier: "B" as const,
          }
        : candidate,
    );
  }

  if (profile !== "r7_tier_a_discipline") {
    return candidates;
  }

  return candidates.map((candidate) => {
    if (candidate.tier !== "A") return candidate;

    const keepAsA =
      candidate.rankScore >= 0.8 &&
      candidate.publishOdds <= 110 &&
      !(candidate.marketType === "spread" && candidate.publishOdds >= 100);

    if (keepAsA) return candidate;
    return {
      ...candidate,
      tier: "B" as const,
    };
  });
}

function buildEmptyBucket(): OutcomeBucket {
  return {
    picks: 0,
    decided: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    pending: 0,
    units: 0,
    clvRows: [],
  };
}

function getBucketLabelForOdds(odds: number): string {
  if (odds <= -200) return "fav_heavy<=-200";
  if (odds < 0) return "fav_standard(-199..-101)";
  if (odds <= 150) return "dog_small(+100..+150)";
  return "dog_plus(+151+)";
}

function getBucketLabelForEdge(edge: number): string {
  if (edge < 0.05) return "edge_lt_5";
  if (edge < 0.10) return "edge_5_to_10";
  if (edge < 0.15) return "edge_10_to_15";
  return "edge_15_plus";
}

function getBucketLabelForEv(ev: number): string {
  if (ev < 0.08) return "ev_lt_8";
  if (ev < 0.10) return "ev_8_to_10";
  if (ev < 0.12) return "ev_10_to_12";
  return "ev_12_plus";
}

function settleUnits(pick: ReplayPick): number {
  if (pick.result === "win") {
    return pick.publishOdds > 0 ? pick.publishOdds / 100 : 100 / Math.abs(pick.publishOdds);
  }
  if (pick.result === "loss") return -1;
  return 0;
}

function summarizeBuckets(picks: ReplayPick[], labeler: (pick: ReplayPick) => string): Map<string, OutcomeBucket> {
  const buckets = new Map<string, OutcomeBucket>();
  for (const pick of picks) {
    const label = labeler(pick);
    const bucket = buckets.get(label) ?? buildEmptyBucket();
    bucket.picks += 1;
    if (pick.result === "pending") {
      bucket.pending += 1;
    } else {
      bucket.decided += 1;
      if (pick.result === "win") bucket.wins += 1;
      if (pick.result === "loss") bucket.losses += 1;
      if (pick.result === "push") bucket.pushes += 1;
      bucket.units += settleUnits(pick);
    }
    if (pick.clvImpliedDelta != null) bucket.clvRows.push(pick.clvImpliedDelta);
    buckets.set(label, bucket);
  }
  return buckets;
}

function printBucketTable(title: string, buckets: Map<string, OutcomeBucket>) {
  console.log(title);
  const rows = [...buckets.entries()]
    .map(([label, bucket]) => {
      const avgClv =
        bucket.clvRows.length > 0
          ? bucket.clvRows.reduce((sum, value) => sum + value, 0) / bucket.clvRows.length
          : null;
      const roi = bucket.decided > 0 ? bucket.units / bucket.decided : null;
      const winRate = bucket.decided > 0 ? bucket.wins / bucket.decided : null;
      return {
        label,
        bucket,
        avgClv,
        roi,
        winRate,
      };
    })
    .sort((a, b) => b.bucket.picks - a.bucket.picks || a.label.localeCompare(b.label));

  if (rows.length === 0) {
    console.log("  none");
    console.log("");
    return;
  }

  for (const row of rows) {
    console.log(
      `  ${row.label}: picks=${row.bucket.picks}, decided=${row.bucket.decided}, record=${row.bucket.wins}-${row.bucket.losses}-${row.bucket.pushes}, pending=${row.bucket.pending}, roi=${row.roi != null ? formatSignedPercent(row.roi) : "n/a"}, units=${row.bucket.units.toFixed(2)}, clv=${row.avgClv != null ? formatSignedPercent(row.avgClv) : "n/a"}, winRate=${row.winRate != null ? formatPercent(row.winRate) : "n/a"}`,
    );
  }
  console.log("");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const conditions = [
    gte(gameSnapshotsTable.snapshotDate, args.from),
    lte(gameSnapshotsTable.snapshotDate, args.to),
    inArray(gameSnapshotsTable.league, [...DEFAULT_PRODUCTION_LEAGUES]),
    buildPlausibleEventStartCondition(gameSnapshotsTable.league, gameSnapshotsTable.eventStart) ?? sql`true`,
  ];
  const cutoffCondition = buildPreFixExclusionCondition(
    gameSnapshotsTable.league,
    gameSnapshotsTable.snapshotDate,
  );
  if (cutoffCondition) conditions.push(cutoffCondition);

  const snapshots = await db
    .select({
      gameKey: gameSnapshotsTable.gameKey,
      league: gameSnapshotsTable.league,
      eventStart: gameSnapshotsTable.eventStart,
      homeTeam: gameSnapshotsTable.homeTeam,
      awayTeam: gameSnapshotsTable.awayTeam,
      homePublishMl: gameSnapshotsTable.homePublishMl,
      awayPublishMl: gameSnapshotsTable.awayPublishMl,
      homeCloseMl: gameSnapshotsTable.homeCloseMl,
      awayCloseMl: gameSnapshotsTable.awayCloseMl,
      publishSpread: gameSnapshotsTable.publishSpread,
      publishSpreadLine: gameSnapshotsTable.publishSpreadLine,
      publishAwaySpreadLine: gameSnapshotsTable.publishAwaySpreadLine,
      closeSpread: gameSnapshotsTable.closeSpread,
      closeSpreadLine: gameSnapshotsTable.closeSpreadLine,
      closeAwaySpreadLine: gameSnapshotsTable.closeAwaySpreadLine,
      publishTotal: gameSnapshotsTable.publishTotal,
      publishOverLine: gameSnapshotsTable.publishOverLine,
      publishUnderLine: gameSnapshotsTable.publishUnderLine,
      closeTotal: gameSnapshotsTable.closeTotal,
      closeOverLine: gameSnapshotsTable.closeOverLine,
      closeUnderLine: gameSnapshotsTable.closeUnderLine,
      homeScore: gameSnapshotsTable.homeScore,
      awayScore: gameSnapshotsTable.awayScore,
      status: gameSnapshotsTable.status,
      snapshotDate: gameSnapshotsTable.snapshotDate,
    })
    .from(gameSnapshotsTable)
    .where(and(...conditions))
    .orderBy(asc(gameSnapshotsTable.snapshotDate), asc(gameSnapshotsTable.league), asc(gameSnapshotsTable.eventStart));

  console.log(`\n=== replayWindowPipeline — window=[${args.from}, ${args.to}] profile=${args.profile} ===\n`);
  console.log(`Loaded ${snapshots.length} game_snapshots rows.\n`);

  const byDate = new Map<string, SnapshotRow[]>();
  for (const snap of snapshots) {
    const bucket = byDate.get(snap.snapshotDate) ?? [];
    bucket.push(snap);
    byDate.set(snap.snapshotDate, bucket);
  }

  const allReplayPicks: ReplayPick[] = [];

  for (const [date, rows] of byDate) {
    const inputs = rows.map(toGameInput);
    const scored = await scorePicks(inputs, [...MARKETS], MODEL_VERSION, {
      oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
      surfaceStatusByMarketKey: REPLAY_SURFACE_STATUS,
    });
    const baselineOfficial = scored.filter((c) => isOfficialCandidate(c));
    const filteredOfficial = applyOfficialProfile(baselineOfficial, args.profile);
    const official = applyTierProfile(filteredOfficial, args.profile);

    console.log(`${date}`);
    console.log(`  snapshots: ${rows.length}`);
    console.log(`  scored candidates: ${scored.length}`);
    console.log(`  official picks: ${official.length}`);
    if (args.profile !== "baseline" && baselineOfficial.length !== official.length) {
      console.log(`  profile trim: ${baselineOfficial.length} -> ${official.length}`);
    }
    if (args.profile === "r7_tier_a_discipline" || args.profile === "r8_no_a") {
      const originalA = filteredOfficial.filter((pick) => pick.tier === "A").length;
      const relabeledA = official.filter((pick) => pick.tier === "A").length;
      if (originalA !== relabeledA) {
        console.log(`  tier relabel: A ${originalA} -> ${relabeledA}`);
      }
    }

    const replayPicks: ReplayPick[] = [];

    for (const pick of official) {
      const snap = rows.find((row) => row.gameKey === pick.gameKey);
      if (!snap) continue;

      let result: ReplayPick["result"] = "pending";
      if (snap.status === "final" && snap.homeScore != null && snap.awayScore != null) {
        result = computeOutcomeResult({
          market: pick.marketType,
          pick: pick.side,
          homeScore: snap.homeScore,
          awayScore: snap.awayScore,
          homeSpread: asNum(snap.publishSpread),
          total: asNum(snap.publishTotal),
        });
      }

      const clv = computeClvWritebackValues(
        {
          market: pick.marketType,
          pick: pick.side,
          publishOdds: String(pick.publishOdds),
          publishLine: pick.publishLine != null ? String(pick.publishLine) : null,
        },
        {
          homeCloseMl: snap.homeCloseMl,
          awayCloseMl: snap.awayCloseMl,
          closeSpread: snap.closeSpread,
          closeSpreadLine: snap.closeSpreadLine,
          closeAwaySpreadLine: snap.closeAwaySpreadLine,
          closeTotal: snap.closeTotal,
          closeOverLine: snap.closeOverLine,
          closeUnderLine: snap.closeUnderLine,
        },
      );

      const replayPick: ReplayPick = {
        id: 0,
        date,
        gameKey: pick.gameKey,
        league: pick.league,
        market: pick.marketType,
        pick: pick.side,
        eventStart: pick.eventStart,
        publishOdds: pick.publishOdds,
        closeOdds: asNum(clv.closeOdds),
        closeLine: asNum(clv.closeLine),
        publishLine: pick.publishLine,
        modelProbCalibrated: pick.modelProbCalibrated,
        result,
        ev: pick.ev,
        edge: pick.edge,
        clvImpliedDelta: asNum(clv.clvImpliedDelta),
        tier: pick.tier,
      };
      replayPicks.push(replayPick);
      allReplayPicks.push(replayPick);

      console.log(
        `    - [${pick.tier}] ${pick.league.toUpperCase()} ${describePick(pick)} | edge ${formatSignedPercent(pick.edge)} | EV ${formatSignedPercent(pick.ev)} | model ${formatPercent(pick.modelProbCalibrated)} | result ${result.toUpperCase()} | starts ${formatEventStart(pick.eventStart)}`,
      );
    }

    if (replayPicks.length > 0) {
      const day = summarizeDayPicks(replayPicks);
      console.log(
        `  day summary: ${day.wins}W-${day.losses}L-${day.pushes}P | avg CLV ${day.avgClv != null ? formatSignedPercent(day.avgClv) : "n/a"} | clv n=${day.clvN}`,
      );
    }
    console.log("");
  }

  const metrics = computeValidationMetrics(allReplayPicks, byDate.size);
  console.log("=== Overall summary ===");
  console.log(`total picks: ${metrics.totalPicks}`);
  console.log(`record: ${metrics.wins}W-${metrics.losses}L-${metrics.pushes}P (${metrics.pending} pending)`);
  console.log(`win rate: ${formatPercent(metrics.winRate)}`);
  console.log(`ROI: ${formatSignedPercent(metrics.roi)}`);
  console.log(`units won: ${metrics.unitsWon.toFixed(2)}`);
  console.log(`avg edge: ${formatSignedPercent(metrics.avgEdge)}`);
  console.log(`avg EV: ${formatSignedPercent(metrics.avgEv)}`);
  console.log(`avg CLV: ${metrics.clvSampleSize > 0 ? formatSignedPercent(metrics.avgClv) : "n/a"} | clv n=${metrics.clvSampleSize}`);
  console.log(`Brier: ${metrics.brierScore.toFixed(4)} | LogLoss: ${metrics.logLoss.toFixed(4)}`);
  console.log(`picks/day: ${metrics.picksPerDay.toFixed(2)}`);
  console.log(`market breakdown: ${Object.entries(metrics.marketBreakdown).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);
  console.log("");
  printBucketTable(
    "=== Breakdown by market ===",
    summarizeBuckets(allReplayPicks, (pick) => pick.market),
  );
  printBucketTable(
    "=== Breakdown by league ===",
    summarizeBuckets(allReplayPicks, (pick) => pick.league),
  );
  printBucketTable(
    "=== Breakdown by tier ===",
    summarizeBuckets(allReplayPicks, (pick) => pick.tier),
  );
  printBucketTable(
    "=== Breakdown by odds band ===",
    summarizeBuckets(allReplayPicks, (pick) => getBucketLabelForOdds(pick.publishOdds)),
  );
  printBucketTable(
    "=== Breakdown by edge bucket ===",
    summarizeBuckets(allReplayPicks, (pick) => getBucketLabelForEdge(pick.edge)),
  );
  printBucketTable(
    "=== Breakdown by EV bucket ===",
    summarizeBuckets(allReplayPicks, (pick) => getBucketLabelForEv(pick.ev)),
  );
  console.log("READ-ONLY — no DB writes performed.");
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exitCode = 1;
});
