/**
 * Pure aggregation helpers for the Model-Watch admin scoreboard.
 * Kept independent of the DB so it can be unit-tested with fixtures.
 *
 * Math conventions match validatePicks.computeValidationMetrics:
 *   - winRate = wins / (wins + losses) — pushes excluded
 *   - roi    = unitsWon / resolvedCount — pushes counted as 0u, pending excluded
 *   - clv    = mean of clv_implied_delta over rows with non-null delta and
 *              |delta| <= MAX_CLV_DELTA (0.20) to filter obviously-corrupt
 *              snapshot data — same threshold the public metrics use.
 */

import { americanToDecimal } from "./marketProb";

/** Subset of model_watch_results columns the aggregator needs. */
export interface AggregatorRow {
  league: string;
  market: string;
  tier: string;
  publishOdds: string | number;
  edge: string | number;
  ev: string | number;
  result: string;
  clvImpliedDelta: string | number | null;
  // Optional row identity used only when the caller asks for per-bucket
  // "recent picks" via aggregateByLeagueMarket(rows, keys, { recentLimit }).
  // Aggregate math never reads these.
  date?: string;
  gameKey?: string;
  pick?: string;
}

/**
 * One raw row included in a bucket's `recent` slice. Mirrors the columns
 * the admin "Recent picks" table renders so the UI does not need to
 * reach into model_watch_results directly.
 */
export interface RecentPick {
  date: string;
  gameKey: string;
  tier: string;
  pick: string;
  publishOdds: number;
  result: string;
  clvImpliedDelta: number | null;
}

export interface BucketStats {
  samples: number;
  resolved: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  winRate: number;
  roi: number;
  unitsWon: number;
  avgEdge: number;
  avgEv: number;
  clvSampleSize: number;
  clvHitRate: number;
  avgClv: number;
}

export interface MarketBucket {
  league: string;
  market: string;
  total: BucketStats;
  byTier: Record<"A" | "B" | "C", BucketStats>;
  /**
   * Up to `recentLimit` raw rows for this league_market bucket, in the
   * order the aggregator received them. Only set when
   * aggregateByLeagueMarket is called with `{ recentLimit }`. Caller is
   * responsible for ordering input rows (typically date desc).
   */
  recent?: RecentPick[];
}

export interface AggregateOptions {
  /** When set, attach up to N raw rows per bucket as `recent`. */
  recentLimit?: number;
}

const MAX_CLV_DELTA = 0.2;

function asNum(x: string | number): number {
  return typeof x === "number" ? x : parseFloat(x);
}

function asNumOrNull(x: string | number | null): number | null {
  if (x == null) return null;
  const n = typeof x === "number" ? x : parseFloat(x);
  return Number.isFinite(n) ? n : null;
}

function emptyStats(): BucketStats {
  return {
    samples: 0,
    resolved: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    pending: 0,
    winRate: 0,
    roi: 0,
    unitsWon: 0,
    avgEdge: 0,
    avgEv: 0,
    clvSampleSize: 0,
    clvHitRate: 0,
    avgClv: 0,
  };
}

/** Aggregate a flat list of rows into one BucketStats. */
export function aggregateRows(rows: readonly AggregatorRow[]): BucketStats {
  const stats = emptyStats();
  if (rows.length === 0) return stats;

  let edgeSum = 0;
  let evSum = 0;
  let clvHits = 0;
  let clvSum = 0;

  for (const r of rows) {
    stats.samples++;
    edgeSum += asNum(r.edge);
    evSum += asNum(r.ev);

    if (r.result === "win") {
      stats.wins++;
      stats.resolved++;
      stats.unitsWon += americanToDecimal(asNum(r.publishOdds)) - 1;
    } else if (r.result === "loss") {
      stats.losses++;
      stats.resolved++;
      stats.unitsWon -= 1;
    } else if (r.result === "push") {
      stats.pushes++;
      stats.resolved++;
    } else {
      stats.pending++;
    }

    const clv = asNumOrNull(r.clvImpliedDelta);
    if (clv != null && Math.abs(clv) <= MAX_CLV_DELTA) {
      stats.clvSampleSize++;
      clvSum += clv;
      if (clv > 0) clvHits++;
    }
  }

  const decided = stats.wins + stats.losses;
  stats.winRate = decided > 0 ? stats.wins / decided : 0;
  stats.roi = stats.resolved > 0 ? stats.unitsWon / stats.resolved : 0;
  stats.avgEdge = stats.samples > 0 ? edgeSum / stats.samples : 0;
  stats.avgEv = stats.samples > 0 ? evSum / stats.samples : 0;
  stats.clvHitRate =
    stats.clvSampleSize > 0 ? clvHits / stats.clvSampleSize : 0;
  stats.avgClv = stats.clvSampleSize > 0 ? clvSum / stats.clvSampleSize : 0;

  return stats;
}

/**
 * Group rows by `${league}_${market}` and produce a bucket per group.
 * `marketKeys` is the registry of markets that should appear even if they
 * have zero graded rows (so a brand-new Model-Watch entry shows up as an
 * empty bucket rather than silently disappearing).
 */
