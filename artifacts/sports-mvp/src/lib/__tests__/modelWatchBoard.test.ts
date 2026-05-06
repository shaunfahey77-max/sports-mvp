import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectModelWatchBoardCandidates,
  selectFallbackSection,
  MEMBER_BOARD_ALLOWED_SELECTION_REASONS,
  MEMBER_BOARD_ALLOWED_SURFACE_STATUSES,
  MODEL_WATCH_BOARD_TITLE,
  MODEL_WATCH_BOARD_DISCLAIMER,
  MODEL_WATCH_BOARD_DEFAULT_TARGET,
  MODEL_WATCH_BOARD_MAX,
  MODEL_WATCH_BOARD_QUALITY_RATIO,
} from "../modelWatchBoard";

// Each fixture carries the three fields the selector reads + an `id` so the
// returned ordering is easy to assert against. Real PASS rows have many
// more fields; we keep this minimal to make intent obvious.
//
// `selectionReason` defaults to 'model_watch_only' (the only reason the
// post-task-#38 selector accepts onto the board / Free fallback). Tests
// that exercise the disabled-market filter pass an explicit non-allowed
// reason via the optional 4th argument.
type Fixture = {
  id: string;
  rankScore: number;
  ev: number;
  surfaceStatus?: string | null;
  selectionReason: string;
};

const c = (
  id: string,
  rankScore: number,
  ev: number,
  selectionReason: string = "model_watch_only",
  surfaceStatus: string | null = "model_watch",
): Fixture => ({
  id,
  rankScore,
  ev,
  surfaceStatus,
  selectionReason,
});

test("selector: empty input → empty board (no Action Today path stays untouched)", () => {
  assert.deepEqual(selectModelWatchBoardCandidates([]), []);
});

test("selector: 2 PASS candidates → renders both (graceful underflow for case (d))", () => {
  const board = selectModelWatchBoardCandidates([
    c("a", 0.7, 0.05),
    c("b", 0.6, 0.04),
  ]);
  assert.equal(board.length, 2);
  assert.deepEqual(board.map((x) => x.id), ["a", "b"]);
});

test("selector: 5 PASS rows but #4 fails the rank/EV gate → exactly 3 cards (default target)", () => {
  // #1=1.00 → quality floor = 0.80. #4=0.79 fails the rank gate so the
  // selector must stop at 3 (not bleed weaker leans into the board).
  const board = selectModelWatchBoardCandidates([
    c("1", 1.0, 0.10),
    c("2", 0.95, 0.08),
    c("3", 0.90, 0.05),
    c("4", 0.79, 0.05),
    c("5", 0.78, 0.05),
  ]);
  assert.equal(board.length, MODEL_WATCH_BOARD_DEFAULT_TARGET);
  assert.deepEqual(board.map((x) => x.id), ["1", "2", "3"]);
});

test("selector: 5 PASS rows where #4 and #5 both clear the gates → expand to 5 cards", () => {
  // All 5 candidates: rankScore >= 0.80 (= 80% of #1=1.00) AND ev >= 0.
  const board = selectModelWatchBoardCandidates([
    c("1", 1.0, 0.10),
    c("2", 0.95, 0.08),
    c("3", 0.90, 0.05),
    c("4", 0.85, 0.02),
    c("5", 0.80, 0.0),
  ]);
  assert.equal(board.length, MODEL_WATCH_BOARD_MAX);
  assert.deepEqual(board.map((x) => x.id), ["1", "2", "3", "4", "5"]);
});

test("selector: #4 clears, #5 fails ev gate → board stops at 4 (no trailing weaker leans)", () => {
  const board = selectModelWatchBoardCandidates([
    c("1", 1.0, 0.10),
    c("2", 0.95, 0.08),
    c("3", 0.90, 0.05),
    c("4", 0.85, 0.02),
    c("5", 0.85, -0.01), // EV negative → fails
  ]);
  assert.equal(board.length, 4);
  assert.deepEqual(board.map((x) => x.id), ["1", "2", "3", "4"]);
});

