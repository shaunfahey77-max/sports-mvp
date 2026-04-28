/**
 * Read-only gate-change validation harness.
 *
 * Replays `assignTier` + the watch-only post-processing step against a
 * frozen window of `candidate_bets` rows, with the production gates
 * (MARKET_DISABLED, MARKET_MODEL_WATCH_ONLY, MARKET_MIN_EDGE, etc.)
 * overridden in-memory by a named proposal (e.g. "R1"). Emits a JSON
 * report comparing baseline vs proposed surfacing, with realized win
 * rate and realized CLV attached for every newly-surfaced candidate.
 *
 * Usage:
 *   tsx src/scripts/validateGateChange.ts --proposal=R1
 *   tsx src/scripts/validateGateChange.ts --proposal=R2
 *   tsx src/scripts/validateGateChange.ts --proposal=R1 --window-start=2026-03-12 --window-end=2026-04-27
 *
 * Proposal "R2" demonstrates the in-memory sigmoidA override path: the proposed
 * sigmoidA value is applied to model_prob_raw via the production calibration
 * formula, edge/EV/rank_score are recomputed against market_prob_fair and
 * publish_odds (also production formulas), then the gate-replay runs as
 * normal. No DB write, no live config touch.
 *
 * STRICTLY READ-ONLY:
 *   - No INSERT / UPDATE / DELETE on any table.
 *   - The real scoringModelConfig is imported only for baseline reference;
 *     the in-memory override map is applied via the local `replayAssignTier`
 *     function. Nothing mutates the imported constants.
 *   - DB queries are SELECT-only.
 *
 * Output:
 *   .local/validation_dryruns/<UTC-ISO-timestamp>_<proposal>.json
 *
 * Frozen window:
 *   Default 2026-03-12 → 2026-04-27 (matches the close-odds backfill scope
 *   so realized CLV is recoverable on every row that has snapshot close
 *   data). Don't shrink without re-running the backfill.
 */

import { db } from "@workspace/db";
import { candidateBetsTable, gameSnapshotsTable } from "@workspace/db";
import { and, gte, inArray, lt, sql } from "drizzle-orm";
import {
  MARKET_DISABLED,
  MARKET_MODEL_WATCH_ONLY,
  MARKET_MIN_EDGE,
  MIN_EDGE_TO_CANDIDATE,
  MIN_EV_TO_CANDIDATE,
  TIER_THRESHOLDS,
  TIER_A_THRESHOLD_OVERRIDE,
  DEFAULT_ODDS_RANGE,
  ODDS_RANGE_OVERRIDE,
  ODDS_RANGE_GUARDRAIL_LEAGUES,
  RANK_WEIGHTS,
  MAX_EV_CAP,
  MAX_EDGE_CAP,
} from "../config/scoringModelConfig";
import { computeOutcomeResult } from "../scoring/validatePicks";
import { computeClvWritebackValues } from "../scoring/clvWriteback";
import {
  calibrateProb,
  getCalibrationParams,
  getCalibrationConfidence,
} from "../scoring/calibration";
import { computeEdge, computeEV } from "../scoring/expectedValue";
import * as fs from "node:fs";
import * as path from "node:path";

type Tier = "A" | "B" | "C" | "PASS";

interface Args {
  proposal: string;
  windowStart: string;
  windowEnd: string;
}

function parseArgs(): Args {
  const args: Args = {
    proposal: "",
    windowStart: "2026-03-12",
    windowEnd: "2026-04-27",
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--proposal=")) args.proposal = a.slice("--proposal=".length);
    else if (a.startsWith("--window-start=")) args.windowStart = a.slice("--window-start=".length);
    else if (a.startsWith("--window-end=")) args.windowEnd = a.slice("--window-end=".length);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx src/scripts/validateGateChange.ts --proposal=R1|R2 [--window-start=YYYY-MM-DD] [--window-end=YYYY-MM-DD]"
      );
      process.exit(0);
    }
  }
  if (!args.proposal) {
    console.error("ERROR: --proposal is required (e.g. --proposal=R1)");
    process.exit(2);
  }
  return args;
}