export function aggregateByLeagueMarket(
  rows: readonly AggregatorRow[],
  marketKeys: readonly string[],
  opts: AggregateOptions = {}
): MarketBucket[] {
  const groups = new Map<string, AggregatorRow[]>();
  for (const r of rows) {
    const key = `${r.league}_${r.market}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const allKeys = new Set<string>([...marketKeys, ...groups.keys()]);
  const out: MarketBucket[] = [];

  const wantsRecent =
    typeof opts.recentLimit === "number" && opts.recentLimit > 0;

  for (const key of Array.from(allKeys).sort()) {
    const groupRows = groups.get(key) ?? [];
    const [league, ...rest] = key.split("_");
    const market = rest.join("_");

    const byTier: Record<"A" | "B" | "C", BucketStats> = {
      A: aggregateRows(groupRows.filter((r) => r.tier === "A")),
      B: aggregateRows(groupRows.filter((r) => r.tier === "B")),
      C: aggregateRows(groupRows.filter((r) => r.tier === "C")),
    };

    const bucket: MarketBucket = {
      league,
      market,
      total: aggregateRows(groupRows),
      byTier,
    };

    if (wantsRecent) {
      bucket.recent = groupRows
        .slice(0, opts.recentLimit)
        .map(toRecentPick);
    }

    out.push(bucket);
  }

  return out;
}

function toRecentPick(r: AggregatorRow): RecentPick {
  return {
    date: r.date ?? "",
    gameKey: r.gameKey ?? "",
    tier: r.tier,
    pick: r.pick ?? "",
    publishOdds: asNum(r.publishOdds),
    result: r.result,
    clvImpliedDelta: asNumOrNull(r.clvImpliedDelta),
  };
}

/**
 * Public Model-Watch summary shape, as returned by
 * `GET /performance/model-watch` (sans `windowDays`, which the route owns).
 *
 * Keep this intentionally narrow — the public Performance page surfaces
 * only Leans-graded / Win Rate / Mean CLV / Active markets. ROI, units,
 * per-tier and per-market breakdowns are admin-only and live on
 * `/admin/model-watch/performance`.
 */
export interface PublicModelWatchSummary {
  leansGraded: number;
  winRate: number;
  meanClv: number;
  clvSampleSize: number;
  activeMarkets: number;
  totalRegistryMarkets: number;
}

/**
 * Build the public Model-Watch strip payload from a flat list of
 * already-window-filtered, already-resolved rows and the registry.
 *
 * - leansGraded mirrors `aggregateRows().resolved` (wins + losses + pushes)
 *   so the public count matches the same denominator the admin scoreboard
 *   uses for ROI.
 * - winRate / meanClv / clvSampleSize reuse `aggregateRows` so the math
 *   (push exclusion, |delta| <= 0.20 CLV filter) is identical to the
 *   admin scoreboard. The two surfaces can never silently diverge.
 * - activeMarkets counts distinct `${league}_${market}` keys present in
 *   the rows that ALSO appear as truthy entries in the registry. A row
 *   from a market that has been demoted out of the registry is ignored
 *   for this count (it would otherwise inflate the "N / M" headline).
 * - totalRegistryMarkets = count of truthy registry entries.
 */
export function summarizeModelWatchRows(
  rows: readonly AggregatorRow[],
  registry: Partial<Record<string, boolean>>,
): PublicModelWatchSummary {
  const stats = aggregateRows(rows);

  let totalRegistryMarkets = 0;
  for (const v of Object.values(registry)) {
    if (v) totalRegistryMarkets++;
  }

  const activeKeys = new Set<string>();
  for (const r of rows) {
    const key = `${r.league}_${r.market}`;
    if (registry[key]) activeKeys.add(key);
  }

  return {
    leansGraded: stats.resolved,
    winRate: stats.winRate,
    meanClv: stats.avgClv,
    clvSampleSize: stats.clvSampleSize,
    activeMarkets: activeKeys.size,
    totalRegistryMarkets,
  };
}

/**
 * Render a Model-Watch report as a Markdown string. Useful for pasting
 * into review docs / decision threads without bringing up the JSON
 * payload.
 */
export function renderMarkdownReport(buckets: readonly MarketBucket[]): string {
  const lines: string[] = [];
  lines.push("# Model-Watch internal scoreboard");
  lines.push("");
  lines.push(
    "Internal-only grading of markets in `MARKET_MODEL_WATCH_ONLY`. " +
      "These rows do NOT enter the public Performance / History numbers."
  );
  lines.push("");

  if (buckets.length === 0) {
    lines.push("_No graded rows yet._");
    return lines.join("\n");
  }

  for (const b of buckets) {
    lines.push(`## ${b.league.toUpperCase()} ${b.market}`);
    lines.push("");
    lines.push("| Bucket | Samples | W-L-P | Pending | Win% | ROI | Units | Avg edge | CLV+% | Avg CLV (n) |");
    lines.push("| --- | ---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    const renderRow = (label: string, s: BucketStats) =>
      `| ${label} | ${s.samples} | ${s.wins}-${s.losses}-${s.pushes} | ${s.pending} | ${(s.winRate * 100).toFixed(1)}% | ${(s.roi * 100).toFixed(2)}% | ${s.unitsWon.toFixed(2)} | ${s.avgEdge.toFixed(4)} | ${(s.clvHitRate * 100).toFixed(1)}% | ${s.avgClv.toFixed(4)} (${s.clvSampleSize}) |`;
    lines.push(renderRow("Overall", b.total));
    lines.push(renderRow("Tier A", b.byTier.A));
    lines.push(renderRow("Tier B", b.byTier.B));
    lines.push(renderRow("Tier C", b.byTier.C));
    lines.push("");
  }

  return lines.join("\n");
}
