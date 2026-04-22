/**
 * NFL Spread v2.1 — Tier A Threshold Sensitivity Sweep
 *
 * Offline, read-only research script. Replays the same 2025 NFL season
 * window used by the v2 / v2.1 backtests, then sweeps the Tier A
 * rank-score threshold across a grid to answer:
 *
 *   "Does a more selective Tier A become clearly positive, better
 *    calibrated, and clearly better than Tier B?"
 *
 * Scope guarantees:
 *  - DOES NOT modify the model. Same code path, same constants.
 *  - DOES NOT add features.
 *  - DOES NOT change calibration.
 *  - DOES NOT touch the gate. NFL stays MARKET_DISABLED.nfl_spread=true.
 *  - DOES NOT write to the DB. DOES NOT expose any route.
 *
 * Tier A is the only thing varied. Tier B / C thresholds are kept at
 * the production defaults (0.50 / 0.35) so we measure how Tier A
 * tightening reshuffles the same surfaced cohort, not the whole
 * scoring system.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx \
 *     src/nflTierThresholdSweep.ts \
 *     [--start 2025-09-01] [--end 2026-02-10]
 */

import { and, eq, gte, lte, isNotNull } from "drizzle-orm";
import { db, gameSnapshotsTable } from "@workspace/db";
import { scorePicks, type GameMarketInput, type CandidateOutput }
  from "../../artifacts/api-server/src/scoring/scorePicks";
import { computeOutcomeResult }
  from "../../artifacts/api-server/src/scoring/validatePicks";
import { americanToDecimal, americanToImplied }
  from "../../artifacts/api-server/src/scoring/marketProb";
import {
  TIER_THRESHOLDS,
  MIN_EDGE_TO_CANDIDATE,
  MIN_EV_TO_CANDIDATE,
  MARKET_MIN_EDGE,
  type League,
} from "../../artifacts/api-server/src/config/scoringModelConfig";

interface Args { start?: string; end?: string }

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--start") out.start = argv[++i];
    else if (a === "--end") out.end = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("Usage: nflTierThresholdSweep [--start YYYY-MM-DD] [--end YYYY-MM-DD]");
      process.exit(0);
    } else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

interface GradedCandidate {
  c: CandidateOutput;
  result: "win" | "loss" | "push" | "pending";
  qualifiesAsCandidate: boolean; // passes market_quality / edge / EV gates
}

interface TierBucketMetrics {
  n: number;
  resolvedN: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  units: number;
  roi: number;
  brier: number;
  meanModelProb: number;
  meanRealizedRate: number;
}

