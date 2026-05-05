/**
 * Internal calibration-review aggregator.
 *
 * Given the raw set of evaluation rows (with NO public-cutoff filter and NO
 * data_quality filter applied by the caller), produces a structured report
 * split by:
 *
 *   1. league_market   — same grouping the rest of the system uses
 *   2. surface status  — official | model_watch | suppressed
 *   3. cohort          — "PRE" (date < PUBLIC_TRACK_RECORD_CUTOFFS[league])
 *                        or "POST". Leagues without a cutoff are all POST.
 *   4. data quality    — "clean" (data_quality IS NULL) or "flagged"
 *                        (any non-null label, e.g. "contaminated_ingest"
 *                        or "pre_fix_contaminated"). Per the diagnosis
 *                        requirement, flagged rows are SHOWN, not removed.
 *
 * Each bucket reports the standard aggregator stats (CLV / ROI / win rate
 * / avg edge / avg EV — via aggregateRows), plus:
 *
 *   - brierModel   — Brier on `model_prob_calibrated` vs win/loss outcome
 *   - brierMarket  — Brier on `market_prob_fair`        vs win/loss outcome
 *   - brierSkill   — 1 - brierModel/brierMarket; positive ⇒ model beats
 *                    the no-vig market price as a probability forecast
 *   - monotonicity — equal-frequency edge buckets with per-bucket win rate
 *                    / ROI / CLV, and edge↔winRate / edge↔ROI correlations
 *
 * Pure module: no DB / env / time-of-day reads other than `Date.now()` for
 * the response timestamp. The caller does the SQL.
 */

import {
  aggregateRows,
  type AggregatorRow,
  type BucketStats,
} from "./modelWatchAggregator";
import { computeBrierScore, computeBrierSkillScore } from "./brierScore";
import {
  computeMonotonicityReport,
  type MonotonicityReport,
} from "./monotonicity";

export type CohortKey = "PRE" | "POST";
export type QualityKey = "clean" | "flagged";

/**
 * Evaluation-row shape needed by the cohort analyzer. Mirrors the columns
 * read off `evaluation_results` and related legacy sources during the rebuild.
 * Numeric columns are accepted as either string (the drizzle default for
 * `numeric`) or number, matching every other aggregator in this directory.
 */
export interface CohortInputRow extends AggregatorRow {
  /** Pick date, YYYY-MM-DD. Used for PRE / POST classification. */
  date: string;
  /** Surface lane the row belonged to at scoring time. */
  surfaceStatus: string;
  /** Calibrated model probability for the picked side, in [0, 1]. */
  modelProbCalibrated: string | number;
  /** No-vig market probability for the picked side, in [0, 1]. */
  marketProbFair: string | number;
  /** Audit label; null = clean for public surfaces. */
  dataQuality: string | null;
}

export interface CohortBucketReport {
  league: string;
  market: string;
  surfaceStatus: string;
  cohort: CohortKey;
  quality: QualityKey;
  /** The cutoff date used to derive cohort for this bucket; null when none. */
  cutoff: string | null;
  stats: BucketStats;
  brierModel: number | null;
  brierMarket: number | null;
  /** 1 - brierModel/brierMarket. Null when either Brier is null. */
  brierSkill: number | null;
  monotonicity: MonotonicityReport;
}

export interface CohortReport {
  generatedAt: string;
  totalRows: number;
  totalFlagged: number;
  /** Cutoffs that were consulted (only leagues that appeared in `rows`). */
  cutoffs: Record<string, string>;
  buckets: CohortBucketReport[];
}

export interface SummarizeCohortsOpts {
  /**
   * League → ISO date (YYYY-MM-DD). Rows with `date < cutoff` are PRE,
   * others are POST. Leagues missing from this map are all POST.
   */
  cutoffs: Partial<Record<string, string>>;
  /** Equal-frequency edge buckets for the monotonicity report. */
  monotonicityBuckets?: number;
}

function asNumOrNull(x: string | number): number | null {
  const n = typeof x === "number" ? x : parseFloat(x);
  return Number.isFinite(n) ? n : null;
}