interface GateConfig {
  marketDisabled: Record<string, boolean>;
  marketWatchOnly: Record<string, boolean>;
  marketMinEdge: Record<string, number>;
  tierAOverride: Record<string, number>;
  /**
   * In-memory sigmoidA override per `${league}_${marketType}` key. When a key
   * has an entry here AND the production calibration method for that market
   * is "sigmoid", the replay recomputes calibrated_prob → edge → ev →
   * rank_score from `model_prob_raw` using the override value (other params
   * inherit from production). Markets without an entry use the persisted
   * edge/ev/rank_score values directly.
   */
  sigmoidAOverride: Record<string, number>;
}

function baselineConfig(): GateConfig {
  return {
    marketDisabled: { ...(MARKET_DISABLED as Record<string, boolean>) },
    marketWatchOnly: { ...(MARKET_MODEL_WATCH_ONLY as Record<string, boolean>) },
    marketMinEdge: { ...(MARKET_MIN_EDGE as Record<string, number>) },
    tierAOverride: { ...(TIER_A_THRESHOLD_OVERRIDE as Record<string, number>) },
    sigmoidAOverride: {},
  };
}

/**
 * Apply a named proposal on top of baseline. Returns a NEW config object;
 * baseline is not mutated.
 */
function applyProposal(name: string, base: GateConfig): GateConfig {
  const cfg: GateConfig = {
    marketDisabled: { ...base.marketDisabled },
    marketWatchOnly: { ...base.marketWatchOnly },
    marketMinEdge: { ...base.marketMinEdge },
    tierAOverride: { ...base.tierAOverride },
    sigmoidAOverride: { ...base.sigmoidAOverride },
  };
  switch (name) {
    case "R1":
      // NHL total: lift from MARKET_DISABLED → place in MARKET_MODEL_WATCH_ONLY.
      cfg.marketDisabled.nhl_total = false;
      cfg.marketWatchOnly.nhl_total = true;
      break;
    case "R2":
      // NBA spread, staged recovery (Watch only, no Official):
      //   1. Partial sigmoidA recovery: 0.85 → 0.92 (loosens compression
      //      toward 0.5, lifting calibrated probabilities — and therefore
      //      edge / EV / rank_score — back toward the un-shrunk model
      //      output without fully reverting the post-fix correction).
      //   2. Lift gate: MARKET_DISABLED → MARKET_MODEL_WATCH_ONLY.
      // MARKET_MIN_EDGE.nba_spread (0.05) and TIER_A_THRESHOLD_OVERRIDE
      // .nba_spread (0.95) are intentionally unchanged — this is the
      // smallest staged change that exercises both pieces of the recovery.
      cfg.sigmoidAOverride.nba_spread = 0.92;
      cfg.marketDisabled.nba_spread = false;
      cfg.marketWatchOnly.nba_spread = true;
      break;
    default:
      console.error(`ERROR: unknown proposal '${name}' (supported: R1, R2)`);
      process.exit(2);
  }
  return cfg;
}

interface CandidateForReplay {
  league: string;
  marketType: string;
  side: string;
  publishOdds: number;
  publishLine: number | null;
  edge: number;
  ev: number;
  rankScore: number;
  marketQuality: number;
  /** Raw model probability persisted on candidate_bets — input to recompute under sigmoidA override. */
  modelProbRaw: number;
  /** Fair market probability persisted on candidate_bets — second input to edge recompute. */
  marketProbFair: number;
}