test("selector: stops at the first sorted-position failure (no skipping over weak leans)", () => {
  // After sort-desc the order is: 1 (1.0), 2 (0.95), 3 (0.90), 4 (0.85), 5 (0.70).
  // Sorted position 4 ("4") clears both gates → included.
  // Sorted position 5 ("5") fails the rank gate (0.70 < 0.80 floor) →
  // selector must stop, NOT continue searching for a later qualifier.
  // Result: exactly 4 cards.
  const board = selectModelWatchBoardCandidates([
    c("1", 1.0, 0.10),
    c("2", 0.95, 0.08),
    c("3", 0.90, 0.05),
    c("4", 0.85, 0.05),
    c("5", 0.70, 0.05),
  ]);
  assert.equal(board.length, 4);
  assert.deepEqual(board.map((x) => x.id), ["1", "2", "3", "4"]);
});

test("selector: input order is irrelevant — selector always sorts by rankScore desc", () => {
  const board = selectModelWatchBoardCandidates([
    c("c", 0.90, 0.05),
    c("a", 1.0, 0.10),
    c("b", 0.95, 0.08),
  ]);
  assert.deepEqual(board.map((x) => x.id), ["a", "b", "c"]);
});

test("selector: rankScore arriving as string is coerced (matches CandidateBet wire shape)", () => {
  const board = selectModelWatchBoardCandidates([
    {
      id: "x",
      rankScore: "0.95",
      ev: "0.05",
      surfaceStatus: "model_watch",
      selectionReason: "model_watch_only",
    },
    {
      id: "y",
      rankScore: "0.90",
      ev: "0.04",
      surfaceStatus: "model_watch",
      selectionReason: "model_watch_only",
    },
  ]);
  assert.deepEqual(board.map((x) => (x as { id: string }).id), ["x", "y"]);
});

test("selector: quality ratio is exactly 0.80 (boundary case, #4 = 80% of #1 → included)", () => {
  // The rule is ">= 80%", so the boundary itself qualifies.
  const board = selectModelWatchBoardCandidates([
    c("1", 1.0, 0.10),
    c("2", 0.95, 0.08),
    c("3", 0.90, 0.05),
    c("4", 0.80, 0.01),
  ]);
  assert.equal(board.length, 4);
  assert.deepEqual(board.map((x) => x.id), ["1", "2", "3", "4"]);
});

test("selector: never returns more than MODEL_WATCH_BOARD_MAX (=5) even if many qualify", () => {
  const fixtures: Fixture[] = [];
  for (let i = 0; i < 10; i++) {
    fixtures.push(c(`r${i}`, 1.0, 0.1));
  }
  const board = selectModelWatchBoardCandidates(fixtures);
  assert.equal(board.length, MODEL_WATCH_BOARD_MAX);
});

test("constants: defaults match the task spec (target 3, max 5, ratio 0.80)", () => {
  assert.equal(MODEL_WATCH_BOARD_DEFAULT_TARGET, 3);
  assert.equal(MODEL_WATCH_BOARD_MAX, 5);
  assert.equal(MODEL_WATCH_BOARD_QUALITY_RATIO, 0.8);
});

test("copy: Member-board title is the exact string the spec requires (case (e))", () => {
  // Hard-coded literal, NOT a reference to the imported constant — that
  // way a typo in the constant itself would be caught.
  assert.equal(
    MODEL_WATCH_BOARD_TITLE,
    "Model Watch Board — No Official Picks Today"
  );
});

test("copy: Member-board disclaimer is the exact string the spec requires (case (e))", () => {
  assert.equal(
    MODEL_WATCH_BOARD_DISCLAIMER,
    "These are ranked leans, not Official picks. They do not count toward performance, CLV reporting, or History."
  );
});

