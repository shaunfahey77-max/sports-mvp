import { test } from "node:test";
import assert from "node:assert/strict";

import { renderCohortReportMarkdown } from "../cohortReportMarkdown";
import type {
  CohortBucketReport,
  CohortReport,
  CohortKey,
  QualityKey,
} from "../cohortAnalysis";
import type { BucketStats } from "../modelWatchAggregator";
import type {
  MonotonicityBucket,
  MonotonicityReport,
} from "../monotonicity";

function stats(overrides: Partial<BucketStats> = {}): BucketStats {
  return {
    samples: 10,
    resolved: 9,
    wins: 5,
    losses: 4,
    pushes: 0,
    pending: 1,
    winRate: 0.5556,
    roi: 0.0234,
    unitsWon: 0.21,
    avgEdge: 0.0512,
    avgEv: 0.0341,
    clvSampleSize: 8,
    clvHitRate: 0.625,
    avgClv: 0.0089,
    ...overrides,
  };
}

function monoBucket(overrides: Partial<MonotonicityBucket> = {}): MonotonicityBucket {
  return {
    index: 1,
    n: 5,
    minEdge: 0.04,
    maxEdge: 0.08,
    stats: stats({ samples: 5, resolved: 5, wins: 3, losses: 2, pending: 0 }),
    ...overrides,
  };
}

function monoReport(
  overrides: Partial<MonotonicityReport> = {},
): MonotonicityReport {
  return {
    buckets: [
      monoBucket({ index: 1, minEdge: 0.05, maxEdge: 0.1 }),
      monoBucket({
        index: 2,
        minEdge: 0.0,
        maxEdge: 0.05,
        stats: stats({ samples: 5, resolved: 5, wins: 2, losses: 3, pending: 0 }),
      }),
    ],
    isMonotonicWinRate: true,
    isMonotonicRoi: true,
    edgeWinRateCorrelation: 0.42,
    edgeRoiCorrelation: 0.31,
    warnings: [],
    ...overrides,
  };
}

function bucket(
  league: string,
  market: string,
  cohort: CohortKey,
  quality: QualityKey,
  overrides: Partial<CohortBucketReport> = {},
): CohortBucketReport {
  return {
    league,
    market,
    cohort,
    quality,
    cutoff: cohort === "PRE" ? "2026-04-12" : "2026-04-12",
    stats: stats(),
    brierModel: 0.2456,
    brierMarket: 0.2501,
    brierSkill: 0.018,
    monotonicity: monoReport(),
    ...overrides,
  };
}

function report(overrides: Partial<CohortReport> = {}): CohortReport {
  return {
    generatedAt: "2026-04-29T10:00:00.000Z",
    totalRows: 200,
    totalFlagged: 12,
    cutoffs: { nhl: "2026-04-12" },
    buckets: [],
    ...overrides,
  };
}

