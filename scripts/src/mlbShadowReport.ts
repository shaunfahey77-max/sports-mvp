/**
 * MLB Shadow-Mode KPI Report (Phase 0.75D internal validation).
 *
 * Read-only: queries candidate_bets (for surfacing-funnel metrics) and
 * scored_picks (for settlement + calibration metrics) for league=mlb only.
 * Does not write to the database, does not import any production route
 * code, and does not affect the public surface in any way.
 *
 * Emits a human-readable daily table plus a machine-readable JSON document.
 *
 * What this report covers (per the Phase 0.75D shadow-mode spec):
 *   - candidate count          (every model evaluation)
 *   - surfaced count           (count that reached scored_picks)
 *   - edge distribution        (percentiles + histogram, candidate level)
 *   - settlement results       (W/L/P, ROI, win rate on resolved picks)
 *   - calibration buckets      (model_prob bucket → realized win rate)
 *   - tier distribution        (PASS / A / B / C counts)
 *
 * Public exposure: NONE. MLB remains gated out of DEFAULT_PRODUCTION_LEAGUES.
 * Deploy: NONE. Branch-only.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx src/mlbShadowReport.ts \
 *     [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--json-only]
 */

import { and, eq, gte, lte } from "drizzle-orm";
import {
  db,
  candidateBetsTable,
  scoredPicksTable,
} from "@workspace/db";
import {
  americanToDecimal,
  americanToImplied,
} from "../../artifacts/api-server/src/scoring/marketProb";

interface Args {
  start?: string;
  end?: string;
  jsonOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { jsonOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === "--start") out.start = next();
    else if (a === "--end") out.end = next();
    else if (a === "--json-only") out.jsonOnly = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: mlbShadowReport [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--json-only]"
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out;
}

export interface CandidateRow {
  snapshotDate: string;
  gameKey: string;
  marketType: string;
  side: string;
  publishOdds: number;
  modelProbCalibrated: number;
  marketProbFair: number;
  edge: number;
  ev: number;
  tier: string;
  selectionReason: string | null;
}

export interface SurfacedRow {
  date: string;
  market: string;
  pick: string;
  result: "win" | "loss" | "push" | "pending";
  publishOdds: number;
  modelProbCalibrated: number;
  edge: number;
  tier: string;
}

export interface DailyBucket {
  date: string;
  candidates: number;
  surfaced: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  unitsWon: number;
  roi: number;
  avgCandidateEdge: number;
  maxCandidateEdge: number;
}

export interface EdgeDistribution {
  n: number;
  min: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  histogram: Array<{ bucket: string; count: number }>;
}

export interface CalibrationBucket {
  rangeLow: number;
  rangeHigh: number;
  count: number;
  resolvedCount: number;
  meanModelProb: number;
  meanImpliedProb: number;
  realizedWinRate: number;
}

export interface OverallSettlement {
  total: number;
  resolved: number;
  pending: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  unitsWon: number;
  roi: number;
  brierScore: number;
}

/**
 * Linear-interpolation percentile (matches NumPy's default `linear` method).
 * For q in [0,1], returns the q-th quantile of `arr`. Empty input → 0.
 */