// ---------------------------------------------------------------------------
// Dashboard-section (no-Official-day) render decision tests
// ---------------------------------------------------------------------------
//
// These cover spec Step 4 cases (a)–(e) at the data layer the Dashboard
// JSX switches on. They intentionally do not stand up a React rendering
// harness — Dashboard.tsx is now a thin switch on selectFallbackSection's
// `kind`, so asserting the kind/cards/copy here is equivalent to
// asserting the rendered tree, with far less ceremony.

const passRows = (n: number, evAll: number = 0.05): Fixture[] => {
  // Generate n descending rankScores starting at 1.0 and stepping down by
  // 0.03 so all of them comfortably clear the 0.80 quality floor by
  // default (used by case (b) and (c) below).
  const out: Fixture[] = [];
  for (let i = 0; i < n; i++) {
    out.push(c(`p${i + 1}`, 1.0 - i * 0.03, evAll));
  }
  return out;
};

test("dashboard (a): signed-out / Free user, no-Official day with >=3 PASS → exactly one fallback card", () => {
  // The Dashboard branch this guards is rendered only when allPicks=0 AND
  // liveCandidates=0 (enforced by the Dashboard JSX), so the input here is
  // exclusively the PASS list — same precondition the JSX uses.
  const section = selectFallbackSection({
    passCandidates: passRows(5),
    isMvp: false,
  });
  assert.equal(section.kind, "free-fallback");
  if (section.kind !== "free-fallback") return; // narrow for TS
  // Highest-ranked PASS candidate becomes the single Free card.
  assert.equal(section.candidate.id, "p1");
});

test("dashboard (b): MVP user, no-Official day with 3 PASS → 3 ranked Model Watch cards by default", () => {
  const section = selectFallbackSection({
    passCandidates: passRows(3),
    isMvp: true,
  });
  assert.equal(section.kind, "member-board");
  if (section.kind !== "member-board") return;
  assert.equal(section.cards.length, 3);
  assert.deepEqual(section.cards.map((x) => x.id), ["p1", "p2", "p3"]);
});

test("dashboard (c): MVP user, 5 PASS where #4 and #5 clear the quality rule → up to 5 cards", () => {
  // Carefully tuned: 5 candidates whose rankScores are all >= 80% of #1
  // (1.0 → floor 0.80) and whose EVs are all >= 0. Mirrors the expansion
  // path the spec calls out.
  const section = selectFallbackSection({
    passCandidates: [
      c("e1", 1.0, 0.10),
      c("e2", 0.95, 0.08),
      c("e3", 0.90, 0.05),
      c("e4", 0.85, 0.02),
      c("e5", 0.80, 0.0),
    ],
    isMvp: true,
  });
  assert.equal(section.kind, "member-board");
  if (section.kind !== "member-board") return;
  assert.equal(section.cards.length, 5);
  assert.deepEqual(
    section.cards.map((x) => x.id),
    ["e1", "e2", "e3", "e4", "e5"],
  );
});

test("dashboard (d): MVP user with only 2 PASS candidates → 2 cards (graceful underflow)", () => {
  const section = selectFallbackSection({
    passCandidates: passRows(2),
    isMvp: true,
  });
  assert.equal(section.kind, "member-board");
  if (section.kind !== "member-board") return;
  assert.equal(section.cards.length, 2);
  assert.deepEqual(section.cards.map((x) => x.id), ["p1", "p2"]);
});

