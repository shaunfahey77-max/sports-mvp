import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModelWatchStrip } from "@/pages/Performance";
import type { ModelWatchSummary } from "@workspace/api-client-react";

// Render-level tests for the Model Watch strip on the Performance page.
//
// As of Task #35 the strip has been reshaped from a 4-tile hero grid
// into a live evaluation lane:
//   - data-testid="model-watch-strip" still anchors the section
//   - heading "Model Watch — Live Evaluation Lane" + BETA pill kept
//   - lead copy is the merged "Evaluation cohort … / Not a track
//     record. Does not affect Official numbers." pair (the prior
//     "does not count toward Official performance or history" line
//     was folded into this — there is no second disclaimer)
//   - window / leans graded / active markets render as inline scope
//     chips, not hero tiles
//   - metrics are a two-line readout: Mean CLV (primary, signed,
//     with n=… sample size) and Win rate (with breakeven context
//     "(breakeven ≈ 52.4% at −110)" inline, and a "sample still small"
//     qualifier when leansGraded < 20)
//   - a non-numeric promotion-criteria line sits at the bottom
//   - the strip continues to never expose ROI / units / avgEdge

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    createElement(TooltipProvider, null, node),
  );
}

const baseSummary = (overrides: Partial<ModelWatchSummary> = {}): ModelWatchSummary => ({
  windowDays: 30,
  leansGraded: 0,
  winRate: 0,
  meanClv: 0,
  clvSampleSize: 0,
  activeMarkets: 0,
  totalRegistryMarkets: 4,
  ...overrides,
});

test("ModelWatchStrip: renders heading, BETA pill, and the merged 'evaluation cohort / not a track record' lead copy", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: baseSummary(),
      isLoading: false,
      windowDays: 30,
    }),
  );

  assert.match(html, /data-testid="model-watch-strip"/);
  assert.match(html, /Model Watch — Live Evaluation Lane/);
  assert.match(html, /BETA/);
  // New lead copy — purpose statement.
  assert.match(
    html,
    /Evaluation cohort — markets being measured for possible promotion to Official\./,
  );
  // Merged disclaimer — replaces the old "Does not count toward Official
  // performance or history." line. Only one disclaimer should remain.
  assert.match(html, /Not a track record\. Does not affect Official numbers\./);
  assert.doesNotMatch(
    html,
    /Does not count toward Official performance or history/,
    "the old disclaimer should be gone — its message is folded into the new lead",
  );
});

test("ModelWatchStrip: window scope chip mirrors the parent window selector", () => {
  for (const days of [14, 30, 45]) {
    const html = render(
      createElement(ModelWatchStrip, {
        data: baseSummary({ windowDays: days }),
        isLoading: false,
        windowDays: days,
      }),
    );
    assert.match(
      html,
      new RegExp(`${days}d window`),
      `expected scope chip "${days}d window"`,
    );
  }
});

test("ModelWatchStrip: empty state — leansGraded=0 → '0 leans graded' chip + active-markets ratio chip + 'no picks yet' line", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: baseSummary({
        leansGraded: 0,
        winRate: 0,
        meanClv: 0,
        clvSampleSize: 0,
        activeMarkets: 0,
        totalRegistryMarkets: 4,
      }),
      isLoading: false,
      windowDays: 30,
    }),
  );

  // Scope chips render the leans-graded count and active-markets ratio
  // even in the empty state — the registry health signal is preserved.
  assert.match(html, /0 leans graded/);
  assert.match(html, /0 \/ 4 markets active/);
  // Empty-state message — surfaced when there are no graded Watch picks.
  assert.match(
    html,
    /No graded Model Watch picks in this window yet\./,
  );
  // No win-rate / mean-CLV readout lines should render in the empty state.
  assert.doesNotMatch(html, /Win rate:/);
  assert.doesNotMatch(html, /Mean CLV:/);
  // Promotion-criteria line still anchors the bottom of the panel.
  assert.match(
    html,
    /Promotion requires sustained positive CLV and enough graded sample\./,
  );
});

test("ModelWatchStrip: populated state renders Mean CLV (signed, with n=) as primary and Win rate inline with breakeven context", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: baseSummary({
        leansGraded: 25,
        winRate: 0.42,
        meanClv: 0.0312,
        clvSampleSize: 22,
        activeMarkets: 3,
        totalRegistryMarkets: 4,
      }),
      isLoading: false,
      windowDays: 30,
    }),
  );

  // Scope chips reflect graded count and active-markets ratio.
  assert.match(html, /25 leans graded/);
  assert.match(html, /3 \/ 4 markets active/);

  // Mean CLV is the primary readout — signed (+) for non-negative values
  // and shown with sample size in parentheses next to it.
  assert.match(html, /Mean CLV:/);
  assert.match(html, /\+3\.1%/);
  assert.match(html, /\(n=22\)/);

  // Win rate is the secondary readout — formatted to one decimal.
  assert.match(html, /Win rate:/);
  assert.match(html, /42\.0%/);

  // Sample size (25) is at/above the small-sample floor (20) so the
  // "sample still small" qualifier should NOT appear here.
  assert.doesNotMatch(html, /sample still small/);
});

