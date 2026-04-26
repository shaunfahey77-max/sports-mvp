/**
 * Pure rank/edge monotonicity report for the internal calibration-review
 * tool.
 *
 * Concept: if the model's edge signal is informative, sorting picks by edge
 * (descending) and slicing into equal-frequency buckets should produce a
 * monotonically non-increasing win-rate / ROI curve from bucket 1 (highest
 * edge) to bucket K (lowest edge). Any inversion is a calibration smell —
 * either edge is being computed on the wrong line, or the model's
 * probabilities don't track outcomes the way the displayed edge implies.
 *
 * This is a diagnostic, not a decision rule. Small samples are NOT
 * statistically significant; `warnings` flags buckets with too few resolved
 * picks for the analyst to read into the bucket's win rate.
 *
 * Reuses `aggregateRows` from `modelWatchAggregator` so per-bucket stats
 * are computed by the exact same math the rest of the system uses.
 */

import {
  aggregateRows,
  type AggregatorRow,
  type BucketStats,
} from "./modelWatchAggregator";

export interface MonotonicityBucket {
  /** 1-based bucket index. 1 = highest-edge slice. */
  index: number;
  /** Total rows in this bucket (incl. pending and pushes). */
  n: number;
  /** Edge range [minEdge, maxEdge] within this bucket. */
  minEdge: number;
  maxEdge: number;
  /** Same shape as every other aggregator output. */
  stats: BucketStats;
}

export interface MonotonicityReport {
  buckets: MonotonicityBucket[];
  /**
   * True iff bucket[i].winRate >= bucket[i+1].winRate for every consecutive
   * pair of buckets that have at least one decided (win or loss) row.
   * Buckets with zero decided rows are skipped from this check (they have
   * winRate = 0 by aggregator convention, which would otherwise produce
   * spurious inversions).
   */
  isMonotonicWinRate: boolean;
  /** Same idea, applied to ROI instead of win rate. */
  isMonotonicRoi: boolean;
  /**
   * Pearson correlation between each bucket's edge midpoint and its win
   * rate. Positive = higher-edge bucket has higher win rate (good).
   * Negative = inversion. Null when fewer than 2 decided buckets, or when
   * either series has zero variance.
   */
  edgeWinRateCorrelation: number | null;
  /** Same correlation against ROI. */
  edgeRoiCorrelation: number | null;
  /** Human-readable warnings (e.g. small bucket samples). */
  warnings: string[];
}

const DEFAULT_MIN_RESOLVED_PER_BUCKET = 5;

function asNum(x: string | number): number {
  return typeof x === "number" ? x : parseFloat(x);
}

/**
 * Rank x and y as numeric series and compute Pearson correlation on the
 * raw values. (Pearson is sufficient for this small-N diagnostic; we don't
 * need full Spearman with tie-handling here.) Returns null when either
 * series has zero variance.
 */
function pearsonCorrelation(
  xs: readonly number[],
  ys: readonly number[],
): number | null {
  const n = xs.length;
  if (n !== ys.length || n < 2) return null;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dxs = 0;
  let dys = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    dxs += dx * dx;
    dys += dy * dy;
  }
  if (dxs === 0 || dys === 0) return null;
  return num / Math.sqrt(dxs * dys);
}

export function computeMonotonicityReport(
  rows: readonly AggregatorRow[],
  bucketCount: number,
  opts?: { minResolvedPerBucket?: number },
): MonotonicityReport {
  const minResolved = opts?.minResolvedPerBucket ?? DEFAULT_MIN_RESOLVED_PER_BUCKET;
  const warnings: string[] = [];

  const ranked = rows
    .map((r) => ({ row: r, edge: asNum(r.edge) }))
    .filter((x) => Number.isFinite(x.edge))
    .sort((a, b) => b.edge - a.edge);

  if (ranked.length === 0 || bucketCount < 2) {
    return {
      buckets: [],
      isMonotonicWinRate: true,
      isMonotonicRoi: true,
      edgeWinRateCorrelation: null,
      edgeRoiCorrelation: null,
      warnings,
    };
  }

  const n = ranked.length;
  const buckets: MonotonicityBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const start = Math.floor((i * n) / bucketCount);
    const end = Math.floor(((i + 1) * n) / bucketCount);
    if (start === end) continue;
    const slice = ranked.slice(start, end);
    const stats = aggregateRows(slice.map((x) => x.row));
    buckets.push({
      index: i + 1,
      n: slice.length,
      minEdge: slice[slice.length - 1].edge,
      maxEdge: slice[0].edge,
      stats,
    });
    if (stats.resolved < minResolved) {
      warnings.push(
        `bucket ${i + 1} has only ${stats.resolved} resolved sample(s); win-rate / ROI not statistically meaningful`,
      );
    }
  }

  const decidedBuckets = buckets.filter(
    (b) => b.stats.wins + b.stats.losses > 0,
  );

  let isMonotonicWinRate = true;
  let isMonotonicRoi = true;
  for (let i = 0; i < decidedBuckets.length - 1; i++) {
    if (decidedBuckets[i].stats.winRate < decidedBuckets[i + 1].stats.winRate) {
      isMonotonicWinRate = false;
    }
    if (decidedBuckets[i].stats.roi < decidedBuckets[i + 1].stats.roi) {
      isMonotonicRoi = false;
    }
  }

  const edgeMidpoints = decidedBuckets.map(
    (b) => (b.minEdge + b.maxEdge) / 2,
  );
  const winRates = decidedBuckets.map((b) => b.stats.winRate);
  const rois = decidedBuckets.map((b) => b.stats.roi);

  const edgeWinRateCorrelation = pearsonCorrelation(edgeMidpoints, winRates);
  const edgeRoiCorrelation = pearsonCorrelation(edgeMidpoints, rois);

  return {
    buckets,
    isMonotonicWinRate,
    isMonotonicRoi,
    edgeWinRateCorrelation,
    edgeRoiCorrelation,
    warnings,
  };
}
