/**
 * Football Backtest Report — internal evaluation of NFL or NCAAF spread
 * model v1 against historical game_snapshots that have been ingested
 * via the historical-ingest service.
 *
 * Scope:
 *  - Reads game_snapshots for the requested league + date window.
 *  - Runs scorePicks(["spread"], ...) directly — this fires the real
 *    nfl/ncaaf spread model, calibration, edge, EV, marketQuality.
 *  - Bypasses MARKET_DISABLED for tier-assignment ONLY (the gate stays
 *    on in production paths; this report computes a shadow tier as if
 *    the gate were lifted, so we can answer "would v1 surface
 *    anything useful if we flipped the switch?" without flipping it).
 *  - Grades each candidate against snapshot home/away score.
 *  - Emits the full metric suite the eval spec asks for.
 *  - Read-only: NO writes to the DB. NO public route exposure. NO
 *    cron change. NO production behavior change.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx \
 *     src/footballBacktestReport.ts --league nfl \
 *     [--start 2025-09-01] [--end 2026-02-10] [--json-only]
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
  TIER_A_THRESHOLD_OVERRIDE,
  MIN_EDGE_TO_CANDIDATE,
  MIN_EV_TO_CANDIDATE,
  MARKET_MIN_EDGE,
  SPREAD_LINE_ABS_MAX,
  type League,
} from "../../artifacts/api-server/src/config/scoringModelConfig";
import {
  NCAAF_TEAM_ABBREVS,
  NCAAF_TEAM_ALIASES,
} from "../../artifacts/api-server/src/lib/teamAbbreviations";

interface Args {
  league: League;
  start?: string;
  end?: string;
  jsonOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { jsonOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === "--league") out.league = next() as League;
    else if (a === "--start") out.start = next();
    else if (a === "--end") out.end = next();
    else if (a === "--json-only") out.jsonOnly = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: footballBacktestReport --league nfl|ncaaf [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--json-only]");
      process.exit(0);
    } else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.league) throw new Error("--league is required (nfl or ncaaf)");
  return out as Args;
}

/**
 * Compute the tier we WOULD assign if MARKET_DISABLED weren't blocking
 * this market. Mirrors assignTier exactly minus the disabled-key check
 * and minus the odds-range guardrail (which is opt-in per route and
 * unused on backtest paths). Kept inline so the production assignTier
 * is not modified for the backtest's benefit.
 */
export function shadowAssignTier(c: CandidateOutput, rankScore: number): {
  tier: "A" | "B" | "C" | "PASS";
  selectionReason: string;
} {
  if (c.marketQuality < 0.3) return { tier: "PASS", selectionReason: "market_quality_too_low" };
  const marketKey = `${c.league}_${c.marketType}`;
  const minEdge = MARKET_MIN_EDGE[marketKey] ?? MIN_EDGE_TO_CANDIDATE;
  if (c.edge < minEdge) return { tier: "PASS", selectionReason: "insufficient_edge" };
  if (c.ev < MIN_EV_TO_CANDIDATE) return { tier: "PASS", selectionReason: "negative_ev" };
  const tierA = TIER_A_THRESHOLD_OVERRIDE[marketKey] ?? TIER_THRESHOLDS.A;
  if (rankScore >= tierA) return { tier: "A", selectionReason: "high_rank_score" };
  if (rankScore >= TIER_THRESHOLDS.B) return { tier: "B", selectionReason: "medium_rank_score" };
  if (rankScore >= TIER_THRESHOLDS.C) return { tier: "C", selectionReason: "low_rank_score" };
  return { tier: "PASS", selectionReason: "rank_score_below_threshold" };
}

export function pct(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo);
}

interface GradedCandidate {
  c: CandidateOutput;
  shadowTier: "A" | "B" | "C" | "PASS";
  shadowReason: string;
  result: "win" | "loss" | "push" | "pending";
  homeSpreadAbs: number;
}

interface NormalizationAudit {
  totalUniqueTeams: number;
  exactMatches: number;
  aliasMatches: number;
  fuzzyFallbacks: number;
  fuzzyTeams: string[];
}