test("ModelWatchStrip: breakeven context appears alongside win rate when win rate is rendered", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: baseSummary({
        leansGraded: 30,
        winRate: 0.42,
        meanClv: 0.005,
        clvSampleSize: 25,
        activeMarkets: 2,
        totalRegistryMarkets: 4,
      }),
      isLoading: false,
      windowDays: 30,
    }),
  );

  // The breakeven baseline must include both the ≈ approximation symbol
  // and the explicit −110 juice qualifier so the comparison is honest.
  assert.match(html, /Win rate:/);
  assert.match(html, /breakeven \u2248 52\.4% at \u2212110/);
});

test("ModelWatchStrip: small-sample qualifier is appended when leansGraded < 20", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: baseSummary({
        leansGraded: 8,
        winRate: 0.5,
        meanClv: 0.01,
        clvSampleSize: 6,
        activeMarkets: 2,
        totalRegistryMarkets: 4,
      }),
      isLoading: false,
      windowDays: 14,
    }),
  );

  assert.match(html, /sample still small/);
});

test("ModelWatchStrip: 'no closing line data' qualifier renders when clvSampleSize=0 even if leansGraded>0", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: baseSummary({
        leansGraded: 5,
        winRate: 0.4,
        meanClv: 0,
        clvSampleSize: 0,
        activeMarkets: 1,
        totalRegistryMarkets: 4,
      }),
      isLoading: false,
      windowDays: 14,
    }),
  );

  assert.match(html, /Mean CLV:/);
  assert.match(html, /no closing line data/);
});

test("ModelWatchStrip: loading state renders skeleton placeholders, no metric readouts", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: undefined,
      isLoading: true,
      windowDays: 30,
    }),
  );

  // Heading + lead + promotion-criteria framing still visible during loading
  // so the panel reads as an evaluation lane, not a broken scoreboard.
  assert.match(html, /Model Watch — Live Evaluation Lane/);
  assert.match(html, /Evaluation cohort/);
  assert.match(
    html,
    /Promotion requires sustained positive CLV and enough graded sample\./,
  );
  // Window scope chip is still derivable from the prop.
  assert.match(html, /30d window/);
  // Metric readouts are NOT rendered during the skeleton phase.
  assert.doesNotMatch(html, /Mean CLV:/);
  assert.doesNotMatch(html, /Win rate:/);
  assert.doesNotMatch(html, /breakeven/);
});

test("ModelWatchStrip: promotion-criteria line is qualitative — present, with no numeric thresholds", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: baseSummary({
        leansGraded: 30,
        winRate: 0.5,
        meanClv: 0.02,
        clvSampleSize: 25,
        activeMarkets: 4,
        totalRegistryMarkets: 4,
      }),
      isLoading: false,
      windowDays: 30,
    }),
  );

  assert.match(
    html,
    /Promotion requires sustained positive CLV and enough graded sample\./,
  );
  // Confirm the line does not leak any quantitative threshold (no "n=20",
  // "≥", ">=", "%" inside the criteria sentence). We scope this to the
  // promotion sentence itself by extracting it.
  const m = html.match(
    /Promotion requires[^<]*?\./,
  );
  assert.ok(m, "expected to find the promotion-criteria sentence");
  const sentence = m![0];
  assert.doesNotMatch(sentence, /\d/, "promotion line must not contain digits");
  assert.doesNotMatch(sentence, /%/, "promotion line must not contain a % sign");
  assert.doesNotMatch(sentence, /≥|>=/, "promotion line must not contain a threshold operator");
});

test("ModelWatchStrip: never exposes ROI / units / avgEdge — the public surface stays narrow", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: baseSummary({
        leansGraded: 25,
        winRate: 0.6,
        meanClv: 0.02,
        clvSampleSize: 20,
        activeMarkets: 4,
        totalRegistryMarkets: 4,
      }),
      isLoading: false,
      windowDays: 45,
    }),
  );

  // Lowercase the markup so we don't accidentally match the React-internal
  // "data-" attributes or any incidental capitalization.
  const lower = html.toLowerCase();
  assert.equal(
    lower.includes("roi"),
    false,
    "ROI must NOT be exposed in the Watch strip",
  );
  assert.equal(
    lower.includes("units"),
    false,
    "units must NOT be exposed in the Watch strip",
  );
  assert.equal(
    lower.includes("avg edge") || lower.includes("avgedge"),
    false,
    "avgEdge must NOT be exposed in the Watch strip",
  );
});