function pct(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function edgeDistribution(rows: CandidateRow[]): EdgeDistribution {
  if (rows.length === 0) {
    return { n: 0, min: 0, p25: 0, p50: 0, p75: 0, p90: 0, max: 0, histogram: [] };
  }
  const edges = rows.map((r) => r.edge);
  const bins: Array<[string, (e: number) => boolean]> = [
    ["<-0.02", (e) => e < -0.02],
    ["-0.02..0", (e) => e >= -0.02 && e < 0],
    ["0..0.02", (e) => e >= 0 && e < 0.02],
    ["0.02..0.05", (e) => e >= 0.02 && e < 0.05],
    ["0.05..0.10", (e) => e >= 0.05 && e < 0.10],
    ["0.10..0.20", (e) => e >= 0.10 && e < 0.20],
    [">=0.20", (e) => e >= 0.20],
  ];
  const histogram = bins.map(([bucket, pred]) => ({
    bucket,
    count: edges.filter(pred).length,
  }));
  return {
    n: edges.length,
    min: Math.min(...edges),
    p25: pct(edges, 0.25),
    p50: pct(edges, 0.50),
    p75: pct(edges, 0.75),
    p90: pct(edges, 0.90),
    max: Math.max(...edges),
    histogram,
  };
}

export function calibrationBuckets(rows: SurfacedRow[]): CalibrationBucket[] {
  const edges = [0, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 1.0];
  const out: CalibrationBucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const isLast = i === edges.length - 2;
    // Final bucket is right-inclusive so a model_prob of exactly 1.0 lands
    // in [0.70, 1.00] instead of being silently dropped.
    const inBucket = rows.filter((r) =>
      isLast
        ? r.modelProbCalibrated >= lo && r.modelProbCalibrated <= hi
        : r.modelProbCalibrated >= lo && r.modelProbCalibrated < hi
    );
    const resolved = inBucket.filter((r) => r.result === "win" || r.result === "loss");
    const wins = resolved.filter((r) => r.result === "win").length;
    out.push({
      rangeLow: lo,
      rangeHigh: hi,
      count: inBucket.length,
      resolvedCount: resolved.length,
      meanModelProb:
        inBucket.length > 0
          ? inBucket.reduce((s, r) => s + r.modelProbCalibrated, 0) / inBucket.length
          : 0,
      meanImpliedProb:
        inBucket.length > 0
          ? inBucket.reduce((s, r) => s + americanToImplied(r.publishOdds), 0) /
            inBucket.length
          : 0,
      realizedWinRate: resolved.length > 0 ? wins / resolved.length : 0,
    });
  }
  return out;
}

export function overallSettlement(rows: SurfacedRow[]): OverallSettlement {
  const resolved = rows.filter((r) => r.result !== "pending");
  const wins = resolved.filter((r) => r.result === "win").length;
  const losses = resolved.filter((r) => r.result === "loss").length;
  const pushes = resolved.filter((r) => r.result === "push").length;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
  let unitsWon = 0;
  for (const r of resolved) {
    if (r.result === "win") unitsWon += americanToDecimal(r.publishOdds) - 1;
    else if (r.result === "loss") unitsWon -= 1;
  }
  const roi = resolved.length > 0 ? unitsWon / resolved.length : 0;
  // Brier is a binary-outcome calibration metric; pushes have no binary
  // outcome and must be excluded from both the numerator and denominator.
  const binaryResolved = resolved.filter(
    (r) => r.result === "win" || r.result === "loss"
  );
  let brierSum = 0;
  for (const r of binaryResolved) {
    const outcome = r.result === "win" ? 1 : 0;
    const p = Math.max(0.001, Math.min(0.999, r.modelProbCalibrated));
    brierSum += (p - outcome) ** 2;
  }
  const brierScore =
    binaryResolved.length > 0 ? brierSum / binaryResolved.length : 0;
  return {
    total: rows.length,
    resolved: resolved.length,
    pending: rows.length - resolved.length,
    wins,
    losses,
    pushes,
    winRate,
    unitsWon,
    roi,
    brierScore,
  };
}

