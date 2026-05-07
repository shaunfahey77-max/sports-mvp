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
 *   tsx src/scripts/validateGateChange.ts --proposal=R3-nhl-spread-isotonic
 *   tsx src/scripts/validateGateChange.ts --proposal=R4-open-all
 *   tsx src/scripts/validateGateChange.ts --proposal=R1 --window-start=2026-03-12 --window-end=2026-04-27
 *
 * Proposal "R2" demonstrates the in-memory sigmoidA override path: the proposed
 * sigmoidA value is applied to model_prob_raw via the production calibration
 * formula, edge/EV/rank_score are recomputed against market_prob_fair and
 * publish_odds (also production formulas), then the gate-replay runs as
 * normal. No DB write, no live config touch.
 *
 * Proposal "R3-nhl-spread-isotonic" exercises the in-memory isotonicBuckets
 * override path (analog of R2 for isotonic markets). The harness:
 *   1. Pulls cohort A (pre-Phase-0.75C) + cohort B (post-Phase-0.75C deploy)
 *      graded nhl_spread candidate_bets, joined with game_snapshots for the
 *      realized win/loss outcome. Pushes/voids/pending are excluded.
 *   2. Bins by model_prob_raw into the 10 fixed [low,high) buckets defined
 *      in nhlSpreadIsotonicBuckets(). For each bucket with n >= MIN_BUCKET_N,
 *      sets calibrated_new = wins/(wins+losses); sparse buckets fill-forward
 *      from the nearest LOWER refit bucket; then a weighted PAV sweep
 *      enforces monotone non-decreasing values.
 *   3. Computes acceptance constraints C1-C5 from the proposal.
 *   4. Runs the standard surfaced-pick replay (default window) with the new
 *      buckets in-memory only — recomputes calibrated/edge/EV/rank_score via
 *      the production calibrateProb/computeEdge/computeEV formulas. No DB
 *      write, no mutation of DEFAULT_CALIBRATION_PARAMS.
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
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
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
        "Usage: tsx src/scripts/validateGateChange.ts --proposal=R1|R2|R3-nhl-spread-isotonic|R4-open-all [--window-start=YYYY-MM-DD] [--window-end=YYYY-MM-DD]"
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

interface IsotonicBucket {
  low: number;
  high: number;
  calibrated: number;
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
  /**
   * In-memory isotonicBuckets override per `${league}_${marketType}` key. When
   * a key has an entry here AND the production calibration method for that
   * market is "isotonic", the replay recomputes calibrated_prob → edge → ev →
   * rank_score from `model_prob_raw` using the override bucket array (replacing
   * params.isotonicBuckets). Markets without an entry use the persisted
   * edge/ev/rank_score values directly. This is the analog of
   * sigmoidAOverride for isotonic markets.
   */
  isotonicBucketsOverride: Record<string, IsotonicBucket[]>;
}

function baselineConfig(): GateConfig {
  return {
    marketDisabled: { ...(MARKET_DISABLED as Record<string, boolean>) },
    marketWatchOnly: { ...(MARKET_MODEL_WATCH_ONLY as Record<string, boolean>) },
    marketMinEdge: { ...(MARKET_MIN_EDGE as Record<string, number>) },
    tierAOverride: { ...(TIER_A_THRESHOLD_OVERRIDE as Record<string, number>) },
    sigmoidAOverride: {},
    isotonicBucketsOverride: {},
  };
}

/**
 * R3-nhl-spread-isotonic refit thresholds (mirrors
 * .local/proposals/nhl-spread-refit-v3.md, Sections 1, 3, 6).
 *
 * MIN_BUCKET_N        — per-bucket floor for the per-bucket refit rule.
 * MAX_BUCKET_DELTA    — C2 single-cycle drift cap.
 * MIN_BRIER_DELTA     — C3 minimum aggregate Brier improvement.
 * MIN_TOTAL_N         — C5 combined-sample floor.
 * MIN_TOP_BUCKET_N    — C5 top-two non-empty bucket floor.
 * STRUCTURAL_HEADROOM — C4 minimum top-bucket calibrated_new vs. median
 *                       market_prob_fair across top-two non-empty buckets.
 * PHASE_0_75C_DEPLOY_TS — Phase-0.75C deploy timestamp; cohort A/B boundary.
 *                         Recommended in Section 2 over the literal
 *                         2026-04-22T00:00:00Z spec wording.
 */
const R3_MIN_BUCKET_N = 20;
const R3_MAX_BUCKET_DELTA = 0.1;
const R3_MIN_BRIER_DELTA = 0.005;
const R3_MIN_TOTAL_N = 200;
const R3_MIN_TOP_BUCKET_N = 25;
const R3_STRUCTURAL_HEADROOM = 0.02;
const R3_PHASE_0_75C_DEPLOY_TS = "2026-04-22T16:42:30Z";
const R3_PHASE_0_75C_BUCKETS_COMMIT = "854697b6";
const R3_PAV_SAFETY_CAP = 100;

const R3_BUCKET_BOUNDARIES: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.1],
  [0.1, 0.2],
  [0.2, 0.3],
  [0.3, 0.4],
  [0.4, 0.5],
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0],
];

/**
 * Apply a named proposal on top of baseline. Returns a NEW config object
 * paired with proposal-specific diagnostic state; baseline is not mutated.
 *
 * Async because R3-nhl-spread-isotonic must pull a graded combined-cohort
 * sample from the DB to compute the refit bucket array before the replay
 * starts. Other proposals are synchronous.
 */