interface ReplayOutcome {
  /** Tier returned by assignTier-equivalent logic (BEFORE watch-only override). */
  rawTier: Tier;
  /** Reason from the risk-controls / tier band assignment. */
  rawReason: string | null;
  /** Final tier after watch-only post-processing. */
  finalTier: Tier;
  /** Final selection reason (may be 'model_watch_only' even when raw tier was A/B/C). */
  finalReason: string | null;
  /**
   * True iff this candidate would appear on a user-facing surface
   * (Official picks OR Model Watch). I.e. raw tier is A/B/C, regardless
   * of whether the watch-only overlay forced final tier to PASS.
   */
  surfaced: boolean;
  /**
   * True iff this candidate would appear on the OFFICIAL surface
   * (raw tier is A/B/C AND market is NOT in watch-only).
   */
  officialSurfaced: boolean;
  /**
   * Edge / EV / rank_score values actually used by the gate logic for this
   * outcome. These equal the persisted values for proposals that do NOT
   * touch calibration (e.g. R1). For sigmoidA-override proposals (e.g. R2)
   * they are the recomputed values from applySigmoidOverride.
   */
  effectiveEdge: number;
  effectiveEv: number;
  effectiveRankScore: number;
}

/**
 * Apply a sigmoidA override (if configured for the candidate's market) by
 * recomputing calibrated_prob → edge → ev → rank_score from model_prob_raw,
 * using the production calibration / EV / rank formulas verbatim. Returns a
 * NEW candidate object with the recomputed fields; the input is not mutated.
 *
 * Returns the original candidate unchanged if:
 *   - no override is configured for this market, OR
 *   - production calibration method for this market is not "sigmoid"
 *     (sigmoidA only meaningful for sigmoid; isotonic/none are silently
 *     no-op'd to keep the harness safe to point at any market).
 *
 * NOTE: market_quality is taken as-persisted (it is a market-microstructure
 * signal that does NOT depend on calibration). calibration_confidence is
 * recomputed via getCalibrationConfidence(league, market, model_prob_raw)
 * but is in practice unchanged under a sigmoidA-only swap (it depends on
 * model_prob_raw, not on the calibrated value).
 */
function applySigmoidOverride(c: CandidateForReplay, cfg: GateConfig): CandidateForReplay {
  const marketKey = `${c.league}_${c.marketType}`;
  const overrideA = cfg.sigmoidAOverride[marketKey];
  if (overrideA == null) return c;
  const baseParams = getCalibrationParams(c.league, c.marketType);
  if (baseParams.method !== "sigmoid") return c;

  const overrideParams = { ...baseParams, sigmoidA: overrideA };
  const newCalibrated = calibrateProb(c.modelProbRaw, overrideParams);
  const newEdge = computeEdge(newCalibrated, c.marketProbFair);
  // Mirror production parity: scorePicks.ts:198/252/314 caps EV at MAX_EV_CAP
  // before persistence, so the recompute must do the same to be a faithful
  // replay (matters for `effectiveEv` reporting; rank normalization already
  // saturates at the cap so tier outcomes are unaffected either way).
  const newEv = Math.min(MAX_EV_CAP, computeEV(newCalibrated, c.publishOdds));
  const calibConfidence = getCalibrationConfidence(c.league, c.marketType, c.modelProbRaw);
  const normEv = newEv > 0 ? Math.min(1, newEv / MAX_EV_CAP) : 0;
  const normEdge = newEdge > 0 ? Math.min(1, newEdge / MAX_EDGE_CAP) : 0;
  const newRank =
    RANK_WEIGHTS.ev * normEv +
    RANK_WEIGHTS.edge * normEdge +
    RANK_WEIGHTS.calibrationConfidence * calibConfidence +
    RANK_WEIGHTS.marketLiquidityConfidence * c.marketQuality;

  return { ...c, edge: newEdge, ev: newEv, rankScore: newRank };
}