export function dailyBuckets(
  candidates: CandidateRow[],
  surfaced: SurfacedRow[]
): DailyBucket[] {
  const days = new Set<string>([
    ...candidates.map((c) => c.snapshotDate),
    ...surfaced.map((s) => s.date),
  ]);
  const sorted = [...days].sort();
  return sorted.map((date) => {
    const cs = candidates.filter((c) => c.snapshotDate === date);
    const ss = surfaced.filter((s) => s.date === date);
    const resolved = ss.filter((s) => s.result !== "pending");
    const wins = resolved.filter((s) => s.result === "win").length;
    const losses = resolved.filter((s) => s.result === "loss").length;
    const pushes = resolved.filter((s) => s.result === "push").length;
    let unitsWon = 0;
    for (const s of resolved) {
      if (s.result === "win") unitsWon += americanToDecimal(s.publishOdds) - 1;
      else if (s.result === "loss") unitsWon -= 1;
    }
    const csEdges = cs.map((c) => c.edge);
    return {
      date,
      candidates: cs.length,
      surfaced: ss.length,
      settled: resolved.length,
      wins,
      losses,
      pushes,
      winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
      unitsWon,
      roi: resolved.length > 0 ? unitsWon / resolved.length : 0,
      avgCandidateEdge: csEdges.length > 0 ? csEdges.reduce((a, b) => a + b, 0) / csEdges.length : 0,
      maxCandidateEdge: csEdges.length > 0 ? Math.max(...csEdges) : 0,
    };
  });
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}
function fmtNum(n: number, d = 4): string {
  return Number.isFinite(n) ? n.toFixed(d) : "n/a";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const candFilters = [eq(candidateBetsTable.league, "mlb")];
  if (args.start) candFilters.push(gte(candidateBetsTable.snapshotDate, args.start));
  if (args.end) candFilters.push(lte(candidateBetsTable.snapshotDate, args.end));

  const surfFilters = [eq(scoredPicksTable.league, "mlb")];
  if (args.start) surfFilters.push(gte(scoredPicksTable.date, args.start));
  if (args.end) surfFilters.push(lte(scoredPicksTable.date, args.end));

  const candidatesRaw = await db
    .select({
      snapshotDate: candidateBetsTable.snapshotDate,
      gameKey: candidateBetsTable.gameKey,
      marketType: candidateBetsTable.marketType,
      side: candidateBetsTable.side,
      publishOdds: candidateBetsTable.publishOdds,
      modelProbCalibrated: candidateBetsTable.modelProbCalibrated,
      marketProbFair: candidateBetsTable.marketProbFair,
      edge: candidateBetsTable.edge,
      ev: candidateBetsTable.ev,
      tier: candidateBetsTable.tier,
      selectionReason: candidateBetsTable.selectionReason,
    })
    .from(candidateBetsTable)
    .where(and(...candFilters))
    .orderBy(candidateBetsTable.snapshotDate);

  const surfacedRaw = await db
    .select({
      date: scoredPicksTable.date,
      market: scoredPicksTable.market,
      pick: scoredPicksTable.pick,
      result: scoredPicksTable.result,
      publishOdds: scoredPicksTable.publishOdds,
      modelProbCalibrated: scoredPicksTable.modelProbCalibrated,
      edge: scoredPicksTable.edge,
      tier: scoredPicksTable.tier,
    })
    .from(scoredPicksTable)
    .where(and(...surfFilters))
    .orderBy(scoredPicksTable.date);

  const candidates: CandidateRow[] = candidatesRaw.map((r) => ({
    snapshotDate: r.snapshotDate,
    gameKey: r.gameKey,
    marketType: r.marketType,
    side: r.side,
    publishOdds: Number(r.publishOdds),
    modelProbCalibrated: Number(r.modelProbCalibrated),
    marketProbFair: Number(r.marketProbFair),
    edge: Number(r.edge),
    ev: Number(r.ev),
    tier: r.tier,
    selectionReason: r.selectionReason,
  }));

  const surfaced: SurfacedRow[] = surfacedRaw.map((r) => ({
    date: r.date,
    market: r.market,
    pick: r.pick,
    result: r.result as SurfacedRow["result"],
    publishOdds: Number(r.publishOdds),
    modelProbCalibrated: Number(r.modelProbCalibrated),
    edge: Number(r.edge),
    tier: r.tier,
  }));

  const tierCounts: Record<string, number> = {};
  for (const c of candidates) tierCounts[c.tier] = (tierCounts[c.tier] ?? 0) + 1;
  const reasonCounts: Record<string, number> = {};
  for (const c of candidates) {
    const k = c.selectionReason ?? "(null)";
    reasonCounts[k] = (reasonCounts[k] ?? 0) + 1;
  }

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      league: "mlb",
      mode: "shadow",
      window: { start: args.start ?? null, end: args.end ?? null },
      caveat:
        "Internal shadow-mode report. MLB is hidden from the public surface " +
        "(DEFAULT_PRODUCTION_LEAGUES = nba+nhl). Calibration starts at identity, " +
        "so candidate edges concentrate near zero by design until realized " +
        "results justify a sigmoid/isotonic refit.",
      counts: {
        candidates: candidates.length,
        surfaced: surfaced.length,
      },
    },
    daily: dailyBuckets(candidates, surfaced),
    overallSettlement: overallSettlement(surfaced),
    edgeDistribution: edgeDistribution(candidates),
    calibration: calibrationBuckets(surfaced),
    tierCounts,
    selectionReasonCounts: reasonCounts,
  };

  if (!args.jsonOnly) {
    const lines: string[] = [];
    lines.push("=".repeat(110));
    lines.push("SportsMVP — MLB Shadow-Mode KPI Report (Phase 0.75D, internal-only, NO DEPLOY)");
    lines.push("=".repeat(110));
    lines.push(`generated: ${report.meta.generatedAt}`);
    lines.push(`window:    ${args.start ?? "(open)"} .. ${args.end ?? "(open)"}`);
    lines.push(`candidates: ${candidates.length}    surfaced (scored_picks): ${surfaced.length}`);
    lines.push("");
    lines.push("CAVEAT: " + report.meta.caveat);
    lines.push("");

    lines.push("-".repeat(110));
    lines.push("DAILY");
    lines.push("-".repeat(110));
    lines.push(
      [
        "date".padEnd(12),
        "cands".padEnd(7),
        "surf".padEnd(6),
        "settled".padEnd(8),
        "w-l-p".padEnd(10),
        "wr".padEnd(8),
        "u".padEnd(8),
        "roi".padEnd(9),
        "avgEdge".padEnd(10),
        "maxEdge",
      ].join(" ")
    );
    for (const d of report.daily) {
      lines.push(
        [
          d.date.padEnd(12),
          String(d.candidates).padEnd(7),
          String(d.surfaced).padEnd(6),
          String(d.settled).padEnd(8),
          `${d.wins}-${d.losses}-${d.pushes}`.padEnd(10),
          fmtPct(d.winRate).padEnd(8),
          d.unitsWon.toFixed(2).padEnd(8),
          fmtPct(d.roi).padEnd(9),
          fmtNum(d.avgCandidateEdge).padEnd(10),
          fmtNum(d.maxCandidateEdge),
        ].join(" ")
      );
    }
    lines.push("");

    const o = report.overallSettlement;
    lines.push("-".repeat(110));
    lines.push("OVERALL SETTLEMENT");
    lines.push("-".repeat(110));
    lines.push(
      `total=${o.total}  resolved=${o.resolved}  pending=${o.pending}  ` +
        `w-l-p=${o.wins}-${o.losses}-${o.pushes}  ` +
        `wr=${fmtPct(o.winRate)}  roi=${fmtPct(o.roi)}  u=${o.unitsWon.toFixed(2)}  ` +
        `brier=${fmtNum(o.brierScore)}`
    );
    lines.push("");

    const e = report.edgeDistribution;
    lines.push("-".repeat(110));
    lines.push("EDGE DISTRIBUTION (candidate level, all markets)");
    lines.push("-".repeat(110));
    lines.push(
      `n=${e.n}  min=${fmtNum(e.min)}  p25=${fmtNum(e.p25)}  p50=${fmtNum(e.p50)}  ` +
        `p75=${fmtNum(e.p75)}  p90=${fmtNum(e.p90)}  max=${fmtNum(e.max)}`
    );
    for (const h of e.histogram) {
      lines.push(`  ${h.bucket.padEnd(14)} ${h.count}`);
    }
    lines.push("");

    lines.push("-".repeat(110));
    lines.push("CALIBRATION (model_prob bucket → realized win rate, surfaced picks only)");
    lines.push("-".repeat(110));
    for (const b of report.calibration) {
      lines.push(
        `  [${b.rangeLow.toFixed(2)},${b.rangeHigh.toFixed(2)})  ` +
          `n=${b.count}  resolved=${b.resolvedCount}  ` +
          `meanModel=${fmtNum(b.meanModelProb)}  meanImplied=${fmtNum(b.meanImpliedProb)}  ` +
          `realized=${fmtPct(b.realizedWinRate)}`
      );
    }
    lines.push("");

    lines.push("-".repeat(110));
    lines.push("TIER COUNTS (candidate level)");
    lines.push("-".repeat(110));
    for (const [tier, n] of Object.entries(tierCounts)) {
      lines.push(`  ${tier.padEnd(8)} ${n}`);
    }
    lines.push("");

    lines.push("-".repeat(110));
    lines.push("SELECTION REASONS (candidate level)");
    lines.push("-".repeat(110));
    for (const [reason, n] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${reason.padEnd(28)} ${n}`);
    }
    lines.push("");

    lines.push("=".repeat(110));
    lines.push("JSON document follows on next line");
    lines.push("=".repeat(110));
    console.log(lines.join("\n"));
  }

  console.log(JSON.stringify(report, null, 2));
}

const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("mlbShadowReport.ts");
if (isDirectInvocation) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("mlbShadowReport failed:", err);
      process.exit(1);
    });
}