test("dashboard (e): Member view carries the EXACT spec title and disclaimer (no PickCard / TopPickCallout coupling)", () => {
  // Title and disclaimer travel WITH the kind so the JSX cannot
  // accidentally render the Member section without them. The
  // Dashboard JSX renders these literally via {section.title} /
  // {section.disclaimer}, so checking them here is what's actually
  // displayed.
  const section = selectFallbackSection({
    passCandidates: passRows(3),
    isMvp: true,
  });
  assert.equal(section.kind, "member-board");
  if (section.kind !== "member-board") return;
  assert.equal(
    section.title,
    "Model Watch Board — No Official Picks Today",
  );
  assert.equal(
    section.disclaimer,
    "These are ranked leans, not Official picks. They do not count toward performance, CLV reporting, or History.",
  );

  // Negative assertion — the Member fallback section is structurally
  // disjoint from the Official-styled render branches:
  //   - There is no `kind: 'official-picks'` or `kind: 'live-candidates'`
  //     in DashboardFallbackSection, so the Dashboard JSX cannot reach a
  //     branch that renders TopPickCallout / TIER A-B-C PickCard styling
  //     while showing the Member board.
  //   - The kind union exhaustively narrows to the three values below;
  //     anything else would fail to typecheck and would not have a
  //     runtime arm in Dashboard.tsx.
  const allowedKinds = new Set(["no-action", "free-fallback", "member-board"]);
  assert.ok(
    allowedKinds.has(section.kind),
    `member section kind '${section.kind}' must be one of the three union arms`,
  );
});

test("dashboard: empty PASS list → 'no-action' (the existing No-Action-Today empty state stays intact for everyone)", () => {
  for (const isMvp of [true, false]) {
    const section = selectFallbackSection({
      passCandidates: [],
      isMvp,
    });
    assert.equal(section.kind, "no-action", `isMvp=${isMvp}`);
  }
});

test("dashboard (a) extra: Free user with 5 strong PASS candidates STILL gets exactly one card (Public surface unchanged)", () => {
  // Guards against accidentally letting the Member-board sizing rule
  // bleed into the Free path.
  const section = selectFallbackSection({
    passCandidates: [
      c("f1", 1.0, 0.10),
      c("f2", 0.95, 0.08),
      c("f3", 0.90, 0.05),
      c("f4", 0.85, 0.02),
      c("f5", 0.80, 0.0),
    ],
    isMvp: false,
  });
  assert.equal(section.kind, "free-fallback");
  if (section.kind !== "free-fallback") return;
  // Only the highest-ranked candidate is exposed.
  assert.equal(section.candidate.id, "f1");
});

// ---------------------------------------------------------------------------
// Task #38: disabled-market / non-eligible PASS reasons MUST NOT leak onto
// the Member Model Watch board OR the Free single-card fallback.
//
// Background: PASS-tier today is a union of multiple selectionReasons.
// Markets like nba_moneyline produce high-rankScore PASS candidates with
// selectionReason='market_disabled'. Without an explicit filter the
// previous selector would slot the strongest PASS row of the day onto
// the board and render the giveaway "Market disabled in current model
// config." copy on a board framed as "markets we're actively evaluating".
// These tests pin the new invariant so any future regression fails loudly.
// ---------------------------------------------------------------------------

const ALL_NON_ELIGIBLE_PASS_REASONS = [
  "insufficient_edge",
  "negative_ev",
  "market_quality_too_low",
  "odds_out_of_range",
  "rank_score_below_threshold",
  "market_disabled",
] as const;

test("invariant: allowed reasons set is exactly { 'model_watch_only' } (single source of truth)", () => {
  // The exported Set is what the selector consults; assert the contents
  // explicitly so a future widening (e.g. accidentally adding
  // 'rank_score_below_threshold') is caught immediately by this test.
  assert.equal(MEMBER_BOARD_ALLOWED_SELECTION_REASONS.size, 1);
  assert.ok(MEMBER_BOARD_ALLOWED_SELECTION_REASONS.has("model_watch_only"));
  assert.equal(MEMBER_BOARD_ALLOWED_SURFACE_STATUSES.size, 1);
  assert.ok(MEMBER_BOARD_ALLOWED_SURFACE_STATUSES.has("model_watch"));
  for (const r of ALL_NON_ELIGIBLE_PASS_REASONS) {
    assert.ok(
      !MEMBER_BOARD_ALLOWED_SELECTION_REASONS.has(r),
      `reason '${r}' must NOT be allowed on the board`,
    );
  }
});