test("renderCohortReportMarkdown: empty buckets renders the no-rows stub but still emits header", () => {
  const md = renderCohortReportMarkdown(report({ totalRows: 0, totalFlagged: 0, cutoffs: {} }));

  assert.match(md, /^# Internal calibration review/);
  assert.match(md, /Generated 2026-04-29T10:00:00\.000Z/);
  assert.match(md, /Total rows: 0/);
  assert.match(md, /Flagged rows: 0/);
  assert.match(md, /_No rows in any cohort\._/);
  // No cutoffs section when the map is empty.
  assert.ok(!md.includes("Cutoffs (PRE = date < cutoff):"));
});

test("renderCohortReportMarkdown: cutoffs section renders one line per league", () => {
  const md = renderCohortReportMarkdown(
    report({ cutoffs: { nhl: "2026-04-12", nba: "2026-04-28" } }),
  );

  assert.ok(md.includes("Cutoffs (PRE = date < cutoff):"));
  assert.ok(md.includes("- **nhl**: 2026-04-12"));
  assert.ok(md.includes("- **nba**: 2026-04-28"));
});

test("renderCohortReportMarkdown: groups buckets by ${league}_${market} into one section per market", () => {
  const md = renderCohortReportMarkdown(
    report({
      buckets: [
        bucket("nhl", "spread", "POST", "clean"),
        bucket("nhl", "spread", "PRE", "clean"),
        bucket("nba", "spread", "POST", "clean"),
      ],
    }),
  );

  // One H2 per market key, exactly two distinct sections.
  const sections = md.match(/^## .+$/gm) ?? [];
  assert.deepEqual(sections.sort(), ["## nba_spread", "## nhl_spread"]);
});

test("renderCohortReportMarkdown: flagged-bucket disclaimer is always present so contaminated rows are visible", () => {
  const md = renderCohortReportMarkdown(report());

  assert.ok(
    md.includes(
      "Flagged rows are displayed as a separate `flagged` quality bucket — they are NOT silently removed.",
    ),
    "renderer must surface the flagged-rows-are-shown-not-hidden disclaimer",
  );
});

test("renderCohortReportMarkdown: stats table includes one row per bucket and the standard column header", () => {
  const md = renderCohortReportMarkdown(
    report({
      buckets: [
        bucket("nhl", "spread", "PRE", "clean"),
        bucket("nhl", "spread", "POST", "clean"),
        bucket("nhl", "spread", "POST", "flagged", {
          stats: stats({ samples: 3, resolved: 2, wins: 1, losses: 1 }),
          brierSkill: null,
        }),
      ],
    }),
  );

  // Header row must include the brier skill column we expose to reviewers.
  assert.ok(md.includes("| Brier skill | CLV+% |"));
  // Three data rows under the single nhl_spread section.
  assert.ok(md.includes("| PRE | clean |"));
  assert.ok(md.includes("| POST | clean |"));
  assert.ok(md.includes("| POST | flagged |"));
  // Null brier skill renders as the em-dash placeholder.
  assert.ok(md.includes("| — | "), "null brierSkill must render as '—'");
});

test("renderCohortReportMarkdown: monotonicity panel marks inversions explicitly so readers cannot miss them", () => {
  const inverted = monoReport({
    isMonotonicWinRate: false,
    isMonotonicRoi: false,
    edgeWinRateCorrelation: -0.5,
    edgeRoiCorrelation: -0.4,
    warnings: ["bucket 2 has only 3 resolved rows"],
  });
  const md = renderCohortReportMarkdown(
    report({
      buckets: [bucket("nhl", "spread", "POST", "clean", { monotonicity: inverted })],
    }),
  );

  assert.ok(
    md.includes("**no — inversion**"),
    "inversions must be visually flagged with bold + the word 'inversion'",
  );
  assert.ok(md.includes("Warnings:"), "monotonicity warnings list must render");
  assert.ok(md.includes("- bucket 2 has only 3 resolved rows"));
});

test("renderCohortReportMarkdown: monotonicity panel renders 'yes' for clean monotonicity", () => {
  const md = renderCohortReportMarkdown(
    report({ buckets: [bucket("nhl", "spread", "POST", "clean")] }),
  );

  assert.ok(
    md.includes("Monotonic win rate: yes"),
    "clean monotonic series must render as 'yes' (not bolded)",
  );
  assert.ok(md.includes("Monotonic ROI: yes"));
  assert.ok(!md.includes("**no — inversion**"));
});

test("renderCohortReportMarkdown: monotonicity panel labels the top and bottom edge buckets", () => {
  const md = renderCohortReportMarkdown(
    report({
      buckets: [
        bucket("nhl", "spread", "POST", "clean", {
          monotonicity: monoReport({
            buckets: [
              monoBucket({ index: 1, minEdge: 0.08, maxEdge: 0.12 }),
              monoBucket({ index: 2, minEdge: 0.04, maxEdge: 0.08 }),
              monoBucket({ index: 3, minEdge: 0.0, maxEdge: 0.04 }),
            ],
          }),
        }),
      ],
    }),
  );

  assert.ok(md.includes("| 1 (top edge) |"), "first bucket must be labelled '(top edge)'");
  assert.ok(md.includes("| 3 (lowest) |"), "last bucket must be labelled '(lowest)'");
  // Middle buckets get no suffix.
  assert.ok(md.includes("| 2 |"), "middle buckets carry no edge-position suffix");
});

test("renderCohortReportMarkdown: monotonicity panel handles empty bucket list gracefully", () => {
  const md = renderCohortReportMarkdown(
    report({
      buckets: [
        bucket("nhl", "spread", "POST", "clean", {
          monotonicity: monoReport({
            buckets: [],
            isMonotonicWinRate: true,
            isMonotonicRoi: true,
            edgeWinRateCorrelation: null,
            edgeRoiCorrelation: null,
          }),
        }),
      ],
    }),
  );

  assert.ok(md.includes("_No rows with finite edge in this cohort._"));
});

test("renderCohortReportMarkdown: null correlations render as em-dash, not 'null'", () => {
  const md = renderCohortReportMarkdown(
    report({
      buckets: [
        bucket("nhl", "spread", "POST", "clean", {
          monotonicity: monoReport({
            edgeWinRateCorrelation: null,
            edgeRoiCorrelation: null,
          }),
        }),
      ],
    }),
  );

  assert.ok(
    md.includes("edge↔winRate corr: —"),
    "null correlations must render as the em-dash placeholder",
  );
  assert.ok(md.includes("edge↔ROI corr: —"));
  assert.ok(!md.includes("null"));
});
