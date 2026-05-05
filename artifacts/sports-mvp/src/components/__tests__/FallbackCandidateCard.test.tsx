import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FallbackCandidateCard } from "@/components/FallbackCandidateCard";
import type { CandidateBet } from "@workspace/api-client-react";

// The card uses Radix Tooltip-based InfoTooltips internally, which expect
// a TooltipProvider in the React tree (App.tsx wraps the whole app in
// one). This tiny render() helper mirrors that wrapper so the SSR output
// reflects what users actually see.
function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    createElement(TooltipProvider, null, node),
  );
}

// Render-level tests for the Member-board variant of FallbackCandidateCard.
// These run via tsx --test (no jsdom) and use react-dom/server's
// renderToStaticMarkup to inspect the produced HTML directly. They cover
// the spec's UI requirements that purely-pure selector tests can't reach:
//   - The numeric Rank score is actually visible on the card.
//   - The rank pip ("#1", "#2", ...) is rendered.
//   - Edge / EV / Model % / Market % stats are all present in
//     member-board mode.
//   - The Free single-card render (no rank, no showProbabilities) does
//     NOT show the Member-only stats and rank pip — Public surface is
//     visually unchanged.
//   - The card never carries the gold "TIER A/B/C" Official-pick badge.

const fixtureBet = (overrides: Partial<CandidateBet> = {}): CandidateBet =>
  ({
    id: "cand-1",
    league: "nfl",
    marketType: "spread",
    side: "home",
    publishLine: "-3.5",
    publishOdds: "-110",
    edge: "0.0421",
    ev: "0.0312",
    rankScore: "0.9123",
    modelProbCalibrated: "0.5512",
    marketProbFair: "0.5091",
    tier: "PASS",
    selectionReason: "rank_score_below_threshold",
    gameKey: "2026-04-29-NFL-SF@KC",
    eventStart: "2026-04-29T18:00:00Z",
    // Wire-shape extras we don't read but the type expects:
    bookmaker: "draftkings",
    publishedAt: "2026-04-29T17:00:00Z",
    ...overrides,
  } as unknown as CandidateBet);

test("member-board card renders the rank pip, Rank score value, and Edge / EV / Model % / Market % stats", () => {
  const html = render(
    createElement(FallbackCandidateCard, {
      bet: fixtureBet(),
      rank: 1,
      showProbabilities: true,
    })
  );

  // Rank pip ("#1") — ordinal position on the board.
  assert.match(html, /data-testid="model-watch-rank-pip"/);
  assert.match(html, />\s*#1\s*</);

  // Numeric Rank score (formatted to 2 decimals from "0.9123" → "0.91").
  // This is the spec's "Rank score" stat — distinct from the ordinal pip.
  assert.match(html, /data-testid="model-watch-rank-score"/);
  assert.match(html, />\s*Rank\s*</);
  assert.match(html, />\s*0\.91\s*</);

  // The other three required stats from spec line 15 ("Edge, EV, Rank
  // score, Model probability, Market (fair) probability").
  assert.match(html, />\s*Edge\s*</);
  assert.match(html, />\s*EV\s*</);
  assert.match(html, /data-testid="model-watch-model-prob"/);
  assert.match(html, />\s*Model %\s*</);
  assert.match(html, /data-testid="model-watch-market-prob"/);
  assert.match(html, />\s*Market %\s*</);

  // MODEL WATCH badge is always present on the card to make it
  // unmistakable that this is not an Official pick.
  assert.match(html, /MODEL WATCH/);
  assert.match(html, /data-testid="pick-event-start"/);
  assert.match(html, /Wed, Apr 29, 2:00 PM ET/);

  // Negative assertion: Member-board cards are PASS-tier rows by
  // definition, so no TIER A/B/C Official-styled badge appears.
  assert.doesNotMatch(html, /TIER\s*A/);
  assert.doesNotMatch(html, /TIER\s*B/);
  assert.doesNotMatch(html, /TIER\s*C/);
});

test("Free single-card render (no rank, no showProbabilities) is visually unchanged: no rank pip, no rank-score / model-prob / market-prob cells", () => {
  const html = render(
    createElement(FallbackCandidateCard, {
      bet: fixtureBet(),
      // Intentionally no `rank` and `showProbabilities` props.
    })
  );

  // Edge + EV always render (existing 2-stat grid).
  assert.match(html, />\s*Edge\s*</);
  assert.match(html, />\s*EV\s*</);

  // The Member-only additions must NOT leak into the Free render.
  assert.doesNotMatch(html, /data-testid="model-watch-rank-pip"/);
  assert.doesNotMatch(html, /data-testid="model-watch-rank-score"/);
  assert.doesNotMatch(html, /data-testid="model-watch-model-prob"/);
  assert.doesNotMatch(html, /data-testid="model-watch-market-prob"/);

  // MODEL WATCH badge still shows (this part of the card is the same on
  // every variant — it's the "this is not an Official pick" signal).
  assert.match(html, /MODEL WATCH/);
});

test("rank pip reflects the 1-based board position (#2, #3, ...)", () => {
  for (const rank of [2, 3, 4, 5]) {
    const html = render(
      createElement(FallbackCandidateCard, {
        bet: fixtureBet({ id: `cand-${rank}` } as unknown as Partial<CandidateBet>),
        rank,
        showProbabilities: true,
      })
    );
    assert.match(
      html,
      new RegExp(`>\\s*#${rank}\\s*<`),
      `expected rank pip "#${rank}" in member-board card`
    );
  }
});

test("rank score is coerced from the wire's stringy shape (numeric .toFixed render)", () => {
  // CandidateBet wire shape sends rankScore as a numeric string. The
  // card must coerce it before rendering so we don't ship "0.91230000"
  // or similar artefacts.
  const html = render(
    createElement(FallbackCandidateCard, {
      bet: fixtureBet({ rankScore: "0.7654" } as unknown as Partial<CandidateBet>),
      rank: 1,
      showProbabilities: true,
    })
  );
  assert.match(html, />\s*0\.77\s*</);
});
