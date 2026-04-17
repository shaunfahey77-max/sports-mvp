/**
 * Internal KPI report (Phase 0.75B, priority 1-5).
 *
 * Read-only: queries scored_picks + game_snapshots and emits a human-readable
 * table plus a machine-readable JSON document. Does not write to the database
 * and does not import any production route code.
 *
 * Cohorts:
 *   PRE  = picks inserted strictly before --postFixCutoff
 *   POST = picks inserted at or after --postFixCutoff
 *   ALL  = both, clearly labeled "mixed"
 *
 * Default cutoff is 2026-04-16T00:00:00Z (Task #4 NHL line-matching fix).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx src/kpiReport.ts \
 *     [--start YYYY-MM-DD] [--end YYYY-MM-DD] \
 *     [--leagues nba,nhl] [--postFixCutoff 2026-04-16T00:00:00Z] \
 *     [--json-only]
 */

import { and, gte, lte, inArray, sql } from "drizzle-orm";
import { db, scoredPicksTable } from "@workspace/db";
import {
  americanToDecimal,
  americanToImplied,
} from "../../artifacts/api-server/src/scoring/marketProb";

type Cohort = "PRE" | "POST" | "ALL";

interface Args {
  start?: string;
  end?: string;
  leagues: string[];
  postFixCutoff: Date;
  jsonOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    leagues: ["nba", "nhl"],
    postFixCutoff: new Date("2026-04-16T00:00:00Z"),
    jsonOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === "--start") out.start = next();
    else if (a === "--end") out.end = next();
    else if (a === "--leagues") out.leagues = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--postFixCutoff") out.postFixCutoff = new Date(next());
    else if (a === "--json-only") out.jsonOnly = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: kpiReport [--start YYYY-MM-DD] [--end YYYY-MM-DD] " +
          "[--leagues nba,nhl] [--postFixCutoff ISO] [--json-only]"
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (Number.isNaN(out.postFixCutoff.getTime())) {
    throw new Error("Invalid --postFixCutoff (use ISO 8601 UTC)");
  }
  return out;
}

export interface PickRow {
  id: number;
  date: string;
  league: string;
  market: string;
  pick: string;
  result: "win" | "loss" | "push" | "pending";
  publishOdds: number;
  modelProbCalibrated: number;
  edge: number;
  ev: number;
  tier: string;
  clvImpliedDelta: number | null;
  createdAt: Date;
}

interface MetricBlock {
  totalPicks: number;
  resolved: number;
  pending: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  unitsWon: number;
  roi: number;
  picksPerDay: number;
  avgImpliedProb: number;
  avgModelProb: number;
  avgEdge: number;
  avgEv: number;
  brierScore: number;
  logLoss: number;
  tierCounts: Record<string, number>;
  clvSampleSize: number;
  avgClv: number;
  clvHitRate: number;
  redFlags: {
    highEdgePicks: number; // edge > 0.20
    extremeEdgePicks: number; // edge > 0.30
    oddsOutOfRange: number; // |publishOdds| outside [-350, 350]
  };
}

const EMPTY_METRIC: MetricBlock = {
  totalPicks: 0,
  resolved: 0,
  pending: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  winRate: 0,
  unitsWon: 0,
  roi: 0,
  picksPerDay: 0,
  avgImpliedProb: 0,
  avgModelProb: 0,
  avgEdge: 0,
  avgEv: 0,
  brierScore: 0,
  logLoss: 0,
  tierCounts: {},
  clvSampleSize: 0,
  avgClv: 0,
  clvHitRate: 0,
  redFlags: { highEdgePicks: 0, extremeEdgePicks: 0, oddsOutOfRange: 0 },
};