function classifyCohort(rowDate: string, cutoff: string | null): CohortKey {
  if (!cutoff) return "POST";
  // Lexicographic compare works because both are strict YYYY-MM-DD.
  return rowDate < cutoff ? "PRE" : "POST";
}

function classifyQuality(dataQuality: string | null): QualityKey {
  return dataQuality == null ? "clean" : "flagged";
}

function rowsToBrierInputs(
  rows: readonly CohortInputRow[],
  probField: "modelProbCalibrated" | "marketProbFair",
): { prob: number; outcome: 0 | 1 }[] {
  const out: { prob: number; outcome: 0 | 1 }[] = [];
  for (const r of rows) {
    if (r.result !== "win" && r.result !== "loss") continue;
    const p = asNumOrNull(r[probField]);
    if (p == null) continue;
    out.push({ prob: p, outcome: r.result === "win" ? 1 : 0 });
  }
  return out;
}

export function summarizeCohorts(
  rows: readonly CohortInputRow[],
  opts: SummarizeCohortsOpts,
): CohortReport {
  const monoBuckets = opts.monotonicityBuckets ?? 4;
  const cutoffsUsed: Record<string, string> = {};

  type GroupKey = string; // `${league}_${market}|${surface}|${cohort}|${quality}`
  const groups = new Map<GroupKey, CohortInputRow[]>();
  let totalFlagged = 0;

  for (const r of rows) {
    const cutoff = opts.cutoffs[r.league] ?? null;
    if (cutoff) cutoffsUsed[r.league] = cutoff;
    const cohort = classifyCohort(r.date, cutoff);
    const quality = classifyQuality(r.dataQuality);
    if (quality === "flagged") totalFlagged++;
    const key: GroupKey = `${r.league}_${r.market}|${r.surfaceStatus}|${cohort}|${quality}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const buckets: CohortBucketReport[] = [];
  for (const [key, groupRows] of groups) {
    const [marketKey, surfaceStatus, cohort, quality] = key.split("|") as [
      string,
      string,
      CohortKey,
      QualityKey,
    ];
    const usIdx = marketKey.indexOf("_");
    const league = usIdx >= 0 ? marketKey.slice(0, usIdx) : marketKey;
    const market = usIdx >= 0 ? marketKey.slice(usIdx + 1) : "";
    const cutoff = opts.cutoffs[league] ?? null;
    const stats = aggregateRows(groupRows);
    const brierModel = computeBrierScore(
      rowsToBrierInputs(groupRows, "modelProbCalibrated"),
    );
    const brierMarket = computeBrierScore(
      rowsToBrierInputs(groupRows, "marketProbFair"),
    );
    const brierSkill = computeBrierSkillScore(brierModel, brierMarket);
    const monotonicity = computeMonotonicityReport(groupRows, monoBuckets);
    buckets.push({
      league,
      market,
      surfaceStatus,
      cohort,
      quality,
      cutoff,
      stats,
      brierModel,
      brierMarket,
      brierSkill,
      monotonicity,
    });
  }

  // Stable order: league_market asc, official before model_watch before
  // suppressed, POST before PRE (POST is the more important slice), clean
  // before flagged.
  buckets.sort((a, b) => {
    const ka = `${a.league}_${a.market}`;
    const kb = `${b.league}_${b.market}`;
    if (ka !== kb) return ka < kb ? -1 : 1;
    const surfaceOrder = (s: string): number =>
      s === "official" ? 0 : s === "model_watch" ? 1 : s === "suppressed" ? 2 : 3;
    if (a.surfaceStatus !== b.surfaceStatus) {
      return surfaceOrder(a.surfaceStatus) - surfaceOrder(b.surfaceStatus);
    }
    if (a.cohort !== b.cohort) return a.cohort === "POST" ? -1 : 1;
    if (a.quality !== b.quality) return a.quality === "clean" ? -1 : 1;
    return 0;
  });

  return {
    generatedAt: new Date().toISOString(),
    totalRows: rows.length,
    totalFlagged,
    cutoffs: cutoffsUsed,
    buckets,
  };
}