function computeTierMetrics(items: GradedCandidate[]): TierBucketMetrics {
  const resolved = items.filter((g) => g.result !== "pending");
  const binary = resolved.filter((g) => g.result === "win" || g.result === "loss");
  const wins = binary.filter((g) => g.result === "win").length;
  const losses = binary.filter((g) => g.result === "loss").length;
  const pushes = resolved.filter((g) => g.result === "push").length;
  let units = 0;
  for (const g of resolved) {
    if (g.result === "win") units += americanToDecimal(g.c.publishOdds) - 1;
    else if (g.result === "loss") units -= 1;
  }
  let brierSum = 0;
  for (const g of binary) {
    const y = g.result === "win" ? 1 : 0;
    const p = Math.max(1e-6, Math.min(1 - 1e-6, g.c.modelProbCalibrated));
    brierSum += (p - y) ** 2;
  }
  const meanModel = items.length > 0
    ? items.reduce((s, g) => s + g.c.modelProbCalibrated, 0) / items.length
    : 0;
  return {
    n: items.length,
    resolvedN: resolved.length,
    wins, losses, pushes,
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    units,
    roi: resolved.length > 0 ? units / resolved.length : 0,
    brier: binary.length > 0 ? brierSum / binary.length : 0,
    meanModelProb: meanModel,
    meanRealizedRate: wins + losses > 0 ? wins / (wins + losses) : 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = args.start ?? "2025-09-01";
  const end = args.end ?? "2026-02-10";

  const filters = [
    eq(gameSnapshotsTable.league, "nfl"),
    isNotNull(gameSnapshotsTable.homeScore),
    isNotNull(gameSnapshotsTable.publishSpread),
    gte(gameSnapshotsTable.snapshotDate, start),
    lte(gameSnapshotsTable.snapshotDate, end),
  ];
  const snapshots = await db.select().from(gameSnapshotsTable).where(and(...filters));

  if (snapshots.length === 0) {
    console.log(JSON.stringify({ message: "No snapshots in window", start, end }, null, 2));
    return;
  }

  const inputs: GameMarketInput[] = snapshots.map((s) => ({
    gameKey: s.gameKey,
    league: s.league as League,
    eventStart: s.eventStart,
    homeTeam: s.homeTeam,
    awayTeam: s.awayTeam,
    homePublishMl: parseFloat(s.homePublishMl),
    awayPublishMl: parseFloat(s.awayPublishMl),
    publishSpread: s.publishSpread != null ? parseFloat(s.publishSpread) : null,
    publishSpreadLine: s.publishSpreadLine != null ? parseFloat(s.publishSpreadLine) : null,
    publishAwaySpreadLine: s.publishAwaySpreadLine != null ? parseFloat(s.publishAwaySpreadLine) : null,
    publishTotal: s.publishTotal != null ? parseFloat(s.publishTotal) : null,
    publishOverLine: s.publishOverLine != null ? parseFloat(s.publishOverLine) : null,
    publishUnderLine: s.publishUnderLine != null ? parseFloat(s.publishUnderLine) : null,
    snapshotDate: s.snapshotDate,
  }));

  const candidates = await scorePicks(inputs, ["spread"], "v2.1");

  // Grade each candidate against the realized score.
  const inputBySnap = new Map(snapshots.map((s) => [s.gameKey, s] as const));
  const minEdge = MARKET_MIN_EDGE["nfl_spread"] ?? MIN_EDGE_TO_CANDIDATE;
  const graded: GradedCandidate[] = candidates.map((c) => {
    const snap = inputBySnap.get(c.gameKey);
    let result: GradedCandidate["result"] = "pending";
    if (snap && snap.homeScore != null && snap.awayScore != null) {
      result = computeOutcomeResult({
        market: c.marketType,
        pick: c.side,
        homeScore: snap.homeScore,
        awayScore: snap.awayScore,
        homeSpread: snap.publishSpread != null ? parseFloat(String(snap.publishSpread)) : null,
        total: null,
      });
    }
    // Same gate logic as shadowAssignTier: market_quality + edge + EV.
    const qualifiesAsCandidate =
      c.marketQuality >= 0.3 && c.edge >= minEdge && c.ev >= MIN_EV_TO_CANDIDATE;
    return { c, result, qualifiesAsCandidate };
  });

  // Only consider candidates that already pass the market_quality / edge / EV
  // gates. Threshold sweep operates on the surfaced cohort, not the universe.
  const surfaced = graded.filter((g) => g.qualifiesAsCandidate);

  // Production defaults (TIER_THRESHOLDS = { A: 0.65, B: 0.50, C: 0.35 }).
  // Sweep Tier A across a grid; B/C unchanged so we measure pure Tier-A
  // tightening, not whole-system retuning.
  const tierAGrid = [0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95];
  const TIER_B = TIER_THRESHOLDS.B; // 0.50
  const TIER_C = TIER_THRESHOLDS.C; // 0.35

  // Baseline Tier B and C metrics use the production thresholds and
  // ignore whatever Tier A cutoff is being tested (so they're a fixed
  // reference point across all rows).
  const baselineTierB = surfaced.filter((g) => g.c.rankScore >= TIER_B && g.c.rankScore < 0.65);
  const baselineTierC = surfaced.filter((g) => g.c.rankScore >= TIER_C && g.c.rankScore < TIER_B);
  const tierBMetrics = computeTierMetrics(baselineTierB);
  const tierCMetrics = computeTierMetrics(baselineTierC);

  // Per-threshold Tier A bucket.
  const sweepRows = tierAGrid.map((tA) => {
    const tierAItems = surfaced.filter((g) => g.c.rankScore >= tA);
    const tierAMetrics = computeTierMetrics(tierAItems);
    return { threshold: tA, metrics: tierAMetrics };
  });

  // Output: human report + JSON.
  const fmt = (n: number, d = 4) => Number.isFinite(n) ? n.toFixed(d) : "n/a";
  const fpct = (n: number) => (n * 100).toFixed(1) + "%";
  const lines: string[] = [];
  lines.push("=".repeat(110));
  lines.push("SportsMVP — NFL Spread v2.1 Tier-A Threshold Sweep (offline research, NO DEPLOY)");
  lines.push("=".repeat(110));
  lines.push(`generated: ${new Date().toISOString()}`);
  lines.push(`window:    ${start} .. ${end}    games: ${snapshots.length}`);
  lines.push("");
  lines.push("CAVEAT: Read-only sensitivity sweep on top of v2.1. Model code, constants,");
  lines.push("calibration, gate, cron, and routes are all UNCHANGED. Tier B and Tier C use");
  lines.push("production thresholds (0.50 / 0.35) as fixed reference points so the sweep");
  lines.push("isolates Tier-A tightening only. NFL spread remains MARKET_DISABLED.");
  lines.push("");
  lines.push("-".repeat(110));
  lines.push("UNIVERSE");
  lines.push("-".repeat(110));
  lines.push(`gamesEvaluated=${snapshots.length}  totalCandidates=${graded.length}  passEdgeMQEVGates=${surfaced.length}`);
  lines.push(`current Tier A threshold (production) for nfl_spread: ${TIER_THRESHOLDS.A.toFixed(2)} (no override)`);
  lines.push("");
  lines.push("-".repeat(110));
  lines.push("FIXED-REFERENCE TIER B / TIER C (production thresholds, same across all rows)");
  lines.push("-".repeat(110));
  lines.push(
    `Tier B [0.50,0.65)  n=${tierBMetrics.n}  resolved=${tierBMetrics.resolvedN}  ` +
    `w-l-p=${tierBMetrics.wins}-${tierBMetrics.losses}-${tierBMetrics.pushes}  ` +
    `winRate=${fpct(tierBMetrics.winRate)}  ROI=${fpct(tierBMetrics.roi)}  brier=${fmt(tierBMetrics.brier)}`
  );
  lines.push(
    `Tier C [0.35,0.50)  n=${tierCMetrics.n}  resolved=${tierCMetrics.resolvedN}  ` +
    `w-l-p=${tierCMetrics.wins}-${tierCMetrics.losses}-${tierCMetrics.pushes}  ` +
    `winRate=${fpct(tierCMetrics.winRate)}  ROI=${fpct(tierCMetrics.roi)}  brier=${fmt(tierCMetrics.brier)}`
  );
  lines.push("");
  lines.push("-".repeat(110));
  lines.push("TIER A SWEEP — vary Tier A rank-score threshold only");
  lines.push("-".repeat(110));
  lines.push("threshold   n   resolved   w-l-p       winRate   units    ROI       brier    meanModelProb   beats Tier B?");
  for (const row of sweepRows) {
    const m = row.metrics;
    const beatsB =
      m.n >= 10 &&
      m.roi > tierBMetrics.roi &&
      m.winRate > tierBMetrics.winRate &&
      m.brier <= tierBMetrics.brier
        ? "YES"
        : m.n < 10
          ? "n/a (n<10)"
          : "no";
    lines.push(
      `${row.threshold.toFixed(2).padEnd(11)} ` +
      `${String(m.n).padStart(3)} ` +
      `${String(m.resolvedN).padStart(8)} ` +
      `${`${m.wins}-${m.losses}-${m.pushes}`.padEnd(11)} ` +
      `${fpct(m.winRate).padStart(7)}   ` +
      `${m.units.toFixed(2).padStart(7)} ` +
      `${fpct(m.roi).padStart(8)}   ` +
      `${fmt(m.brier).padStart(6)}   ` +
      `${fmt(m.meanModelProb).padStart(13)}   ` +
      `${beatsB}`
    );
  }
  lines.push("");
  lines.push("-".repeat(110));
  lines.push("INTERPRETATION HINTS");
  lines.push("-".repeat(110));
  lines.push("- 'beats Tier B?' requires: n>=10, higher winRate, higher ROI, AND lower-or-equal Brier than Tier B.");
  lines.push("- 'clearly defensible' would additionally require: ROI > 0, winRate > 52.4% (breakeven at -110), n large enough to matter.");
  lines.push("- A row where n collapses below ~15 is informationally weak regardless of headline numbers.");
  lines.push("");
  lines.push("=".repeat(110));
  lines.push("JSON document follows on next line");
  lines.push("=".repeat(110));
  console.log(lines.join("\n"));

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      league: "nfl",
      market: "spread",
      modelVersion: "v2.1",
      mode: "offline-tier-threshold-sweep",
      window: { start, end },
      gameCount: snapshots.length,
      caveat:
        "Read-only sensitivity sweep on top of v2.1. Model, constants, calibration, " +
        "gate, cron, and routes UNCHANGED. NFL spread remains MARKET_DISABLED. Tier B " +
        "and Tier C use production thresholds (0.50 / 0.35) as fixed reference points.",
    },
    universe: {
      totalCandidates: graded.length,
      surfaced: surfaced.length,
      currentProductionTierAThreshold: TIER_THRESHOLDS.A,
    },
    tierBReference: tierBMetrics,
    tierCReference: tierCMetrics,
    sweep: sweepRows,
  };
  console.log(JSON.stringify(report, null, 2));
}

import { fileURLToPath } from "node:url";
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error("nflTierThresholdSweep failed:", err);
    process.exit(1);
  });
}
