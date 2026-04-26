/**
 * Markdown renderer for the internal calibration-review report.
 *
 * Pure function over a CohortReport. Designed for paste-friendly review:
 * one section per league_market, side-by-side PRE/POST cohort comparison
 * for clean rows, an explicit FLAGGED panel so contaminated rows are
 * VISIBLE (not hidden), and a per-bucket monotonicity table for the
 * largest clean cohort.
 */

import type { BucketStats } from "./modelWatchAggregator";
import type { MonotonicityReport } from "./monotonicity";
import type { CohortBucketReport, CohortReport } from "./cohortAnalysis";

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtPct2(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function fmtNum4(x: number): string {
  return x.toFixed(4);
}

function fmtNullable(x: number | null, fmt: (n: number) => string): string {
  return x == null ? "—" : fmt(x);
}

function statsRowCells(s: BucketStats): string[] {
  return [
    `${s.samples}`,
    `${s.wins}-${s.losses}-${s.pushes}`,
    `${s.pending}`,
    fmtPct(s.winRate),
    fmtPct2(s.roi),
    fmtNum4(s.avgEdge),
    fmtNum4(s.avgEv),
    fmtPct(s.clvHitRate),
    `${fmtNum4(s.avgClv)} (${s.clvSampleSize})`,
  ];
}

function renderStatsTable(buckets: readonly CohortBucketReport[]): string[] {
  const lines: string[] = [];
  lines.push(
    "| Cohort | Quality | Samples | W-L-P | Pending | Win% | ROI | Avg edge | Avg EV | Brier (model) | Brier (mkt) | Brier skill | CLV+% | Avg CLV (n) |",
  );
  lines.push(
    "| --- | --- | ---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const b of buckets) {
    const cells = [
      b.cohort,
      b.quality,
      ...statsRowCells(b.stats).slice(0, 6), // samples, W-L-P, pending, win%, roi, avgEdge
      fmtNum4(b.stats.avgEv),
      fmtNullable(b.brierModel, fmtNum4),
      fmtNullable(b.brierMarket, fmtNum4),
      fmtNullable(b.brierSkill, fmtPct2),
      fmtPct(b.stats.clvHitRate),
      `${fmtNum4(b.stats.avgClv)} (${b.stats.clvSampleSize})`,
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines;
}

function renderMonotonicityPanel(
  cohortLabel: string,
  m: MonotonicityReport,
): string[] {
  const lines: string[] = [];
  lines.push(`### Edge → win rate monotonicity (${cohortLabel})`);
  lines.push("");
  if (m.buckets.length === 0) {
    lines.push("_No rows with finite edge in this cohort._");
    return lines;
  }
  lines.push(
    "| Bucket | n | Edge range | W-L-P | Pending | Win% | ROI | Avg CLV (n) |",
  );
  lines.push(
    "| --- | ---: | :---: | :---: | ---: | ---: | ---: | ---: |",
  );
  for (const b of m.buckets) {
    const labelSuffix =
      b.index === 1 ? " (top edge)" : b.index === m.buckets.length ? " (lowest)" : "";
    lines.push(
      `| ${b.index}${labelSuffix} | ${b.n} | ${fmtNum4(b.minEdge)}–${fmtNum4(b.maxEdge)} | ${b.stats.wins}-${b.stats.losses}-${b.stats.pushes} | ${b.stats.pending} | ${fmtPct(b.stats.winRate)} | ${fmtPct2(b.stats.roi)} | ${fmtNum4(b.stats.avgClv)} (${b.stats.clvSampleSize}) |`,
    );
  }
  lines.push("");
  const monoMark = (b: boolean) => (b ? "yes" : "**no — inversion**");
  const corrMark = (c: number | null) => (c == null ? "—" : c.toFixed(3));
  lines.push(
    `Monotonic win rate: ${monoMark(m.isMonotonicWinRate)}  ·  Monotonic ROI: ${monoMark(m.isMonotonicRoi)}  ·  edge↔winRate corr: ${corrMark(m.edgeWinRateCorrelation)}  ·  edge↔ROI corr: ${corrMark(m.edgeRoiCorrelation)}`,
  );
  if (m.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of m.warnings) lines.push(`- ${w}`);
  }
  return lines;
}

export function renderCohortReportMarkdown(report: CohortReport): string {
  const lines: string[] = [];
  lines.push("# Internal calibration review");
  lines.push("");
  lines.push(
    `_Generated ${report.generatedAt}. Total rows: ${report.totalRows}. Flagged rows: ${report.totalFlagged}._`,
  );
  lines.push("");
  if (Object.keys(report.cutoffs).length > 0) {
    lines.push("Cutoffs (PRE = date < cutoff):");
    for (const [league, cutoff] of Object.entries(report.cutoffs)) {
      lines.push(`- **${league}**: ${cutoff}`);
    }
    lines.push("");
  }
  lines.push(
    "Flagged rows are displayed as a separate `flagged` quality bucket — they are NOT silently removed.",
  );
  lines.push("");

  if (report.buckets.length === 0) {
    lines.push("_No rows in any cohort._");
    return lines.join("\n");
  }

  // Group buckets by league_market for per-market sections.
  const grouped = new Map<string, CohortBucketReport[]>();
  for (const b of report.buckets) {
    const k = `${b.league}_${b.market}`;
    const list = grouped.get(k) ?? [];
    list.push(b);
    grouped.set(k, list);
  }

  for (const [marketKey, buckets] of grouped) {
    lines.push(`## ${marketKey}`);
    lines.push("");
    lines.push(...renderStatsTable(buckets));
    lines.push("");

    // Render a monotonicity panel for EVERY (cohort, quality) bucket so
    // PRE↔POST and clean↔flagged comparisons are visible side-by-side.
    // The JSON payload always carries the full per-bucket monotonicity;
    // the markdown mirrors that completeness for paste-friendly review.
    for (const b of buckets) {
      const label = `${b.cohort} ${b.quality}`;
      lines.push(...renderMonotonicityPanel(label, b.monotonicity));
      lines.push("");
    }
  }

  return lines.join("\n");
}