export function auditNcaafNormalization(snapshots: { homeTeam: string; awayTeam: string }[]): NormalizationAudit {
  const teams = new Set<string>();
  for (const s of snapshots) {
    teams.add(s.homeTeam);
    teams.add(s.awayTeam);
  }
  let exact = 0;
  let alias = 0;
  let fuzzy = 0;
  const fuzzyTeams: string[] = [];
  for (const t of teams) {
    const trimmed = t.trim();
    if (NCAAF_TEAM_ABBREVS[trimmed]) {
      exact++;
    } else {
      const aliased = NCAAF_TEAM_ALIASES[trimmed];
      if (aliased && NCAAF_TEAM_ABBREVS[aliased]) {
        alias++;
      } else {
        fuzzy++;
        fuzzyTeams.push(t);
      }
    }
  }
  return { totalUniqueTeams: teams.size, exactMatches: exact, aliasMatches: alias, fuzzyFallbacks: fuzzy, fuzzyTeams: fuzzyTeams.slice(0, 50) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const filters = [
    eq(gameSnapshotsTable.league, args.league),
    isNotNull(gameSnapshotsTable.homeScore),
    isNotNull(gameSnapshotsTable.publishSpread),
  ];
  if (args.start) filters.push(gte(gameSnapshotsTable.snapshotDate, args.start));
  if (args.end) filters.push(lte(gameSnapshotsTable.snapshotDate, args.end));

  const snapshots = await db.select().from(gameSnapshotsTable).where(and(...filters));

  if (snapshots.length === 0) {
    const empty = {
      meta: {
        generatedAt: new Date().toISOString(),
        league: args.league,
        window: { start: args.start ?? null, end: args.end ?? null },
        gameCount: 0,
        message: "No game_snapshots with both publish_spread and final score found for this window. Run historical-ingest first.",
      },
    };
    if (!args.jsonOnly) console.log(JSON.stringify(empty, null, 2));
    else console.log(JSON.stringify(empty));
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

  // Run scorePicks for spread market only. The candidates come back
  // with tier=PASS / selectionReason="market_disabled" because of the
  // production gate, but model_prob / edge / EV / rankScore / marketQuality
  // are FAITHFUL — they come from the real model, before the gate fires.
  const candidates = await scorePicks(inputs, ["spread"], "v1");

  // Re-derive tiers without the gate so we can answer "would this
  // surface anything if the gate were off?".
  const inputBySnap = new Map(snapshots.map((s) => [s.gameKey, s] as const));
  const graded: GradedCandidate[] = candidates.map((c) => {
    const snap = inputBySnap.get(c.gameKey);
    const shadow = shadowAssignTier(c, c.rankScore);
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
    const hSpread = snap?.publishSpread != null ? Math.abs(parseFloat(String(snap.publishSpread))) : 0;
    return { c, shadowTier: shadow.tier, shadowReason: shadow.selectionReason, result, homeSpreadAbs: hSpread };
  });

  const surfaced = graded.filter((g) => g.shadowTier !== "PASS");
  const resolvedAll = graded.filter((g) => g.result !== "pending");
  const resolvedSurfaced = surfaced.filter((g) => g.result !== "pending");

  const passCount = graded.length - surfaced.length;
  const passRate = graded.length > 0 ? passCount / graded.length : 0;
  const conversionRate = graded.length > 0 ? surfaced.length / graded.length : 0;

  const wins = resolvedSurfaced.filter((g) => g.result === "win").length;
  const losses = resolvedSurfaced.filter((g) => g.result === "loss").length;
  const pushes = resolvedSurfaced.filter((g) => g.result === "push").length;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
  let unitsWon = 0;
  for (const g of resolvedSurfaced) {
    if (g.result === "win") unitsWon += americanToDecimal(g.c.publishOdds) - 1;
    else if (g.result === "loss") unitsWon -= 1;
  }
  const roi = resolvedSurfaced.length > 0 ? unitsWon / resolvedSurfaced.length : 0;

  const allCands = graded.map((g) => g.c);
  const avgImpliedProb = allCands.length > 0 ? allCands.reduce((s, c) => s + americanToImplied(c.publishOdds), 0) / allCands.length : 0;
  const avgModelProb = allCands.length > 0 ? allCands.reduce((s, c) => s + c.modelProbCalibrated, 0) / allCands.length : 0;
  const avgEdge = allCands.length > 0 ? allCands.reduce((s, c) => s + c.edge, 0) / allCands.length : 0;
  const avgEv = allCands.length > 0 ? allCands.reduce((s, c) => s + c.ev, 0) / allCands.length : 0;

  // Brier + log loss: on resolved binary outcomes only (push excluded).
  const binary = resolvedAll.filter((g) => g.result === "win" || g.result === "loss");
  let brierSum = 0;
  let logLossSum = 0;
  for (const g of binary) {
    const y = g.result === "win" ? 1 : 0;
    const p = Math.max(1e-6, Math.min(1 - 1e-6, g.c.modelProbCalibrated));
    brierSum += (p - y) ** 2;
    logLossSum -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  const brierScore = binary.length > 0 ? brierSum / binary.length : 0;
  const logLoss = binary.length > 0 ? logLossSum / binary.length : 0;

  // Calibration buckets: model_prob bucket → realized win rate (binary only).
  const calibEdges = [0, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 1.0];
  const calibration: Array<{
    rangeLow: number; rangeHigh: number; n: number; resolvedN: number;
    meanModelProb: number; meanImpliedProb: number; realizedWinRate: number;
  }> = [];
  for (let i = 0; i < calibEdges.length - 1; i++) {
    const lo = calibEdges[i];
    const hi = calibEdges[i + 1];
    const isLast = i === calibEdges.length - 2;
    const inBucket = graded.filter((g) =>
      isLast
        ? g.c.modelProbCalibrated >= lo && g.c.modelProbCalibrated <= hi
        : g.c.modelProbCalibrated >= lo && g.c.modelProbCalibrated < hi
    );
    const res = inBucket.filter((g) => g.result === "win" || g.result === "loss");
    const w = res.filter((g) => g.result === "win").length;
    calibration.push({
      rangeLow: lo, rangeHigh: hi, n: inBucket.length, resolvedN: res.length,
      meanModelProb: inBucket.length > 0 ? inBucket.reduce((s, g) => s + g.c.modelProbCalibrated, 0) / inBucket.length : 0,
      meanImpliedProb: inBucket.length > 0 ? inBucket.reduce((s, g) => s + americanToImplied(g.c.publishOdds), 0) / inBucket.length : 0,
      realizedWinRate: res.length > 0 ? w / res.length : 0,
    });
  }

  // Tier breakdown (shadow).
  const tierCounts = { A: 0, B: 0, C: 0, PASS: 0 };
  for (const g of graded) tierCounts[g.shadowTier]++;

  // Per-shadow-tier ROI/winrate.
  const tierMetrics = ["A", "B", "C"].map((t) => {
    const subset = surfaced.filter((g) => g.shadowTier === t);
    const resolved = subset.filter((g) => g.result !== "pending");
    const w = resolved.filter((g) => g.result === "win").length;
    const l = resolved.filter((g) => g.result === "loss").length;
    const p = resolved.filter((g) => g.result === "push").length;
    let u = 0;
    for (const g of resolved) {
      if (g.result === "win") u += americanToDecimal(g.c.publishOdds) - 1;
      else if (g.result === "loss") u -= 1;
    }
    return {
      tier: t,
      n: subset.length,
      resolved: resolved.length,
      wins: w, losses: l, pushes: p,
      winRate: w + l > 0 ? w / (w + l) : 0,
      units: u,
      roi: resolved.length > 0 ? u / resolved.length : 0,
    };
  });

  // Pass-reason histogram.
  const reasonCounts: Record<string, number> = {};
  for (const g of graded) {
    if (g.shadowTier === "PASS") reasonCounts[g.shadowReason] = (reasonCounts[g.shadowReason] ?? 0) + 1;
  }

  // Edge distribution.
  const edges = allCands.map((c) => c.edge);
  const edgeDist = edges.length > 0 ? {
    n: edges.length,
    min: Math.min(...edges),
    p25: pct(edges, 0.25),
    p50: pct(edges, 0.5),
    p75: pct(edges, 0.75),
    p90: pct(edges, 0.9),
    p95: pct(edges, 0.95),
    p99: pct(edges, 0.99),
    max: Math.max(...edges),
  } : { n: 0, min: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, max: 0 };

  // Red flags.
  const lineCap = SPREAD_LINE_ABS_MAX[args.league] ?? Infinity;
  const redFlags = {
    extremeEdgeCandidates: allCands.filter((c) => Math.abs(c.edge) > 0.20).length,
    impossibleProb: allCands.filter((c) => c.modelProbCalibrated <= 0 || c.modelProbCalibrated >= 1).length,
    spreadOverCap: graded.filter((g) => g.homeSpreadAbs > lineCap).length,
    marketQualityBlocked: Object.entries(reasonCounts).find(([k]) => k === "market_quality_too_low")?.[1] ?? 0,
    insufficientEdgeBlocked: Object.entries(reasonCounts).find(([k]) => k === "insufficient_edge")?.[1] ?? 0,
    negativeEvBlocked: Object.entries(reasonCounts).find(([k]) => k === "negative_ev")?.[1] ?? 0,
  };

  // Normalization audit (NCAAF only — pro leagues use legacy maps).
  const normalization: NormalizationAudit | null =
    args.league === "ncaaf" ? auditNcaafNormalization(snapshots) : null;

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      league: args.league,
      market: "spread",
      mode: "internal-backtest",
      window: { start: args.start ?? null, end: args.end ?? null },
      gameCount: snapshots.length,
      caveat:
        `Internal evaluation. ${args.league.toUpperCase()} spread is gated via MARKET_DISABLED.${args.league}_spread=true ` +
        `and ${args.league} is NOT in cron LEAGUES. Tier counts in this report use a SHADOW tier ` +
        `(MARKET_DISABLED check stripped) so we can answer 'would v1 surface anything if the gate were off?' ` +
        `without flipping it. Production behavior is unchanged.`,
    },
    counts: {
      gamesEvaluated: snapshots.length,
      candidatesTotal: graded.length,
      surfaced: surfaced.length,
      passCount,
      passRate,
      candidateToSurfacedConversion: conversionRate,
      resolved: resolvedAll.length,
      resolvedSurfaced: resolvedSurfaced.length,
    },
    surfacedSettlement: {
      wins, losses, pushes, winRate, unitsWon, roi,
    },
    candidateAggregates: {
      avgImpliedProb, avgModelProb, avgEdge, avgEv,
    },
    calibrationGoodness: {
      brierScore, logLoss,
      calibrationBuckets: calibration,
    },
    tierBreakdown: { counts: tierCounts, perTier: tierMetrics },
    edgeDistribution: edgeDist,
    redFlags,
    blockedReasonCounts: reasonCounts,
    normalization,
  };

  if (!args.jsonOnly) {
    const fmt = (n: number, d = 4) => Number.isFinite(n) ? n.toFixed(d) : "n/a";
    const fpct = (n: number) => (n * 100).toFixed(1) + "%";
    const lines: string[] = [];
    lines.push("=".repeat(110));
    lines.push(`SportsMVP — ${args.league.toUpperCase()} Spread Backtest Report (internal-only, NO DEPLOY)`);
    lines.push("=".repeat(110));
    lines.push(`generated: ${report.meta.generatedAt}`);
    lines.push(`window:    ${args.start ?? "(open)"} .. ${args.end ?? "(open)"}    games: ${snapshots.length}`);
    lines.push("");
    lines.push("CAVEAT: " + report.meta.caveat);
    lines.push("");
    lines.push("-".repeat(110));
    lines.push("COUNTS");
    lines.push("-".repeat(110));
    lines.push(`gamesEvaluated=${report.counts.gamesEvaluated}  candidates=${report.counts.candidatesTotal}  surfaced=${report.counts.surfaced}`);
    lines.push(`passCount=${report.counts.passCount}  passRate=${fpct(report.counts.passRate)}  candidate→surfaced=${fpct(report.counts.candidateToSurfacedConversion)}`);
    lines.push(`resolved=${report.counts.resolved}  resolvedSurfaced=${report.counts.resolvedSurfaced}`);
    lines.push("");
    const ss = report.surfacedSettlement;
    lines.push("-".repeat(110));
    lines.push("SURFACED-SUBSET SETTLEMENT");
    lines.push("-".repeat(110));
    lines.push(`w-l-p=${ss.wins}-${ss.losses}-${ss.pushes}  winRate=${fpct(ss.winRate)}  units=${ss.unitsWon.toFixed(2)}  ROI=${fpct(ss.roi)}`);
    lines.push("");
    const ca = report.candidateAggregates;
    lines.push("-".repeat(110));
    lines.push("CANDIDATE-LEVEL AGGREGATES");
    lines.push("-".repeat(110));
    lines.push(`avgImpliedProb=${fmt(ca.avgImpliedProb)}  avgModelProb=${fmt(ca.avgModelProb)}  avgEdge=${fmt(ca.avgEdge)}  avgEV=${fmt(ca.avgEv)}`);
    lines.push("");
    const cg = report.calibrationGoodness;
    lines.push("-".repeat(110));
    lines.push("CALIBRATION (binary-resolved candidates only; pushes excluded)");
    lines.push("-".repeat(110));
    lines.push(`brierScore=${fmt(cg.brierScore)}  logLoss=${fmt(cg.logLoss)}`);
    for (const b of cg.calibrationBuckets) {
      lines.push(
        `  [${b.rangeLow.toFixed(2)},${b.rangeHigh.toFixed(2)})  n=${b.n}  resolved=${b.resolvedN}  ` +
        `meanModel=${fmt(b.meanModelProb)}  meanImplied=${fmt(b.meanImpliedProb)}  realized=${fpct(b.realizedWinRate)}`
      );
    }
    lines.push("");
    lines.push("-".repeat(110));
    lines.push("SHADOW TIER BREAKDOWN (MARKET_DISABLED stripped)");
    lines.push("-".repeat(110));
    lines.push(`A=${tierCounts.A}  B=${tierCounts.B}  C=${tierCounts.C}  PASS=${tierCounts.PASS}`);
    for (const t of report.tierBreakdown.perTier) {
      lines.push(`  Tier ${t.tier}:  n=${t.n}  resolved=${t.resolved}  w-l-p=${t.wins}-${t.losses}-${t.pushes}  winRate=${fpct(t.winRate)}  units=${t.units.toFixed(2)}  ROI=${fpct(t.roi)}`);
    }
    lines.push("");
    const ed = report.edgeDistribution;
    lines.push("-".repeat(110));
    lines.push("EDGE DISTRIBUTION (all candidates)");
    lines.push("-".repeat(110));
    lines.push(`n=${ed.n}  min=${fmt(ed.min)}  p25=${fmt(ed.p25)}  p50=${fmt(ed.p50)}  p75=${fmt(ed.p75)}  p90=${fmt(ed.p90)}  p95=${fmt(ed.p95)}  p99=${fmt(ed.p99)}  max=${fmt(ed.max)}`);
    lines.push("");
    lines.push("-".repeat(110));
    lines.push("RED FLAGS");
    lines.push("-".repeat(110));
    for (const [k, v] of Object.entries(report.redFlags)) lines.push(`  ${k.padEnd(28)} ${v}`);
    lines.push("");
    lines.push("-".repeat(110));
    lines.push("BLOCKED-REASON COUNTS (shadow tier == PASS)");
    lines.push("-".repeat(110));
    for (const [k, v] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${k.padEnd(28)} ${v}`);
    }
    lines.push("");
    if (normalization) {
      lines.push("-".repeat(110));
      lines.push("NORMALIZATION AUDIT (NCAAF only)");
      lines.push("-".repeat(110));
      lines.push(`uniqueTeams=${normalization.totalUniqueTeams}  exact=${normalization.exactMatches}  alias=${normalization.aliasMatches}  fuzzy=${normalization.fuzzyFallbacks}`);
      if (normalization.fuzzyTeams.length > 0) {
        lines.push("  fuzzy fallback teams (add to NCAAF_TEAM_ABBREVS or _ALIASES):");
        for (const t of normalization.fuzzyTeams) lines.push(`    - ${t}`);
      }
      lines.push("");
    }
    lines.push("=".repeat(110));
    lines.push("JSON document follows on next line");
    lines.push("=".repeat(110));
    console.log(lines.join("\n"));
  }
  console.log(JSON.stringify(report, null, 2));
}

import { fileURLToPath } from "node:url";
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error("footballBacktestReport failed:", err);
    process.exit(1);
  });
}
