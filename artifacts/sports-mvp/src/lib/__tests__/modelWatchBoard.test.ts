import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectModelWatchBoardCandidates,
  selectFallbackSection,
  MODEL_WATCH_BOARD_TITLE,
  MODEL_WATCH_BOARD_DISCLAIMER,
  MODEL_WATCH_BOARD_DEFAULT_TARGET,
  MODEL_WATCH_BOARD_MAX,
  MODEL_WATCH_BOARD_QUALITY_RATIO,
} from "../modelWatchBoard";

// Each fixture carries the two fields the selector reads + an `id` so the
// returned ordering is easy to assert against. Real PASS rows have many
// more fields; we keep this minimal to make intent obvious.
type Fixture = { id: string; rankScore: number; ev: number };

const c = (id: string, rankScore: number, ev: number): Fixture => ({
  id,
  rankScore,
  ev,
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
    { id: "x", rankScore: "0.95", ev: "0.05" },
    { id: "y", rankScore: "0.90", ev: "0.04" },
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