test("surface-status invariant: suppressed/official/shadow rows never surface even if selectionReason says model_watch_only", () => {
  const board = selectModelWatchBoardCandidates([
    c("suppressed", 1.0, 0.20, "model_watch_only", "suppressed"),
    c("official", 0.95, 0.10, "model_watch_only", "official"),
    c("shadow", 0.90, 0.10, "model_watch_only", "shadow"),
    c("watch", 0.85, 0.05, "model_watch_only", "model_watch"),
  ]);

  assert.deepEqual(board.map((x) => x.id), ["watch"]);
});

test("transition fallback: missing surfaceStatus still honors selectionReason-only eligibility", () => {
  const board = selectModelWatchBoardCandidates([
    { id: "legacy-watch", rankScore: 0.9, ev: 0.05, selectionReason: "model_watch_only" },
    { id: "legacy-disabled", rankScore: 1.0, ev: 0.10, selectionReason: "market_disabled" },
  ]);

  assert.deepEqual(board.map((x) => x.id), ["legacy-watch"]);
});

test("task #38 (a): high-rankScore market_disabled row is excluded; lower-ranked model_watch_only rows still surface in rankScore order", () => {
  // The disabled row has the strongest rankScore of the day — pre-fix
  // this would have won the #1 board slot and rendered the disabled-
  // market copy. Post-fix it must be filtered before sort/slice.
  const board = selectModelWatchBoardCandidates([
    c("disabled-strong", 1.0, 0.20, "market_disabled"),
    c("watch-mid", 0.85, 0.05),
    c("watch-low", 0.70, 0.03),
  ]);
  assert.deepEqual(board.map((x) => x.id), ["watch-mid", "watch-low"]);
  for (const row of board) {
    assert.equal(row.selectionReason, "model_watch_only");
  }
});

test("task #38 (b): mixed PASS pool spanning every selectionReason → only the model_watch_only entries appear, in rankScore order", () => {
  const board = selectModelWatchBoardCandidates([
    c("ie", 0.99, 0.10, "insufficient_edge"),
    c("nev", 0.98, 0.10, "negative_ev"),
    c("mql", 0.97, 0.10, "market_quality_too_low"),
    c("oor", 0.96, 0.10, "odds_out_of_range"),
    c("rsbt", 0.95, 0.10, "rank_score_below_threshold"),
    c("md", 0.94, 0.10, "market_disabled"),
    c("watch-3", 0.60, 0.05),
    c("watch-1", 0.90, 0.10),
    c("watch-2", 0.80, 0.05),
  ]);
  assert.deepEqual(board.map((x) => x.id), ["watch-1", "watch-2", "watch-3"]);
  for (const row of board) {
    assert.equal(row.selectionReason, "model_watch_only");
  }
});

test("task #38 (c): PASS pool is entirely market_disabled → selector returns [] AND member fallback is 'no-action'", () => {
  const onlyDisabled = [
    c("md1", 1.0, 0.20, "market_disabled"),
    c("md2", 0.95, 0.18, "market_disabled"),
    c("md3", 0.90, 0.16, "market_disabled"),
  ];
  assert.deepEqual(selectModelWatchBoardCandidates(onlyDisabled), []);

  const memberSection = selectFallbackSection({
    passCandidates: onlyDisabled,
    isMvp: true,
  });
  // Critical: member view falls through to the existing empty state,
  // NOT an empty member-board shell carrying the title/disclaimer.
  assert.equal(memberSection.kind, "no-action");
});

test("task #38 (d): all-disabled PASS pool with isMvp=false → 'no-action' (NEVER a free-fallback card showing a disabled market)", () => {
  // The original Free single-card fallback had the identical exposure
  // as the Member board: one disabled card with a strong rankScore
  // would have leaked through. Lock it down explicitly.
  const onlyDisabled = [
    c("md1", 1.0, 0.20, "market_disabled"),
    c("md2", 0.95, 0.18, "market_disabled"),
  ];
  const section = selectFallbackSection({
    passCandidates: onlyDisabled,
    isMvp: false,
  });
  assert.equal(section.kind, "no-action");
});

