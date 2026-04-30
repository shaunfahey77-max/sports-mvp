import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NoOfficialPicksSection } from "@/components/NoOfficialPicksSection";
import {
  selectFallbackSection,
  MODEL_WATCH_BOARD_TITLE,
  MODEL_WATCH_BOARD_DISCLAIMER,
} from "@/lib/modelWatchBoard";
import type { CandidateBet } from "@workspace/api-client-react";

// Dashboard-level render tests. These mirror what Dashboard.tsx renders
// for the no-Official-pick branch by:
//   1. Computing the fallback section via the same `selectFallbackSection`
//      helper Dashboard uses.
//   2. Rendering the same `<NoOfficialPicksSection>` component Dashboard
//      now delegates to (extracted in this task to make the section
//      directly testable without standing up React Query / Clerk / wouter
//      providers).
// They cover the review's "Dashboard render test (free vs MVP no-Official
// day)" gap by asserting the actual rendered tree, not just the selector.

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    createElement(TooltipProvider, null, node),
  );
}

const passBet = (id: string, rankScore: string): CandidateBet =>
  ({
    id,
    league: "nfl",
    marketType: "spread",
    side: "home",
    publishLine: "-3.5",
    publishOdds: "-110",
    edge: "0.0421",
    ev: "0.0312",
    rankScore,
    modelProbCalibrated: "0.5512",
    marketProbFair: "0.5091",
    tier: "PASS",
    // Member board / Free fallback may only ever surface model_watch_only
    // PASS rows after task #38; setting the eligible reason here keeps the
    // pre-existing render assertions valid under the new invariant.
    selectionReason: "model_watch_only",
    gameKey: `2026-04-29-NFL-${id}`,
    eventCommenceTime: "2026-04-29T18:00:00Z",
    bookmaker: "draftkings",
    publishedAt: "2026-04-29T17:00:00Z",
  } as unknown as CandidateBet);

test("Dashboard render: MVP user, no-Official day with PASS candidates → Member board with exact spec title and disclaimer", () => {
  const passCandidates = [
    passBet("a", "0.95"),
    passBet("b", "0.90"),
    passBet("c", "0.85"),
  ];
  const section = selectFallbackSection({ passCandidates, isMvp: true });
  const html = render(
    createElement(NoOfficialPicksSection, {
      section,
      onLogPick: () => {},
    }),
  );

  // The Member board container is in the tree.
  assert.match(html, /data-testid="model-watch-board-section"/);

  // Exact spec title and disclaimer text — these are the contractual
  // member-only strings called out in the task ("Exact title:" and
  // "Exact disclaimer:").
  assert.ok(
    html.includes(MODEL_WATCH_BOARD_TITLE),
    `expected exact title literal in rendered Dashboard tree, got:\n${html}`,
  );
  assert.ok(
    html.includes(MODEL_WATCH_BOARD_DISCLAIMER),
    "expected exact disclaimer literal in rendered Dashboard tree",
  );

  // 3 ranked Model Watch cards rendered (#1 / #2 / #3 pips).
  for (const rank of [1, 2, 3]) {
    assert.match(
      html,
      new RegExp(`>\\s*#${rank}\\s*<`),
      `expected rank pip "#${rank}" in member board`,
    );
  }

  // Negative assertion: the Member board branch must never render the
  // free-fallback section's container or the "No Action Today" empty
  // state — those are mutually-exclusive arms of the discriminated union.
  assert.doesNotMatch(html, /data-testid="fallback-section"/);
  assert.doesNotMatch(html, /No Action Today/);

  // Negative assertion: PASS-tier rows never carry an Official-pick
  // TIER A/B/C badge.
  assert.doesNotMatch(html, /TIER\s*A/);
  assert.doesNotMatch(html, /TIER\s*B/);
  assert.doesNotMatch(html, /TIER\s*C/);
});

test("Dashboard render: Free user, no-Official day with PASS candidates → single fallback card, NO Member board (Public surface unchanged)", () => {
  const passCandidates = [
    passBet("a", "0.95"),
    passBet("b", "0.90"),
    passBet("c", "0.85"),
    passBet("d", "0.80"),
    passBet("e", "0.75"),
  ];
  const section = selectFallbackSection({ passCandidates, isMvp: false });
  const html = render(
    createElement(NoOfficialPicksSection, {
      section,
      onLogPick: () => {},
    }),
  );

  // The Free fallback section is in the tree.
  assert.match(html, /data-testid="fallback-section"/);
  // Free copy is preserved verbatim.
  assert.match(
    html,
    /No Official Picks Today\s*—\s*Top Candidate \(Model Watch\)/,
  );

  // Negative assertions: the Member-only board container, exact
  // member title, exact member disclaimer, and rank pips must NOT
  // appear in the Free render. This is the spec's Public-surface
  // invariant (Free users see exactly the same single card they
  // saw before this task).
  assert.doesNotMatch(html, /data-testid="model-watch-board-section"/);
  assert.doesNotMatch(html, /data-testid="model-watch-board-title"/);
  assert.doesNotMatch(html, /data-testid="model-watch-board-disclaimer"/);
  assert.ok(
    !html.includes(MODEL_WATCH_BOARD_TITLE),
    "Free render must NOT contain the Member-board title literal",
  );
  assert.ok(
    !html.includes(MODEL_WATCH_BOARD_DISCLAIMER),
    "Free render must NOT contain the Member-board disclaimer literal",
  );
  assert.doesNotMatch(html, /data-testid="model-watch-rank-pip"/);
  assert.doesNotMatch(html, /data-testid="model-watch-rank-score"/);

  // Negative assertion: never the empty "No Action Today" state when
  // there are PASS candidates available.
  assert.doesNotMatch(html, /No Action Today/);
});

test("Dashboard render: any user, no PASS candidates → 'No Action Today' empty state (no Member board, no Free fallback card)", () => {
  for (const isMvp of [true, false]) {
    const section = selectFallbackSection({ passCandidates: [], isMvp });
    const html = render(
      createElement(NoOfficialPicksSection, {
        section,
        onLogPick: () => {},
      }),
    );

    assert.match(
      html,
      /data-testid="no-action-section"/,
      `(isMvp=${isMvp}) expected the existing No-Action-Today empty state`,
    );
    assert.match(html, /No Action Today/);
    assert.doesNotMatch(html, /data-testid="model-watch-board-section"/);
    assert.doesNotMatch(html, /data-testid="fallback-section"/);
  }
});