function replayAssignTier(c0: CandidateForReplay, cfg: GateConfig): ReplayOutcome {
  const c = applySigmoidOverride(c0, cfg);
  const marketKey = `${c.league}_${c.marketType}`;
  const guardrailEnabled = (ODDS_RANGE_GUARDRAIL_LEAGUES as readonly string[]).includes(c.league);

  // ---- applyRiskControls (mirrors assignTiers.ts:35) ----
  // 1. Odds-range guardrail.
  if (guardrailEnabled && Number.isFinite(c.publishOdds)) {
    const range = ODDS_RANGE_OVERRIDE[marketKey] ?? DEFAULT_ODDS_RANGE;
    if (c.publishOdds < range.min || c.publishOdds > range.max) {
      return {
        rawTier: "PASS",
        rawReason: "odds_out_of_range",
        finalTier: "PASS",
        finalReason: "odds_out_of_range",
        surfaced: false,
        officialSurfaced: false,
        effectiveEdge: c.edge,
        effectiveEv: c.ev,
        effectiveRankScore: c.rankScore,
      };
    }
  }
  // 2. MARKET_DISABLED.
  if (cfg.marketDisabled[marketKey]) {
    return {
      rawTier: "PASS",
      rawReason: "market_disabled",
      finalTier: "PASS",
      finalReason: "market_disabled",
      surfaced: false,
      officialSurfaced: false,
      effectiveEdge: c.edge,
      effectiveEv: c.ev,
      effectiveRankScore: c.rankScore,
    };
  }
  // 3. market_quality_too_low.
  if (c.marketQuality < 0.3) {
    return {
      rawTier: "PASS",
      rawReason: "market_quality_too_low",
      finalTier: "PASS",
      finalReason: "market_quality_too_low",
      surfaced: false,
      officialSurfaced: false,
      effectiveEdge: c.edge,
      effectiveEv: c.ev,
      effectiveRankScore: c.rankScore,
    };
  }
  // 4. MIN_EDGE (per-market override or global).
  const minEdge = cfg.marketMinEdge[marketKey] ?? MIN_EDGE_TO_CANDIDATE;
  if (c.edge < minEdge) {
    return {
      rawTier: "PASS",
      rawReason: "insufficient_edge",
      finalTier: "PASS",
      finalReason: "insufficient_edge",
      surfaced: false,
      officialSurfaced: false,
      effectiveEdge: c.edge,
      effectiveEv: c.ev,
      effectiveRankScore: c.rankScore,
    };
  }
  // 5. MIN_EV.
  if (c.ev < MIN_EV_TO_CANDIDATE) {
    return {
      rawTier: "PASS",
      rawReason: "negative_ev",
      finalTier: "PASS",
      finalReason: "negative_ev",
      surfaced: false,
      officialSurfaced: false,
      effectiveEdge: c.edge,
      effectiveEv: c.ev,
      effectiveRankScore: c.rankScore,
    };
  }

  // ---- assignTier rank-score bands ----
  const tierAThreshold = cfg.tierAOverride[marketKey] ?? TIER_THRESHOLDS.A;
  let rawTier: Tier;
  let rawReason: string;
  if (c.rankScore >= tierAThreshold) {
    rawTier = "A";
    rawReason = "high_rank_score";
  } else if (c.rankScore >= TIER_THRESHOLDS.B) {
    rawTier = "B";
    rawReason = "medium_rank_score";
  } else if (c.rankScore >= TIER_THRESHOLDS.C) {
    rawTier = "C";
    rawReason = "low_rank_score";
  } else {
    return {
      rawTier: "PASS",
      rawReason: "rank_score_below_threshold",
      finalTier: "PASS",
      finalReason: "rank_score_below_threshold",
      surfaced: false,
      officialSurfaced: false,
      effectiveEdge: c.edge,
      effectiveEv: c.ev,
      effectiveRankScore: c.rankScore,
    };
  }

  // ---- watch-only post-process (mirrors scorePicks.ts:438) ----
  if (cfg.marketWatchOnly[marketKey]) {
    return {
      rawTier,
      rawReason,
      finalTier: "PASS",
      finalReason: "model_watch_only",
      surfaced: true, // surfaced in Model Watch dashboard
      officialSurfaced: false,
      effectiveEdge: c.edge,
      effectiveEv: c.ev,
      effectiveRankScore: c.rankScore,
    };
  }

  return {
    rawTier,
    rawReason,
    finalTier: rawTier,
    finalReason: rawReason,
    surfaced: true,
    officialSurfaced: true,
    effectiveEdge: c.edge,
    effectiveEv: c.ev,
    effectiveRankScore: c.rankScore,
  };
}