async function applyProposal(
  name: string,
  base: GateConfig
): Promise<{ cfg: GateConfig; r3?: R3Diagnostics }> {
  const cfg: GateConfig = {
    marketDisabled: { ...base.marketDisabled },
    marketWatchOnly: { ...base.marketWatchOnly },
    marketMinEdge: { ...base.marketMinEdge },
    tierAOverride: { ...base.tierAOverride },
    sigmoidAOverride: { ...base.sigmoidAOverride },
    isotonicBucketsOverride: { ...base.isotonicBucketsOverride },
  };
  switch (name) {
    case "R1":
      // NHL total: lift from MARKET_DISABLED → place in MARKET_MODEL_WATCH_ONLY.
      cfg.marketDisabled.nhl_total = false;
      cfg.marketWatchOnly.nhl_total = true;
      return { cfg };
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
      return { cfg };
    case "R3-nhl-spread-isotonic": {
      // Pre-pass: pull cohort A+B graded nhl_spread sample, build refit
      // buckets, install the override. The replay itself runs the standard
      // surfaced-pick path with the new buckets in-memory.
      const r3 = await buildR3NhlSpreadRefit();
      cfg.isotonicBucketsOverride.nhl_spread = r3.refitBuckets;
      return { cfg, r3 };
    }
    case "R4-open-all":
      // Product-direction replay (2026-05-07): clear the legacy hard-coded
      // suppression/watch-only maps so every currently modeled market is
      // allowed to flow through normal tiering. This is read-only and lets us
      // quantify what the daily slate would have looked like under the open
      // market plan without mutating production data.
      for (const key of Object.keys(cfg.marketDisabled)) {
        delete cfg.marketDisabled[key];
      }
      for (const key of Object.keys(cfg.marketWatchOnly)) {
        delete cfg.marketWatchOnly[key];
      }
      return { cfg };
    default:
      console.error(
        `ERROR: unknown proposal '${name}' (supported: R1, R2, R3-nhl-spread-isotonic, R4-open-all)`
      );
      process.exit(2);
  }
}

// ---------- R3-nhl-spread-isotonic refit pre-pass ----------

interface R3BucketDiagnostic {
  idx: number;
  range: [number, number];
  n: number;
  cohortA_n: number;
  cohortB_n: number;
  wins: number;
  losses: number;
  realizedCoverRate: number | null;
  calibrated_v2: number;
  calibrated_new: number;
  delta_vs_v2: number;
  fillForwardSource:
    | "self_refit"
    | "inherited_from_lower"
    | "kept_v2_no_lower_refit";
  was_refit: boolean;
  brier_old_contribution: number;
  brier_new_contribution: number;
}

interface R3Diagnostics {
  refitBuckets: IsotonicBucket[];
  v2Buckets: IsotonicBucket[];
  cohorts: {
    deployTimestampUtc: string;
    cohortA_graded_n: number;
    cohortB_graded_n: number;
    combined_n: number;
    pushesExcluded: number;
    voidExcluded: number;
    pendingExcluded: number;
    totalRowsPulled: number;
  };
  buckets: R3BucketDiagnostic[];
  pavIterations: number;
  pavConverged: boolean;
  acceptance: {
    c1_monotonicity_pass: boolean;
    c1_violations: Array<{ idx: number; prev: number; cur: number }>;
    c2_no_over_extrapolation_pass: boolean;
    c2_threshold: number;
    c2_worst_bucket: { idx: number; delta: number };
    c2_violating_buckets: Array<{ idx: number; delta: number }>;
    c3_brier_improvement_pass: boolean;
    c3_threshold: number;
    c3_brier_v2: number;
    c3_brier_new: number;
    c3_delta: number;
    c3_sample_n: number;
    c4_structural_life_pass: boolean;
    c4_headroom_threshold: number;
    c4_top_non_empty_idx: number | null;
    c4_top_bucket_calibrated_new: number | null;
    c4_second_non_empty_idx: number | null;
    c4_top_two_union_n: number;
    c4_median_market_prob_fair_top_two: number | null;
    c4_headroom: number | null;
    c5_sample_size_pass: boolean;
    c5_total_n: number;
    c5_total_n_threshold: number;
    c5_total_n_pass: boolean;
    c5_top_two_n: number;
    c5_top_two_n_threshold: number;
    c5_top_two_n_pass: boolean;
  };
  allPass: boolean;
  passing: string[];
  failing: string[];
}

function bucketIdxFor(prob: number): number {
  // Mirrors the production applyIsotonic match rule: prob >= low && prob < high.
  // Probabilities clamped to [0,1) — prob == 1 lands in the top bucket.
  for (let i = 0; i < R3_BUCKET_BOUNDARIES.length; i++) {
    const [lo, hi] = R3_BUCKET_BOUNDARIES[i]!;
    if (prob >= lo && prob < hi) return i;
  }
  return R3_BUCKET_BOUNDARIES.length - 1;
}

interface R3SampleRow {
  bucketIdx: number;
  cohort: "A" | "B";
  outcome: 0 | 1;
  modelProbRaw: number;
  marketProbFair: number;
  calibrated_v2: number;
}