export function computeMetrics(picks: PickRow[]): MetricBlock {
  if (picks.length === 0) return { ...EMPTY_METRIC, tierCounts: {} };

  const resolved = picks.filter((p) => p.result !== "pending");
  const wins = resolved.filter((p) => p.result === "win").length;
  const losses = resolved.filter((p) => p.result === "loss").length;
  const pushes = resolved.filter((p) => p.result === "push").length;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;

  let unitsWon = 0;
  for (const p of resolved) {
    if (p.result === "win") unitsWon += americanToDecimal(p.publishOdds) - 1;
    else if (p.result === "loss") unitsWon -= 1;
  }
  const roi = resolved.length > 0 ? unitsWon / resolved.length : 0;

  const dates = new Set(picks.map((p) => p.date));
  const picksPerDay = dates.size > 0 ? picks.length / dates.size : 0;

  const avgImpliedProb =
    picks.reduce((s, p) => s + americanToImplied(p.publishOdds), 0) / picks.length;
  const avgModelProb =
    picks.reduce((s, p) => s + p.modelProbCalibrated, 0) / picks.length;
  const avgEdge =
    resolved.length > 0
      ? resolved.reduce((s, p) => s + p.edge, 0) / resolved.length
      : picks.reduce((s, p) => s + p.edge, 0) / picks.length;
  const avgEv =
    resolved.length > 0
      ? resolved.reduce((s, p) => s + p.ev, 0) / resolved.length
      : picks.reduce((s, p) => s + p.ev, 0) / picks.length;

  // Brier / log-loss: parity with computeValidationMetrics in
  // artifacts/api-server/src/scoring/validatePicks.ts — pushes are included and
  // counted as outcome=0. Keep this in sync with the production helper.
  let brierSum = 0;
  let logLossSum = 0;
  for (const p of resolved) {
    const outcome = p.result === "win" ? 1 : 0;
    const prob = Math.max(0.001, Math.min(0.999, p.modelProbCalibrated));
    brierSum += (prob - outcome) ** 2;
    logLossSum += -(outcome * Math.log(prob) + (1 - outcome) * Math.log(1 - prob));
  }
  const brierScore = resolved.length > 0 ? brierSum / resolved.length : 0;
  const logLoss = resolved.length > 0 ? logLossSum / resolved.length : 0;

  const tierCounts: Record<string, number> = {};
  for (const p of picks) tierCounts[p.tier] = (tierCounts[p.tier] ?? 0) + 1;

  const MAX_CLV_DELTA = 0.2;
  const clvPicks = picks.filter(
    (p) => p.clvImpliedDelta != null && Math.abs(p.clvImpliedDelta) <= MAX_CLV_DELTA
  );
  const avgClv =
    clvPicks.length > 0
      ? clvPicks.reduce((s, p) => s + (p.clvImpliedDelta ?? 0), 0) / clvPicks.length
      : 0;
  const clvHitRate =
    clvPicks.length > 0
      ? clvPicks.filter((p) => (p.clvImpliedDelta ?? 0) > 0).length / clvPicks.length
      : 0;

  const redFlags = {
    highEdgePicks: picks.filter((p) => p.edge > 0.2).length,
    extremeEdgePicks: picks.filter((p) => p.edge > 0.3).length,
    oddsOutOfRange: picks.filter(
      (p) => p.publishOdds < -350 || p.publishOdds > 350
    ).length,
  };

  return {
    totalPicks: picks.length,
    resolved: resolved.length,
    pending: picks.length - resolved.length,
    wins,
    losses,
    pushes,
    winRate,
    unitsWon,
    roi,
    picksPerDay,
    avgImpliedProb,
    avgModelProb,
    avgEdge,
    avgEv,
    brierScore,
    logLoss,
    tierCounts,
    clvSampleSize: clvPicks.length,
    avgClv,
    clvHitRate,
    redFlags,
  };
}

interface CalibrationBucket {
  rangeLow: number;
  rangeHigh: number;
  count: number;
  meanModelProb: number;
  meanImpliedProb: number;
  realizedWinRate: number;
  resolvedCount: number;
}