interface NewlySurfacedRow {
  candidateId: number;
  gameKey: string;
  league: string;
  marketType: string;
  side: string;
  publishOdds: number;
  publishLine: number | null;
  /**
   * As-PERSISTED edge / ev / rank_score from the candidate_bets row (i.e.
   * the values that production cron computed under the live calibration).
   * Retained for backward compatibility with R1 artifacts and for delta
   * inspection vs the proposed values below.
   */
  edge: number;
  ev: number;
  rankScore: number;
  /**
   * Edge / ev / rank_score the proposed gate logic actually used for THIS
   * candidate. Equals the persisted values for proposals that do NOT touch
   * calibration (R1). For sigmoidA-override proposals (R2) these are
   * recomputed from model_prob_raw via applySigmoidOverride.
   */
  proposedEffectiveEdge: number;
  proposedEffectiveEv: number;
  proposedEffectiveRankScore: number;
  baselineFinalTier: Tier;
  baselineFinalReason: string | null;
  proposedRawTier: Tier;
  proposedFinalTier: Tier;
  proposedFinalReason: string | null;
  // Realized fields (null when game not final / no source data).
  gameStatus: string;
  realizedResult: "win" | "loss" | "push" | null;
  realizedCloseOdds: number | null;
  realizedClvImpliedDelta: number | null;
}

interface MarketSummary {
  candidates: number;
  baselineSurfaced: number;
  baselineOfficial: number;
  proposedSurfaced: number;
  proposedOfficial: number;
  newlySurfaced: number;
  newlyOfficial: number;
  newlyKilled: number;
  // Realized stats over newly-surfaced rows that have a final score.
  realizedSampleSize: number;
  realizedWins: number;
  realizedLosses: number;
  realizedPushes: number;
  realizedWinRate: number | null;
  // Realized CLV stats over newly-surfaced rows with computable CLV.
  clvSampleSize: number;
  clvMean: number | null;
  clvMedian: number | null;
  clvP05: number | null;
  clvP95: number | null;
}

function newSummary(): MarketSummary {
  return {
    candidates: 0,
    baselineSurfaced: 0,
    baselineOfficial: 0,
    proposedSurfaced: 0,
    proposedOfficial: 0,
    newlySurfaced: 0,
    newlyOfficial: 0,
    newlyKilled: 0,
    realizedSampleSize: 0,
    realizedWins: 0,
    realizedLosses: 0,
    realizedPushes: 0,
    realizedWinRate: null,
    clvSampleSize: 0,
    clvMean: null,
    clvMedian: null,
    clvP05: null,
    clvP95: null,
  };
}