test("task #38 (e): property-style — for any input, every returned card has selectionReason === 'model_watch_only'", () => {
  // Build a deterministic but varied set of inputs that mixes every
  // known selectionReason at every rank position, in different orders
  // and lengths. This isn't a true randomized property test but it's a
  // small finite cover of the cases the selector can encounter in
  // production, and the invariant being asserted is universal.
  const reasonsPool: (string | null | undefined)[] = [
    "model_watch_only",
    "insufficient_edge",
    "negative_ev",
    "market_quality_too_low",
    "odds_out_of_range",
    "rank_score_below_threshold",
    "market_disabled",
    null,
    undefined,
  ];
  const cases: Fixture[][] = [];
  // Several pseudo-random pools: rotate the reason list across positions
  // so the disabled / non-eligible reasons fall at the top in some
  // pools and at the bottom in others.
  for (let shift = 0; shift < reasonsPool.length; shift++) {
    const pool: Fixture[] = [];
    for (let i = 0; i < reasonsPool.length; i++) {
      const reason = reasonsPool[(i + shift) % reasonsPool.length];
      pool.push({
        id: `s${shift}-i${i}`,
        rankScore: 1.0 - i * 0.05,
        ev: 0.05 - i * 0.005,
        surfaceStatus:
          reason === "model_watch_only"
            ? "model_watch"
            : reason === "market_disabled"
            ? "suppressed"
            : "shadow",
        selectionReason: reason ?? null,
      } as Fixture);
    }
    cases.push(pool);
  }

  for (const pool of cases) {
    const board = selectModelWatchBoardCandidates(pool);
    for (const card of board) {
      assert.equal(
        card.selectionReason,
        "model_watch_only",
        `pool produced disallowed card ${JSON.stringify(card)}`,
      );
    }

    const memberSection = selectFallbackSection({
      passCandidates: pool,
      isMvp: true,
    });
    if (memberSection.kind === "member-board") {
      for (const card of memberSection.cards) {
        assert.equal(card.selectionReason, "model_watch_only");
      }
    }

    const freeSection = selectFallbackSection({
      passCandidates: pool,
      isMvp: false,
    });
    if (freeSection.kind === "free-fallback") {
      assert.equal(freeSection.candidate.selectionReason, "model_watch_only");
    }
  }
});

test("task #38: Free fallback with mixed pool picks the highest-ranked model_watch_only row (skipping a stronger disabled one)", () => {
  const section = selectFallbackSection({
    passCandidates: [
      c("disabled-strong", 1.0, 0.20, "market_disabled"),
      c("watch-best", 0.85, 0.05),
      c("watch-other", 0.80, 0.04),
    ],
    isMvp: false,
  });
  assert.equal(section.kind, "free-fallback");
  if (section.kind !== "free-fallback") return;
  assert.equal(section.candidate.id, "watch-best");
  assert.equal(section.candidate.selectionReason, "model_watch_only");
});

test("task #38: missing/null selectionReason is treated as ineligible (defensive default)", () => {
  // Wire schema marks selectionReason as optional/nullable. Belt-and-
  // braces: if a row arrives without one, the selector must NOT promote
  // it onto the board (we'd rather show fewer cards than show a row
  // whose disposition we can't confirm).
  const board = selectModelWatchBoardCandidates([
    { id: "no-reason", rankScore: 1.0, ev: 0.10 },
    { id: "null-reason", rankScore: 0.95, ev: 0.10, selectionReason: null },
    c("watch-only", 0.80, 0.05),
  ]);
  assert.deepEqual(board.map((x) => (x as { id: string }).id), ["watch-only"]);
});