function calibrationBuckets(picks: PickRow[]): CalibrationBucket[] {
  const edges = [0, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 1.0];
  const out: CalibrationBucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const inBucket = picks.filter(
      (p) => p.modelProbCalibrated >= lo && p.modelProbCalibrated < hi
    );
    const resolved = inBucket.filter(
      (p) => p.result === "win" || p.result === "loss"
    );
    const wins = resolved.filter((p) => p.result === "win").length;
    out.push({
      rangeLow: lo,
      rangeHigh: hi,
      count: inBucket.length,
      meanModelProb:
        inBucket.length > 0
          ? inBucket.reduce((s, p) => s + p.modelProbCalibrated, 0) / inBucket.length
          : 0,
      meanImpliedProb:
        inBucket.length > 0
          ? inBucket.reduce((s, p) => s + americanToImplied(p.publishOdds), 0) /
            inBucket.length
          : 0,
      realizedWinRate: resolved.length > 0 ? wins / resolved.length : 0,
      resolvedCount: resolved.length,
    });
  }
  return out;
}

interface WeakMarketFlag {
  league: string;
  market: string;
  cohort: Cohort;
  reason: string;
  metric: number;
  resolved: number;
}

function flagWeakMarkets(
  byMarket: Record<string, MetricBlock>,
  cohort: Cohort
): WeakMarketFlag[] {
  const flags: WeakMarketFlag[] = [];
  for (const [key, m] of Object.entries(byMarket)) {
    const [league, market] = key.split(":");
    if (m.resolved < 5) continue;
    if (m.roi < -0.1) {
      flags.push({
        league,
        market,
        cohort,
        reason: "ROI below -10%",
        metric: m.roi,
        resolved: m.resolved,
      });
    }
    if (m.winRate < 0.4 && m.resolved >= 10) {
      flags.push({
        league,
        market,
        cohort,
        reason: "Win rate below 40% on >=10 resolved",
        metric: m.winRate,
        resolved: m.resolved,
      });
    }
    if (m.brierScore > 0.27 && m.resolved >= 10) {
      flags.push({
        league,
        market,
        cohort,
        reason: "Brier score worse than naive 50/50 (>0.27)",
        metric: m.brierScore,
        resolved: m.resolved,
      });
    }
    if (m.redFlags.highEdgePicks / m.totalPicks > 0.2 && m.totalPicks >= 10) {
      flags.push({
        league,
        market,
        cohort,
        reason: ">20% of picks carry edge >0.20 (likely calibration drift)",
        metric: m.redFlags.highEdgePicks / m.totalPicks,
        resolved: m.resolved,
      });
    }
  }
  return flags;
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}
function fmtNum(n: number, d = 3): string {
  return Number.isFinite(n) ? n.toFixed(d) : "n/a";
}