async function buildR3NhlSpreadRefit(): Promise<R3Diagnostics> {
  console.log(
    `\n[R3] Pre-pass: pulling nhl_spread cohort A+B from candidate_bets...`
  );
  console.log(
    `[R3] Phase-0.75C deploy timestamp: ${R3_PHASE_0_75C_DEPLOY_TS} (commit ${R3_PHASE_0_75C_BUCKETS_COMMIT})`
  );

  // Pull every nhl_spread candidate (graded or not) so we can report
  // pushesExcluded / pendingExcluded faithfully and so the dedup-on-id rule
  // from the proposal is the only thing controlling row identity.
  const rows = await db
    .select()
    .from(candidateBetsTable)
    .where(
      and(
        eq(candidateBetsTable.league, "nhl"),
        eq(candidateBetsTable.marketType, "spread")
      )
    );
  const totalRowsPulled = rows.length;
  console.log(`[R3] Pulled ${totalRowsPulled} nhl_spread candidate_bets rows.`);

  // Snapshot lookup for outcome grading.
  const gameKeys = Array.from(new Set(rows.map((r) => r.gameKey)));
  const snapByKey = new Map<string, typeof gameSnapshotsTable.$inferSelect>();
  const CHUNK = 500;
  for (let i = 0; i < gameKeys.length; i += CHUNK) {
    const slice = gameKeys.slice(i, i + CHUNK);
    const snaps = await db
      .select()
      .from(gameSnapshotsTable)
      .where(inArray(gameSnapshotsTable.gameKey, slice));
    for (const s of snaps) snapByKey.set(s.gameKey, s);
  }
  console.log(`[R3] Loaded ${snapByKey.size} matching game_snapshots.`);

  const v2Buckets = R3_BUCKET_BOUNDARIES.map(([lo, hi], i) => {
    // Mirror the production nhlSpreadIsotonicBuckets() values.
    const calibrated = [0.05, 0.12, 0.22, 0.33, 0.46, 0.52, 0.54, 0.57, 0.62, 0.66][i]!;
    return { low: lo, high: hi, calibrated };
  });

  const deployTs = new Date(R3_PHASE_0_75C_DEPLOY_TS);
  let pushesExcluded = 0;
  let voidExcluded = 0;
  let pendingExcluded = 0;
  const sample: R3SampleRow[] = [];
  // Per-bucket aggregates.
  const buckets: R3BucketDiagnostic[] = R3_BUCKET_BOUNDARIES.map(
    ([lo, hi], i) => ({
      idx: i,
      range: [lo, hi],
      n: 0,
      cohortA_n: 0,
      cohortB_n: 0,
      wins: 0,
      losses: 0,
      realizedCoverRate: null,
      calibrated_v2: v2Buckets[i]!.calibrated,
      calibrated_new: v2Buckets[i]!.calibrated,
      delta_vs_v2: 0,
      fillForwardSource: "kept_v2_no_lower_refit",
      was_refit: false,
      brier_old_contribution: 0,
      brier_new_contribution: 0,
    })
  );

  for (const r of rows) {
    const snap = snapByKey.get(r.gameKey);
    if (!snap) {
      pendingExcluded++;
      continue;
    }
    if (snap.status !== "final" || snap.homeScore == null || snap.awayScore == null) {
      pendingExcluded++;
      continue;
    }
    let outcome: "win" | "loss" | "push";
    try {
      outcome = computeOutcomeResult({
        market: r.marketType,
        pick: r.side,
        homeScore: snap.homeScore,
        awayScore: snap.awayScore,
        homeSpread: snap.publishSpread != null ? parseFloat(snap.publishSpread) : null,
      });
    } catch {
      voidExcluded++;
      continue;
    }
    if (outcome === "push") {
      pushesExcluded++;
      continue;
    }

    const modelProbRaw = parseFloat(r.modelProbRaw);
    const marketProbFair = parseFloat(r.marketProbFair);
    const idx = bucketIdxFor(modelProbRaw);
    const cohort: "A" | "B" = r.createdAt < deployTs ? "A" : "B";
    const outcomeBit: 0 | 1 = outcome === "win" ? 1 : 0;

    const b = buckets[idx]!;
    b.n++;
    if (cohort === "A") b.cohortA_n++;
    else b.cohortB_n++;
    if (outcomeBit === 1) b.wins++;
    else b.losses++;

    sample.push({
      bucketIdx: idx,
      cohort,
      outcome: outcomeBit,
      modelProbRaw,
      marketProbFair,
      calibrated_v2: v2Buckets[idx]!.calibrated,
    });
  }

  const cohortA_graded_n = buckets.reduce((a, b) => a + b.cohortA_n, 0);
  const cohortB_graded_n = buckets.reduce((a, b) => a + b.cohortB_n, 0);
  const combined_n = sample.length;
  console.log(
    `[R3] Cohort A graded: ${cohortA_graded_n} | Cohort B graded: ${cohortB_graded_n} | Combined: ${combined_n}`
  );
  console.log(
    `[R3] Excluded — push: ${pushesExcluded} | void: ${voidExcluded} | pending/no-snapshot: ${pendingExcluded}`
  );

  // Per-bucket refit + fill-forward.
  for (const b of buckets) {
    if (b.n >= R3_MIN_BUCKET_N) {
      const decided = b.wins + b.losses;
      b.realizedCoverRate = decided > 0 ? b.wins / decided : null;
      b.calibrated_new = b.realizedCoverRate ?? b.calibrated_v2;
      b.was_refit = true;
      b.fillForwardSource = "self_refit";
    }
  }
  // Sparse buckets fill-forward from the nearest LOWER refit bucket.
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    if (b.was_refit) continue;
    let src: R3BucketDiagnostic | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (buckets[j]!.was_refit) {
        src = buckets[j]!;
        break;
      }
    }
    if (src) {
      b.calibrated_new = src.calibrated_new;
      b.fillForwardSource = "inherited_from_lower";
    } else {
      b.calibrated_new = b.calibrated_v2;
      b.fillForwardSource = "kept_v2_no_lower_refit";
    }
  }

  // PAV sweep: weighted by n, repeat until non-decreasing.
  let pavIterations = 0;
  let pavConverged = false;
  for (let iter = 0; iter < R3_PAV_SAFETY_CAP; iter++) {
    pavIterations++;
    let violated = false;
    for (let i = 1; i < buckets.length; i++) {
      const prev = buckets[i - 1]!;
      const cur = buckets[i]!;
      if (cur.calibrated_new < prev.calibrated_new) {
        // Pool with TRUE n-weights per proposal Section 1 ("weighted PAV").
        // When both buckets carry no evidence (n_prev = n_cur = 0, e.g. two
        // adjacent fill-forward / kept-v2 buckets), fall back to a simple
        // arithmetic mean so monotonicity violations can still propagate
        // through chains of empty buckets without dividing by zero.
        const wPrev = prev.n;
        const wCur = cur.n;
        const wSum = wPrev + wCur;
        const pooled =
          wSum > 0
            ? (prev.calibrated_new * wPrev + cur.calibrated_new * wCur) / wSum
            : (prev.calibrated_new + cur.calibrated_new) / 2;
        prev.calibrated_new = pooled;
        cur.calibrated_new = pooled;
        violated = true;
      }
    }
    if (!violated) {
      pavConverged = true;
      break;
    }
  }

  // Finalize delta vs v2 and Brier contributions.
  for (const b of buckets) {
    b.delta_vs_v2 = b.calibrated_new - b.calibrated_v2;
  }
  // Brier contributions (per-bucket sum of (calibrated - outcome)^2 — the
  // means are reported at the top level).
  let brier_v2_sum = 0;
  let brier_new_sum = 0;
  for (const r of sample) {
    const cNew = buckets[r.bucketIdx]!.calibrated_new;
    const cOld = r.calibrated_v2;
    brier_v2_sum += (cOld - r.outcome) ** 2;
    brier_new_sum += (cNew - r.outcome) ** 2;
    buckets[r.bucketIdx]!.brier_old_contribution += (cOld - r.outcome) ** 2;
    buckets[r.bucketIdx]!.brier_new_contribution += (cNew - r.outcome) ** 2;
  }
  const brier_v2 = combined_n > 0 ? brier_v2_sum / combined_n : 0;
  const brier_new = combined_n > 0 ? brier_new_sum / combined_n : 0;
  const brier_delta = brier_v2 - brier_new;

  // Acceptance constraints.
  // C1 — monotonicity (post-PAV); use a small tolerance for FP error.
  const c1_violations: Array<{ idx: number; prev: number; cur: number }> = [];
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i]!.calibrated_new < buckets[i - 1]!.calibrated_new - 1e-9) {
      c1_violations.push({
        idx: i,
        prev: buckets[i - 1]!.calibrated_new,
        cur: buckets[i]!.calibrated_new,
      });
    }
  }
  const c1_pass = c1_violations.length === 0;

  // C2 — no per-bucket drift > MAX_BUCKET_DELTA.
  let worstIdx = 0;
  let worstAbs = 0;
  const c2_violating: Array<{ idx: number; delta: number }> = [];
  for (const b of buckets) {
    if (Math.abs(b.delta_vs_v2) > worstAbs) {
      worstAbs = Math.abs(b.delta_vs_v2);
      worstIdx = b.idx;
    }
    if (Math.abs(b.delta_vs_v2) > R3_MAX_BUCKET_DELTA + 1e-9) {
      c2_violating.push({ idx: b.idx, delta: b.delta_vs_v2 });
    }
  }
  const c2_pass = c2_violating.length === 0;

  // C3 — Brier improvement.
  const c3_pass = brier_delta >= R3_MIN_BRIER_DELTA;

  // C4 — structural-life. "Top two non-empty buckets" by index, after PAV.
  const nonEmptyIdx = buckets.filter((b) => b.n > 0).map((b) => b.idx);
  const topIdx = nonEmptyIdx.length > 0 ? nonEmptyIdx[nonEmptyIdx.length - 1]! : null;
  const secondIdx =
    nonEmptyIdx.length > 1 ? nonEmptyIdx[nonEmptyIdx.length - 2]! : null;
  const top_two_n =
    (topIdx != null ? buckets[topIdx]!.n : 0) +
    (secondIdx != null ? buckets[secondIdx]!.n : 0);
  const top_two_market_probs: number[] = [];
  for (const r of sample) {
    if (r.bucketIdx === topIdx || r.bucketIdx === secondIdx) {
      top_two_market_probs.push(r.marketProbFair);
    }
  }
  const median_top_two =
    top_two_market_probs.length > 0 ? pct(top_two_market_probs, 0.5) : null;
  const top_calibrated_new = topIdx != null ? buckets[topIdx]!.calibrated_new : null;
  const c4_headroom =
    top_calibrated_new != null && median_top_two != null
      ? top_calibrated_new - median_top_two
      : null;
  const c4_pass =
    c4_headroom != null && c4_headroom >= R3_STRUCTURAL_HEADROOM;

  // C5 — sample size.
  const c5_total_pass = combined_n >= R3_MIN_TOTAL_N;
  const c5_top_two_pass = top_two_n >= R3_MIN_TOP_BUCKET_N;
  const c5_pass = c5_total_pass && c5_top_two_pass;

  const passing: string[] = [];
  const failing: string[] = [];
  for (const [name, pass] of [
    ["C1", c1_pass],
    ["C2", c2_pass],
    ["C3", c3_pass],
    ["C4", c4_pass],
    ["C5", c5_pass],
  ] as const) {
    (pass ? passing : failing).push(name);
  }
  const allPass = failing.length === 0;

  const refitBuckets: IsotonicBucket[] = buckets.map((b) => ({
    low: b.range[0],
    high: b.range[1],
    calibrated: b.calibrated_new,
  }));

  return {
    refitBuckets,
    v2Buckets,
    cohorts: {
      deployTimestampUtc: R3_PHASE_0_75C_DEPLOY_TS,
      cohortA_graded_n,
      cohortB_graded_n,
      combined_n,
      pushesExcluded,
      voidExcluded,
      pendingExcluded,
      totalRowsPulled,
    },
    buckets,
    pavIterations,
    pavConverged,
    acceptance: {
      c1_monotonicity_pass: c1_pass,
      c1_violations,
      c2_no_over_extrapolation_pass: c2_pass,
      c2_threshold: R3_MAX_BUCKET_DELTA,
      c2_worst_bucket: { idx: worstIdx, delta: buckets[worstIdx]!.delta_vs_v2 },
      c2_violating_buckets: c2_violating,
      c3_brier_improvement_pass: c3_pass,
      c3_threshold: R3_MIN_BRIER_DELTA,
      c3_brier_v2: brier_v2,
      c3_brier_new: brier_new,
      c3_delta: brier_delta,
      c3_sample_n: combined_n,
      c4_structural_life_pass: c4_pass,
      c4_headroom_threshold: R3_STRUCTURAL_HEADROOM,
      c4_top_non_empty_idx: topIdx,
      c4_top_bucket_calibrated_new: top_calibrated_new,
      c4_second_non_empty_idx: secondIdx,
      c4_top_two_union_n: top_two_n,
      c4_median_market_prob_fair_top_two: median_top_two,
      c4_headroom,
      c5_sample_size_pass: c5_pass,
      c5_total_n: combined_n,
      c5_total_n_threshold: R3_MIN_TOTAL_N,
      c5_total_n_pass: c5_total_pass,
      c5_top_two_n: top_two_n,
      c5_top_two_n_threshold: R3_MIN_TOP_BUCKET_N,
      c5_top_two_n_pass: c5_top_two_pass,
    },
    allPass,
    passing,
    failing,
  };
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
  persistedTier?: Tier;
  persistedSelectionReason?: string | null;
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

