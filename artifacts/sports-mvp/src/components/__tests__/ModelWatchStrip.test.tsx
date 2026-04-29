import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModelWatchStrip } from "@/pages/Performance";
import type { ModelWatchSummary } from "@workspace/api-client-react";

// Render-level tests for the Model Watch (Beta) strip on the Performance
// page (Task #32). These cover the surface that the e2e test would have
// covered if Clerk auth weren't blocking the test agent in this env:
//   - The strip exists with data-testid="model-watch-strip"
//   - The heading reads "Model Watch — Live Evaluation Lane" + BETA pill
//   - The disclaimer "Does not count toward Official performance or
//     history." is present
//   - The window subheading mirrors the parent window selector
//     ("Last 14 days" / "Last 30 days" / "Last 45 days")
//   - The four stat tiles have exactly the labels: Leans Graded /
//     Win Rate / Mean CLV / Active Markets — and NO ROI / units / avgEdge
//   - Empty state renders em-dashes plus the "No graded Model Watch picks
//     in this window yet." copy.

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

test("ModelWatchStrip: renders heading, BETA pill, and the official-vs-watch disclaimer", () => {
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
  assert.match(
    html,
    /Does not count toward Official performance or history\./,
  );
});

test("ModelWatchStrip: window subheading mirrors the parent window selector", () => {
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
      new RegExp(`Last ${days} days`),
      `expected window subheading "Last ${days} days"`,
    );
  }
});

test("ModelWatchStrip: empty state — leansGraded=0 → em-dashes + 'no picks yet' line + active-markets count", () => {
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

  assert.match(html, /Leans Graded/);
  assert.match(html, /Win Rate/);
  assert.match(html, /Mean CLV/);
  assert.match(html, /Active Markets/);
  // Empty state message — surfaced when there are no graded Watch picks.
  assert.match(
    html,
    /No graded Model Watch picks in this window yet\./,
  );
  // Active Markets tile keeps its real "{active} / {total}" value even
  // in the empty state — that's the registry health signal.
  assert.match(html, /0 \/ 4/);
});

test("ModelWatchStrip: populated state renders win rate, signed mean CLV, sample size, and active-markets ratio", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: baseSummary({
        leansGraded: 17,
        winRate: 0.5882,
        meanClv: 0.0312,
        clvSampleSize: 14,
        activeMarkets: 3,
        totalRegistryMarkets: 4,
      }),
      isLoading: false,
      windowDays: 14,
    }),
  );

  assert.match(html, /\b17\b/, "expected leansGraded=17 to render");
  // Win rate — formatPercentage emits 58.8% (one decimal) for 0.5882.
  assert.match(html, /58\.8%/);
  // Mean CLV is signed and prepended with '+' for non-negative values.
  assert.match(html, /\+3\.1%/);
  assert.match(html, /n=14/);
  assert.match(html, /3 \/ 4/);
  assert.match(html, /active evaluation markets/);
});

test("ModelWatchStrip: loading state renders skeleton tiles, no values", () => {
  const html = render(
    createElement(ModelWatchStrip, {
      data: undefined,
      isLoading: true,
      windowDays: 30,
    }),
  );

  // Heading + disclaimer still visible during loading.
  assert.match(html, /Model Watch — Live Evaluation Lane/);
  assert.match(html, /Does not count toward Official performance or history\./);
  // Stat labels are NOT rendered during the skeleton phase (they show
  // up only once data arrives).
  assert.doesNotMatch(html, /Leans Graded/);
  assert.doesNotMatch(html, /Active Markets/);
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