function printMetricLine(label: string, m: MetricBlock): string {
  return [
    label.padEnd(28),
    `n=${m.totalPicks}`.padEnd(8),
    `res=${m.resolved}`.padEnd(8),
    `w-l-p=${m.wins}-${m.losses}-${m.pushes}`.padEnd(16),
    `wr=${fmtPct(m.winRate)}`.padEnd(11),
    `roi=${fmtPct(m.roi)}`.padEnd(13),
    `u=${fmtNum(m.unitsWon, 2)}`.padEnd(12),
    `edge=${fmtNum(m.avgEdge)}`.padEnd(13),
    `ev=${fmtNum(m.avgEv)}`.padEnd(12),
    `brier=${fmtNum(m.brierScore)}`,
  ].join(" ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const filters = [inArray(scoredPicksTable.league, args.leagues)];
  if (args.start) filters.push(gte(scoredPicksTable.date, args.start));
  if (args.end) filters.push(lte(scoredPicksTable.date, args.end));

  const rows = await db
    .select({
      id: scoredPicksTable.id,
      date: scoredPicksTable.date,
      league: scoredPicksTable.league,
      market: scoredPicksTable.market,
      pick: scoredPicksTable.pick,
      result: scoredPicksTable.result,
      publishOdds: scoredPicksTable.publishOdds,
      modelProbCalibrated: scoredPicksTable.modelProbCalibrated,
      edge: scoredPicksTable.edge,
      ev: scoredPicksTable.ev,
      tier: scoredPicksTable.tier,
      clvImpliedDelta: scoredPicksTable.clvImpliedDelta,
      createdAt: scoredPicksTable.createdAt,
    })
    .from(scoredPicksTable)
    .where(and(...filters))
    .orderBy(scoredPicksTable.date, scoredPicksTable.id);

  const picks: PickRow[] = rows.map((r) => ({
    id: r.id,
    date: r.date,
    league: r.league,
    market: r.market,
    pick: r.pick,
    result: r.result as PickRow["result"],
    publishOdds: Number(r.publishOdds),
    modelProbCalibrated: Number(r.modelProbCalibrated),
    edge: Number(r.edge),
    ev: Number(r.ev),
    tier: r.tier,
    clvImpliedDelta: r.clvImpliedDelta == null ? null : Number(r.clvImpliedDelta),
    createdAt: r.createdAt as Date,
  }));

  const cutoffMs = args.postFixCutoff.getTime();
  const cohorts: Record<Cohort, PickRow[]> = {
    PRE: picks.filter((p) => p.createdAt.getTime() < cutoffMs),
    POST: picks.filter((p) => p.createdAt.getTime() >= cutoffMs),
    ALL: picks,
  };

  function bucketByLeagueMarket(rows: PickRow[]): Record<string, MetricBlock> {
    const out: Record<string, MetricBlock> = {};
    const groups = new Map<string, PickRow[]>();
    for (const p of rows) {
      const key = `${p.league}:${p.market}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    for (const [key, list] of groups) out[key] = computeMetrics(list);
    return out;
  }

  function bucketByLeague(rows: PickRow[]): Record<string, MetricBlock> {
    const out: Record<string, MetricBlock> = {};
    const groups = new Map<string, PickRow[]>();
    for (const p of rows) {
      if (!groups.has(p.league)) groups.set(p.league, []);
      groups.get(p.league)!.push(p);
    }
    for (const [k, l] of groups) out[k] = computeMetrics(l);
    return out;
  }

  function tierCompare(rows: PickRow[]) {
    const a = computeMetrics(rows.filter((p) => p.tier === "A"));
    const b = computeMetrics(rows.filter((p) => p.tier === "B"));
    const c = computeMetrics(rows.filter((p) => p.tier === "C"));
    return { A: a, B: b, C: c };
  }

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      args,
      postFixCutoff: args.postFixCutoff.toISOString(),
      totalRows: picks.length,
      cohortCounts: {
        PRE: cohorts.PRE.length,
        POST: cohorts.POST.length,
        ALL: cohorts.ALL.length,
      },
      caveat:
        "PRE rows reflect the pre-Task-#4 line-matching pipeline and may carry inflated NHL edges. " +
        "POST rows reflect the post-fix pipeline. ALL is mixed and should not be used for tier or calibration conclusions.",
    },
    cohorts: {} as Record<
      Cohort,
      {
        overall: MetricBlock;
        byLeague: Record<string, MetricBlock>;
        byLeagueMarket: Record<string, MetricBlock>;
        tierBreakdown: ReturnType<typeof tierCompare>;
        tierBreakdownByLeague: Record<string, ReturnType<typeof tierCompare>>;
        calibration: CalibrationBucket[];
        calibrationByLeague: Record<string, CalibrationBucket[]>;
        weakMarkets: WeakMarketFlag[];
      }
    >,
  };

  for (const cohort of ["PRE", "POST", "ALL"] as Cohort[]) {
    const rows = cohorts[cohort];
    const byLeague = bucketByLeague(rows);
    const byLeagueMarket = bucketByLeagueMarket(rows);
    const tierBreakdownByLeague: Record<string, ReturnType<typeof tierCompare>> = {};
    const calibrationByLeague: Record<string, CalibrationBucket[]> = {};
    for (const lg of args.leagues) {
      const lgRows = rows.filter((p) => p.league === lg);
      tierBreakdownByLeague[lg] = tierCompare(lgRows);
      calibrationByLeague[lg] = calibrationBuckets(lgRows);
    }
    report.cohorts[cohort] = {
      overall: computeMetrics(rows),
      byLeague,
      byLeagueMarket,
      tierBreakdown: tierCompare(rows),
      tierBreakdownByLeague,
      calibration: calibrationBuckets(rows),
      calibrationByLeague,
      weakMarkets: flagWeakMarkets(byLeagueMarket, cohort),
    };
  }

  if (!args.jsonOnly) {
    const lines: string[] = [];
    lines.push("=".repeat(120));
    lines.push("SportsMVP — Internal KPI Report (Phase 0.75B)");
    lines.push("=".repeat(120));
    lines.push(`generated: ${report.meta.generatedAt}`);
    lines.push(`leagues:   ${args.leagues.join(", ")}`);
    lines.push(`window:    ${args.start ?? "(open)"} .. ${args.end ?? "(open)"}`);
    lines.push(`postFixCutoff: ${report.meta.postFixCutoff}`);
    lines.push(
      `cohorts:   PRE=${cohorts.PRE.length}  POST=${cohorts.POST.length}  ALL(mixed)=${cohorts.ALL.length}`
    );
    lines.push("");
    lines.push("CAVEAT: " + report.meta.caveat);
    lines.push("");

    for (const cohort of ["PRE", "POST", "ALL"] as Cohort[]) {
      const c = report.cohorts[cohort];
      const tag = cohort === "ALL" ? "ALL (MIXED — labeled)" : cohort;
      lines.push("-".repeat(120));
      lines.push(`COHORT: ${tag}`);
      lines.push("-".repeat(120));
      lines.push(printMetricLine("overall", c.overall));
      lines.push("");
      lines.push("by league:");
      for (const [lg, m] of Object.entries(c.byLeague)) {
        lines.push("  " + printMetricLine(lg, m));
      }
      lines.push("");
      lines.push("by league x market:");
      for (const [k, m] of Object.entries(c.byLeagueMarket).sort()) {
        lines.push("  " + printMetricLine(k, m));
      }
      lines.push("");
      lines.push("tier A vs B vs C (per league):");
      for (const lg of args.leagues) {
        const tb = c.tierBreakdownByLeague[lg];
        lines.push(`  ${lg}/A: ` + printMetricLine("", tb.A));
        lines.push(`  ${lg}/B: ` + printMetricLine("", tb.B));
        lines.push(`  ${lg}/C: ` + printMetricLine("", tb.C));
      }
      lines.push("");
      lines.push("calibration (model prob bucket → realized win rate):");
      for (const lg of args.leagues) {
        lines.push(`  ${lg}:`);
        for (const b of c.calibrationByLeague[lg]) {
          lines.push(
            `    [${b.rangeLow.toFixed(2)},${b.rangeHigh.toFixed(2)})  n=${b.count} ` +
              ` resolved=${b.resolvedCount}  meanModel=${fmtNum(b.meanModelProb)} ` +
              ` meanImplied=${fmtNum(b.meanImpliedProb)}  realized=${fmtPct(b.realizedWinRate)}`
          );
        }
      }
      lines.push("");
      if (c.weakMarkets.length === 0) {
        lines.push("weak markets: none flagged");
      } else {
        lines.push("weak markets flagged:");
        for (const f of c.weakMarkets) {
          lines.push(
            `  [${f.cohort}] ${f.league}/${f.market}  reason="${f.reason}"  metric=${fmtNum(
              f.metric
            )}  resolved=${f.resolved}`
          );
        }
      }
      lines.push("");
    }

    lines.push("=".repeat(120));
    lines.push("JSON document follows on next line");
    lines.push("=".repeat(120));
    console.log(lines.join("\n"));
  }

  console.log(JSON.stringify(report, null, 2));

  // Suppress unused-var warning for sql import (kept for future extensions).
  void sql;
}

// Run main() only when invoked directly as a script. Importing this module
// (e.g. from the parity test) must NOT trigger DB queries or process.exit.
const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("kpiReport.ts");
if (isDirectInvocation) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("kpiReport failed:", err);
      process.exit(1);
    });
}