function pct(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  console.log(
    `\n=== validateGateChange — proposal=${args.proposal} window=[${args.windowStart}, ${args.windowEnd}) ===\n`
  );

  const baseCfg = baselineConfig();
  const propCfg = applyProposal(args.proposal, baseCfg);

  // Load candidate_bets in the frozen window (created_at-based).
  const rawCandidates = await db
    .select()
    .from(candidateBetsTable)
    .where(
      and(
        gte(candidateBetsTable.createdAt, new Date(`${args.windowStart}T00:00:00Z`)),
        lt(candidateBetsTable.createdAt, new Date(`${args.windowEnd}T00:00:00Z`))
      )
    );

  console.log(`Loaded ${rawCandidates.length} candidate_bets rows in window.`);

  // Batch-fetch matching snapshots (for realized result + close-odds).
  const gameKeys = Array.from(new Set(rawCandidates.map((r) => r.gameKey)));
  const snapByKey = new Map<string, typeof gameSnapshotsTable.$inferSelect>();
  const CHUNK = 500;
  for (let i = 0; i < gameKeys.length; i += CHUNK) {
    const slice = gameKeys.slice(i, i + CHUNK);
    const rows = await db
      .select()
      .from(gameSnapshotsTable)
      .where(inArray(gameSnapshotsTable.gameKey, slice));
    for (const r of rows) snapByKey.set(r.gameKey, r);
  }
  console.log(`Loaded ${snapByKey.size} matching game_snapshots.`);

  const summaries: Record<string, MarketSummary> = {};
  const newlySurfacedRows: NewlySurfacedRow[] = [];
  const clvByMarket: Record<string, number[]> = {};

  for (const c of rawCandidates) {
    const marketKey = `${c.league}_${c.marketType}`;
    if (!summaries[marketKey]) summaries[marketKey] = newSummary();
    const s = summaries[marketKey]!;
    s.candidates++;

    const replayInput: CandidateForReplay = {
      league: c.league,
      marketType: c.marketType,
      side: c.side,
      publishOdds: parseFloat(c.publishOdds),
      publishLine: c.publishLine != null ? parseFloat(c.publishLine) : null,
      edge: parseFloat(c.edge),
      ev: parseFloat(c.ev),
      rankScore: parseFloat(c.rankScore),
      marketQuality: parseFloat(c.marketQuality),
      modelProbRaw: parseFloat(c.modelProbRaw),
      marketProbFair: parseFloat(c.marketProbFair),
    };

    const baseOut = replayAssignTier(replayInput, baseCfg);
    const propOut = replayAssignTier(replayInput, propCfg);

    if (baseOut.surfaced) s.baselineSurfaced++;
    if (baseOut.officialSurfaced) s.baselineOfficial++;
    if (propOut.surfaced) s.proposedSurfaced++;
    if (propOut.officialSurfaced) s.proposedOfficial++;

    const becameSurfaced = !baseOut.surfaced && propOut.surfaced;
    const becameOfficial = !baseOut.officialSurfaced && propOut.officialSurfaced;
    const wasKilled = baseOut.surfaced && !propOut.surfaced;
    if (becameSurfaced) s.newlySurfaced++;
    if (becameOfficial) s.newlyOfficial++;
    if (wasKilled) s.newlyKilled++;

    if (!becameSurfaced) continue;

    // Newly surfaced — attach realized fields.
    const snap = snapByKey.get(c.gameKey);
    let realizedResult: "win" | "loss" | "push" | null = null;
    let realizedCloseOdds: number | null = null;
    let realizedClv: number | null = null;
    let gameStatus = "missing";

    if (snap) {
      gameStatus = snap.status;
      if (
        snap.status === "final" &&
        snap.homeScore != null &&
        snap.awayScore != null
      ) {
        try {
          realizedResult = computeOutcomeResult({
            market: c.marketType,
            pick: c.side,
            homeScore: snap.homeScore,
            awayScore: snap.awayScore,
            homeSpread: snap.publishSpread != null ? parseFloat(snap.publishSpread) : null,
            total: snap.publishTotal != null ? parseFloat(snap.publishTotal) : null,
          });
        } catch {
          realizedResult = null;
        }
        if (realizedResult === "win") s.realizedWins++;
        else if (realizedResult === "loss") s.realizedLosses++;
        else if (realizedResult === "push") s.realizedPushes++;
        if (realizedResult != null) s.realizedSampleSize++;
      }

      // CLV writeback equivalent — uses snapshot close_* fields directly.
      const clv = computeClvWritebackValues(
        {
          market: c.marketType,
          pick: c.side,
          publishOdds: c.publishOdds,
          publishLine: c.publishLine,
        },
        snap
      );
      if (clv.closeOdds != null) realizedCloseOdds = parseFloat(clv.closeOdds);
      if (clv.clvImpliedDelta != null) {
        realizedClv = parseFloat(clv.clvImpliedDelta);
        if (Number.isFinite(realizedClv)) {
          if (!clvByMarket[marketKey]) clvByMarket[marketKey] = [];
          clvByMarket[marketKey]!.push(realizedClv);
          s.clvSampleSize++;
        }
      }
    }

    newlySurfacedRows.push({
      candidateId: c.id,
      gameKey: c.gameKey,
      league: c.league,
      marketType: c.marketType,
      side: c.side,
      publishOdds: parseFloat(c.publishOdds),
      publishLine: c.publishLine != null ? parseFloat(c.publishLine) : null,
      edge: parseFloat(c.edge),
      ev: parseFloat(c.ev),
      rankScore: parseFloat(c.rankScore),
      proposedEffectiveEdge: propOut.effectiveEdge,
      proposedEffectiveEv: propOut.effectiveEv,
      proposedEffectiveRankScore: propOut.effectiveRankScore,
      baselineFinalTier: baseOut.finalTier,
      baselineFinalReason: baseOut.finalReason,
      proposedRawTier: propOut.rawTier,
      proposedFinalTier: propOut.finalTier,
      proposedFinalReason: propOut.finalReason,
      gameStatus,
      realizedResult,
      realizedCloseOdds,
      realizedClvImpliedDelta: realizedClv,
    });
  }

  // Finalize per-market summaries.
  for (const [marketKey, s] of Object.entries(summaries)) {
    if (s.realizedSampleSize > 0) {
      // Win rate excludes pushes from the denominator (industry standard).
      const decided = s.realizedWins + s.realizedLosses;
      s.realizedWinRate = decided > 0 ? s.realizedWins / decided : null;
    }
    const samples = clvByMarket[marketKey] ?? [];
    if (samples.length > 0) {
      s.clvMean = samples.reduce((a, b) => a + b, 0) / samples.length;
      s.clvMedian = pct(samples, 0.5);
      s.clvP05 = pct(samples, 0.05);
      s.clvP95 = pct(samples, 0.95);
    }
  }

  // Write JSON output.
  const outDir = path.resolve(process.cwd(), ".local/validation_dryruns");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${ts}_${args.proposal}.json`);
  const report = {
    proposal: args.proposal,
    window: { start: args.windowStart, end: args.windowEnd },
    runAt: new Date().toISOString(),
    candidatesScanned: rawCandidates.length,
    snapshotsLoaded: snapByKey.size,
    perMarket: summaries,
    newlySurfacedRows,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // Console summary (compact).
  console.log("\n=== Per-market summary ===");
  console.log(
    "marketKey".padEnd(18) +
      " | " +
      ["cands", "base_surf", "base_off", "prop_surf", "prop_off", "+surf", "+off", "killed"]
        .map((s) => s.padStart(9))
        .join(" | ")
  );
  for (const [k, s] of Object.entries(summaries).sort()) {
    console.log(
      k.padEnd(18) +
        " | " +
        [
          s.candidates,
          s.baselineSurfaced,
          s.baselineOfficial,
          s.proposedSurfaced,
          s.proposedOfficial,
          s.newlySurfaced,
          s.newlyOfficial,
          s.newlyKilled,
        ]
          .map((n) => String(n).padStart(9))
          .join(" | ")
    );
  }

  console.log("\n=== Realized outcomes for newly-surfaced rows ===");
  console.log(
    "marketKey".padEnd(18) +
      " | " +
      ["new_surf", "decided", "wins", "losses", "pushes", "winRate", "clv_n", "clv_mean"]
        .map((s) => s.padStart(10))
        .join(" | ")
  );
  for (const [k, s] of Object.entries(summaries).sort()) {
    if (s.newlySurfaced === 0) continue;
    console.log(
      k.padEnd(18) +
        " | " +
        [
          s.newlySurfaced,
          s.realizedWins + s.realizedLosses,
          s.realizedWins,
          s.realizedLosses,
          s.realizedPushes,
          s.realizedWinRate != null ? (s.realizedWinRate * 100).toFixed(1) + "%" : "—",
          s.clvSampleSize,
          s.clvMean != null ? s.clvMean.toFixed(4) : "—",
        ]
          .map((v) => String(v).padStart(10))
          .join(" | ")
    );
  }

  console.log(`\nWrote full report to: ${outPath}`);
  console.log("READ-ONLY — no DB writes performed.\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