function replayPersistedBaseline(c: CandidateForReplay): ReplayOutcome {
  const persistedTier = c.persistedTier ?? "PASS";
  const persistedReason = c.persistedSelectionReason ?? null;

  if (persistedReason === "model_watch_only") {
    return {
      rawTier: persistedTier === "PASS" ? "PASS" : persistedTier,
      rawReason: persistedReason,
      finalTier: "PASS",
      finalReason: "model_watch_only",
      surfaced: true,
      officialSurfaced: false,
      effectiveEdge: c.edge,
      effectiveEv: c.ev,
      effectiveRankScore: c.rankScore,
    };
  }

  if (
    persistedReason === "market_disabled" ||
    persistedReason === "odds_out_of_range" ||
    persistedReason === "market_quality_too_low" ||
    persistedReason === "insufficient_edge" ||
    persistedReason === "negative_ev" ||
    persistedReason === "rank_score_below_threshold"
  ) {
    return {
      rawTier: "PASS",
      rawReason: persistedReason,
      finalTier: "PASS",
      finalReason: persistedReason,
      surfaced: false,
      officialSurfaced: false,
      effectiveEdge: c.edge,
      effectiveEv: c.ev,
      effectiveRankScore: c.rankScore,
    };
  }

  if (persistedTier === "A" || persistedTier === "B" || persistedTier === "C") {
    return {
      rawTier: persistedTier,
      rawReason: persistedReason,
      finalTier: persistedTier,
      finalReason: persistedReason,
      surfaced: true,
      officialSurfaced: true,
      effectiveEdge: c.edge,
      effectiveEv: c.ev,
      effectiveRankScore: c.rankScore,
    };
  }

  return {
    rawTier: "PASS",
    rawReason: persistedReason,
    finalTier: "PASS",
    finalReason: persistedReason,
    surfaced: false,
    officialSurfaced: false,
    effectiveEdge: c.edge,
    effectiveEv: c.ev,
    effectiveRankScore: c.rankScore,
  };
}

interface SnapshotForReplay {
  gameKey: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  publishSpread: string | null;
  publishTotal: string | null;
  homeCloseMl: string | null;
  awayCloseMl: string | null;
  closeSpread: string | null;
  closeSpreadLine: string | null;
  closeAwaySpreadLine: string | null;
  closeTotal: string | null;
  closeOverLine: string | null;
  closeUnderLine: string | null;
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

/**
 * Apply an isotonicBuckets override (if configured for the candidate's market)
 * by recomputing calibrated_prob → edge → ev → rank_score from model_prob_raw,
 * using the production calibration / EV / rank formulas verbatim. Returns a
 * NEW candidate object with the recomputed fields; the input is not mutated.
 *
 * Returns the original candidate unchanged if:
 *   - no override is configured for this market, OR
 *   - production calibration method for this market is not "isotonic"
 *
 * NOTE: market_quality is taken as-persisted (it does NOT depend on
 * calibration). calibration_confidence depends on model_prob_raw (not on
 * the calibrated value), so it is unchanged under a buckets-only swap.
 */
function applyIsotonicOverride(
  c: CandidateForReplay,
  cfg: GateConfig
): CandidateForReplay {
  const marketKey = `${c.league}_${c.marketType}`;
  const overrideBuckets = cfg.isotonicBucketsOverride[marketKey];
  if (overrideBuckets == null) return c;
  const baseParams = getCalibrationParams(c.league, c.marketType);
  if (baseParams.method !== "isotonic") return c;

  const overrideParams = { ...baseParams, isotonicBuckets: overrideBuckets };
  const newCalibrated = calibrateProb(c.modelProbRaw, overrideParams);
  const newEdge = computeEdge(newCalibrated, c.marketProbFair);
  const newEv = Math.min(MAX_EV_CAP, computeEV(newCalibrated, c.publishOdds));
  const calibConfidence = getCalibrationConfidence(
    c.league,
    c.marketType,
    c.modelProbRaw
  );
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
  // Calibration overrides are mutually exclusive in practice (a market is
  // either sigmoid or isotonic, never both), but apply both unconditionally:
  // each is a no-op when the market's production method doesn't match.
  const c = applyIsotonicOverride(applySigmoidOverride(c0, cfg), cfg);
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
  // Raw tier counts (BEFORE the watch-only override). Used by R3 Section 5c
  // surfaced-pick delta report so the per-tier baseline-vs-proposed numbers
  // reflect what assignTier would have produced regardless of whether the
  // market is currently in MARKET_MODEL_WATCH_ONLY.
  baselineRawTier: { A: number; B: number; C: number; PASS: number };
  proposedRawTier: { A: number; B: number; C: number; PASS: number };
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
    baselineRawTier: { A: 0, B: 0, C: 0, PASS: 0 },
    proposedRawTier: { A: 0, B: 0, C: 0, PASS: 0 },
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

/**
 * Build the R3-specific report section: refit cohorts, per-bucket diagnostics,
 * acceptance-constraint outcomes (Section 5b), and the surfaced-pick delta
 * across markets (Section 5c). Recommendation enforces the proposal's
 * decision tree: any C1-C5 failure ⇒ DO_NOT_SHIP; all pass + tier-A volume
 * review needed ⇒ MANUAL_REVIEW; all pass and no review trigger ⇒ SHIP.
 */
function buildR3ReportSection(
  r3: R3Diagnostics,
  summaries: Record<string, MarketSummary>
): Record<string, unknown> {
  const tierAVolumeReviews: Record<
    string,
    { tier_a_baseline: number; tier_a_proposed: number; ratio: number | null; required: boolean }
  > = {};
  const surfacedPickDelta: Record<string, Record<string, number | null>> = {};
  for (const [marketKey, s] of Object.entries(summaries)) {
    const A_base = s.baselineRawTier.A;
    const A_prop = s.proposedRawTier.A;
    const B_base = s.baselineRawTier.B;
    const B_prop = s.proposedRawTier.B;
    const C_base = s.baselineRawTier.C;
    const C_prop = s.proposedRawTier.C;
    const P_base = s.baselineRawTier.PASS;
    const P_prop = s.proposedRawTier.PASS;
    // Section 5 manual-review trigger is the strict inequality
    // tier_a_proposed > 1.5 * tier_a_baseline. When baseline = 0 and proposed
    // > 0 the inequality holds (proposed > 0), so review IS required — that
    // is the surfacing-from-nothing case the trigger is designed to catch.
    // `ratio` is only reported when A_base > 0 so the JSON does not advertise
    // a divide-by-zero value, but `required` always reflects the inequality.
    const ratio = A_base > 0 ? A_prop / A_base : null;
    const required = A_prop > 1.5 * A_base;
    tierAVolumeReviews[marketKey] = {
      tier_a_baseline: A_base,
      tier_a_proposed: A_prop,
      ratio,
      required,
    };
    surfacedPickDelta[marketKey] = {
      tier_a_baseline: A_base,
      tier_a_proposed: A_prop,
      tier_a_delta: A_prop - A_base,
      tier_b_baseline: B_base,
      tier_b_proposed: B_prop,
      tier_b_delta: B_prop - B_base,
      tier_c_baseline: C_base,
      tier_c_proposed: C_prop,
      tier_c_delta: C_prop - C_base,
      pass_baseline: P_base,
      pass_proposed: P_prop,
      pass_delta: P_prop - P_base,
    };
  }

  // Decision tree (Section 5 + Section 4).
  const targetMarketKey = "nhl_spread";
  const targetReview = tierAVolumeReviews[targetMarketKey];
  const tier_a_volume_review_required = targetReview?.required ?? false;
  let verdict: "SHIP" | "DO_NOT_SHIP" | "MANUAL_REVIEW";
  let action: string;
  if (!r3.allPass) {
    verdict = "DO_NOT_SHIP";
    action =
      "One or more of C1-C5 failed. Per Section 3 + Section 5 fail action: do NOT bump version, do NOT touch calibration.ts, save report, stop.";
  } else if (tier_a_volume_review_required) {
    verdict = "MANUAL_REVIEW";
    action =
      "C1-C5 pass but Tier-A volume increases >50% vs. baseline. Per Section 5 manual-review trigger, do NOT ship until a reviewer signs off in writing on this report.";
  } else {
    verdict = "SHIP";
    action =
      "C1-C5 pass and tier-A volume review not required. Per Section 4 + Section 6: bump nhl.spread version v2 → v3 in calibration.ts, bump CALIBRATION_VERSION v2 → v3 in scoringModelConfig.ts, swap nhlSpreadIsotonicBuckets() to the refit array, then ship. nhl_spread stays in MARKET_MODEL_WATCH_ONLY until Cohort C accumulates ≥60 graded picks under v3 with realized win rate within ±5pp of refit prediction.";
  }

  return {
    schemaVersion: 2,
    proposalId: "R3",
    proposalRef: ".local/proposals/nhl-spread-refit-v3.md",
    market: "nhl_spread",
    pipelineSafety: {
      calibrationTsModified: false,
      calibrationVersionBumped: false,
      deployed: false,
      notes:
        "Refit produced and replayed in-memory only. nhlSpreadIsotonicBuckets() in artifacts/api-server/src/scoring/calibration.ts is unchanged; CALIBRATION_VERSION in scoringModelConfig.ts is unchanged.",
    },
    cohorts: {
      deployTimestampUtc: r3.cohorts.deployTimestampUtc,
      deployTimestampSource:
        "Constant pinned at the top of validateGateChange.ts (R3_PHASE_0_75C_DEPLOY_TS) and reproduced verbatim in the report. Reviewers should re-derive the timestamp from the commit history (Section 2 of the proposal) before approving any version bump driven by this report; the JSON does not by itself constitute confirmation that the cohort boundary is correct.",
      phase_0_75c_buckets_commit: R3_PHASE_0_75C_BUCKETS_COMMIT,
      cohortA: {
        definition: "candidate_bets WHERE league='nhl' AND market_type='spread' AND created_at < deploy_ts AND result IN ('win','loss')",
        graded_n: r3.cohorts.cohortA_graded_n,
      },
      cohortB: {
        definition: "candidate_bets WHERE league='nhl' AND market_type='spread' AND created_at >= deploy_ts AND result IN ('win','loss')",
        graded_n: r3.cohorts.cohortB_graded_n,
      },
      combined_n: r3.cohorts.combined_n,
      pushesExcluded: r3.cohorts.pushesExcluded,
      voidExcluded: r3.cohorts.voidExcluded,
      pendingOrUngradedExcluded: r3.cohorts.pendingExcluded,
      totalRowsPulled: r3.cohorts.totalRowsPulled,
    },
    refitMethod: {
      perBucketRule: `If n >= MIN_BUCKET_N(${R3_MIN_BUCKET_N}): calibrated_new = realized cover-rate; else inherit from nearest LOWER refit bucket; then weighted PAV until monotone non-decreasing.`,
      minBucketN: R3_MIN_BUCKET_N,
      pavIterations: r3.pavIterations,
      pavConverged: r3.pavConverged,
    },
    buckets: r3.buckets.map((b) => ({
      idx: b.idx,
      low: b.range[0],
      high: b.range[1],
      n: b.n,
      cohortA_n: b.cohortA_n,
      cohortB_n: b.cohortB_n,
      wins: b.wins,
      losses: b.losses,
      realizedCoverRate: b.realizedCoverRate,
      calibrated_v2: b.calibrated_v2,
      calibrated_new: b.calibrated_new,
      delta: b.delta_vs_v2,
      brier_old_contribution: b.brier_old_contribution,
      brier_new_contribution: b.brier_new_contribution,
      was_refit: b.was_refit,
      fillForwardSource: b.fillForwardSource,
    })),
    refitArrayCompact: {
      v2: r3.v2Buckets.map((b) => Number(b.calibrated.toFixed(4))),
      R3: r3.refitBuckets.map((b) => Number(b.calibrated.toFixed(4))),
    },
    acceptanceConstraints: {
      c1_monotonicity_pass: r3.acceptance.c1_monotonicity_pass,
      c1_violations: r3.acceptance.c1_violations,
      c2_no_over_extrapolation_pass: r3.acceptance.c2_no_over_extrapolation_pass,
      c2_threshold: r3.acceptance.c2_threshold,
      c2_worst_bucket: r3.acceptance.c2_worst_bucket,
      c2_violating_buckets: r3.acceptance.c2_violating_buckets,
      c3_brier_improvement_pass: r3.acceptance.c3_brier_improvement_pass,
      c3_threshold: r3.acceptance.c3_threshold,
      c3_brier_v2: r3.acceptance.c3_brier_v2,
      c3_brier_new: r3.acceptance.c3_brier_new,
      c3_delta: r3.acceptance.c3_delta,
      c3_sample_n: r3.acceptance.c3_sample_n,
      c4_structural_life_pass: r3.acceptance.c4_structural_life_pass,
      c4_top_bucket_calibrated_new: r3.acceptance.c4_top_bucket_calibrated_new,
      c4_top_non_empty_idx: r3.acceptance.c4_top_non_empty_idx,
      c4_second_non_empty_idx: r3.acceptance.c4_second_non_empty_idx,
      c4_top_two_union_n: r3.acceptance.c4_top_two_union_n,
      c4_median_market_prob_fair_top_two:
        r3.acceptance.c4_median_market_prob_fair_top_two,
      c4_headroom: r3.acceptance.c4_headroom,
      c4_headroom_threshold: r3.acceptance.c4_headroom_threshold,
      c5_sample_size_pass: r3.acceptance.c5_sample_size_pass,
      c5_total_n: r3.acceptance.c5_total_n,
      c5_total_n_threshold: r3.acceptance.c5_total_n_threshold,
      c5_total_n_pass: r3.acceptance.c5_total_n_pass,
      c5_top_two_n: r3.acceptance.c5_top_two_n,
      c5_top_two_n_threshold: r3.acceptance.c5_top_two_n_threshold,
      c5_top_two_n_pass: r3.acceptance.c5_top_two_n_pass,
    },
    overallVerdict: {
      allPass: r3.allPass,
      passing: r3.passing,
      failing: r3.failing,
    },
    surfacedPickDelta,
    tierAVolumeReviews,
    tier_a_volume_review_required,
    decision: { verdict, action },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  console.log(
    `\n=== validateGateChange — proposal=${args.proposal} window=[${args.windowStart}, ${args.windowEnd}) ===\n`
  );

  const baseCfg = baselineConfig();
  const { cfg: propCfg, r3 } = await applyProposal(args.proposal, baseCfg);

  // Load candidate_bets in the frozen window (created_at-based).
  const rawCandidates = await db
    .select({
      id: candidateBetsTable.id,
      gameKey: candidateBetsTable.gameKey,
      league: candidateBetsTable.league,
      marketType: candidateBetsTable.marketType,
      side: candidateBetsTable.side,
      publishOdds: candidateBetsTable.publishOdds,
      publishLine: candidateBetsTable.publishLine,
      modelProbRaw: candidateBetsTable.modelProbRaw,
      marketProbFair: candidateBetsTable.marketProbFair,
      edge: candidateBetsTable.edge,
      ev: candidateBetsTable.ev,
      rankScore: candidateBetsTable.rankScore,
      tier: candidateBetsTable.tier,
      marketQuality: candidateBetsTable.marketQuality,
      selectionReason: candidateBetsTable.selectionReason,
      createdAt: candidateBetsTable.createdAt,
    })
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
  const snapByKey = new Map<string, SnapshotForReplay>();
  const CHUNK = 500;
  for (let i = 0; i < gameKeys.length; i += CHUNK) {
    const slice = gameKeys.slice(i, i + CHUNK);
    const rows = await db
      .select({
        gameKey: gameSnapshotsTable.gameKey,
        status: gameSnapshotsTable.status,
        homeScore: gameSnapshotsTable.homeScore,
        awayScore: gameSnapshotsTable.awayScore,
        publishSpread: gameSnapshotsTable.publishSpread,
        publishTotal: gameSnapshotsTable.publishTotal,
        homeCloseMl: gameSnapshotsTable.homeCloseMl,
        awayCloseMl: gameSnapshotsTable.awayCloseMl,
        closeSpread: gameSnapshotsTable.closeSpread,
        closeSpreadLine: gameSnapshotsTable.closeSpreadLine,
        closeAwaySpreadLine: gameSnapshotsTable.closeAwaySpreadLine,
        closeTotal: gameSnapshotsTable.closeTotal,
        closeOverLine: gameSnapshotsTable.closeOverLine,
        closeUnderLine: gameSnapshotsTable.closeUnderLine,
      })
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
      persistedTier: c.tier as Tier,
      persistedSelectionReason: c.selectionReason,
      marketQuality: parseFloat(c.marketQuality),
      modelProbRaw: parseFloat(c.modelProbRaw),
      marketProbFair: parseFloat(c.marketProbFair),
    };

    const baseOut =
      args.proposal === "R4-open-all"
        ? replayPersistedBaseline(replayInput)
        : replayAssignTier(replayInput, baseCfg);
    const propOut = replayAssignTier(replayInput, propCfg);

    s.baselineRawTier[baseOut.rawTier]++;
    s.proposedRawTier[propOut.rawTier]++;
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

  // R3-specific augmentations: refit cohorts/buckets/acceptance constraints
  // (Section 5b) and surfaced-pick delta report (Section 5c).
  const r3Report = r3 != null ? buildR3ReportSection(r3, summaries) : undefined;

  const report = {
    proposal: args.proposal,
    window: { start: args.windowStart, end: args.windowEnd },
    runAt: new Date().toISOString(),
    candidatesScanned: rawCandidates.length,
    snapshotsLoaded: snapByKey.size,
    perMarket: summaries,
    newlySurfacedRows,
    ...(r3Report ? { r3: r3Report } : {}),
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

  if (r3) {
    console.log("\n=== R3 nhl_spread isotonic refit ===");
    console.log(
      `Cohorts: A graded n=${r3.cohorts.cohortA_graded_n} | B graded n=${r3.cohorts.cohortB_graded_n} | combined=${r3.cohorts.combined_n} (deploy_ts=${r3.cohorts.deployTimestampUtc})`
    );
    console.log(
      `Refit array (R3) vs v2:\n  v2: [${r3.v2Buckets.map((b) => b.calibrated.toFixed(4)).join(", ")}]\n  R3: [${r3.refitBuckets.map((b) => b.calibrated.toFixed(4)).join(", ")}]`
    );
    console.log(`PAV iterations: ${r3.pavIterations} (converged=${r3.pavConverged})`);
    console.log("Acceptance constraints:");
    const a = r3.acceptance;
    console.log(`  C1 monotonicity:           ${a.c1_monotonicity_pass ? "PASS" : "FAIL"}`);
    console.log(
      `  C2 no over-extrapolation:  ${a.c2_no_over_extrapolation_pass ? "PASS" : "FAIL"} (worst |delta|=${Math.abs(a.c2_worst_bucket.delta).toFixed(4)} at idx ${a.c2_worst_bucket.idx}, threshold=${a.c2_threshold})`
    );
    console.log(
      `  C3 Brier improvement:      ${a.c3_brier_improvement_pass ? "PASS" : "FAIL"} (brier_v2=${a.c3_brier_v2.toFixed(5)}, brier_new=${a.c3_brier_new.toFixed(5)}, delta=${a.c3_delta.toFixed(5)}, threshold=${a.c3_threshold})`
    );
    console.log(
      `  C4 structural life:        ${a.c4_structural_life_pass ? "PASS" : "FAIL"} (top_calibrated_new=${a.c4_top_bucket_calibrated_new?.toFixed(4) ?? "—"}, median_market_top2=${a.c4_median_market_prob_fair_top_two?.toFixed(4) ?? "—"}, headroom=${a.c4_headroom?.toFixed(4) ?? "—"}, threshold=${a.c4_headroom_threshold})`
    );
    console.log(
      `  C5 sample size floors:     ${a.c5_sample_size_pass ? "PASS" : "FAIL"} (total_n=${a.c5_total_n}/${a.c5_total_n_threshold}, top_two_n=${a.c5_top_two_n}/${a.c5_top_two_n_threshold})`
    );
    console.log(
      `Overall: passing=[${r3.passing.join(", ")}] failing=[${r3.failing.join(", ")}]`
    );
    const decisionVerdict =
      r3Report && (r3Report["decision"] as { verdict: string } | undefined)?.verdict;
    console.log(`Decision: ${decisionVerdict ?? "?"}`);
  }

  console.log(`\nWrote full report to: ${outPath}`);
  console.log("READ-ONLY — no DB writes performed.\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
