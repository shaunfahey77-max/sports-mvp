/**
 * Model Watch Board selector + member-facing copy.
 *
 * On no-Official-pick days, MVP members see a ranked board of PASS-tier
 * candidates instead of the single Free-tier fallback card. The exact
 * sizing rule is encoded here so it can be unit-tested in isolation
 * (without React or hooks) and reused as the single source of truth.
 *
 * Sizing rule (from the task spec):
 *   - Default target: top 3 by rankScore (descending).
 *   - Expand to up to 5 only when the 4th (and 5th) candidate's
 *     rankScore is at least 80% of the #1 candidate's rankScore AND
 *     its EV is non-negative. Stop at the first card that fails the
 *     test so the board never trails off into noticeably weaker leans.
 *   - If fewer than 3 PASS rows exist, render whatever is available.
 *
 * Public/Free copy is intentionally NOT exported here — it stays inline
 * in Dashboard.tsx so this module is purely the Member-board concern.
 */

export const MODEL_WATCH_BOARD_DEFAULT_TARGET = 3;
export const MODEL_WATCH_BOARD_MAX = 5;
export const MODEL_WATCH_BOARD_QUALITY_RATIO = 0.8;

export const MODEL_WATCH_BOARD_TITLE =
  "Model Watch Board — No Official Picks Today";
export const MODEL_WATCH_BOARD_DISCLAIMER =
  "These are ranked leans, not Official picks. They do not count toward performance, CLV reporting, or History.";

/**
 * Allowed `selectionReason` values for any candidate that may surface on
 * the Member Model Watch board OR the Free single-card fallback. Both
 * surfaces frame themselves as "markets we're actively evaluating", so
 * disabled-market PASS rows (selection_reason='market_disabled') and
 * other PASS reasons (insufficient_edge, negative_ev, …) must never
 * leak in even when their rankScore happens to be the strongest of the
 * day. Encoded as a Set so the rule lives in one place and is impossible
 * to bypass from any call site.
 */
export const MEMBER_BOARD_ALLOWED_SELECTION_REASONS: ReadonlySet<string> =
  new Set(["model_watch_only"]);

export const MEMBER_BOARD_ALLOWED_SURFACE_STATUSES: ReadonlySet<string> =
  new Set(["model_watch"]);

/**
 * Minimal shape of a candidate the selector cares about. Kept structural
 * (not tied to the generated CandidateBet) so the test can construct
 * lightweight fixtures without dragging in the whole API client.
 *
 * `rankScore` and `ev` may arrive as strings from the wire; the selector
 * coerces with Number() to match the rest of the dashboard.
 *
 * `surfaceStatus` is the rebuild control-plane truth. `selectionReason`
 * remains useful for transition fallback and UI copy, but board
 * eligibility should prefer `surfaceStatus === 'model_watch'` whenever
 * the field is present on the wire.
 */
export interface RankableCandidate {
  rankScore: number | string;
  ev: number | string;
  surfaceStatus?: string | null;
  selectionReason?: string | null;
}

function hasRecognizedSurfaceStatus(c: RankableCandidate): boolean {
  return (
    c.surfaceStatus === "shadow" ||
    c.surfaceStatus === "model_watch" ||
    c.surfaceStatus === "official" ||
    c.surfaceStatus === "suppressed"
  );
}

function isAllowedCandidate(c: RankableCandidate): boolean {
  if (hasRecognizedSurfaceStatus(c)) {
    return (
      c.surfaceStatus === "model_watch" &&
      typeof c.selectionReason === "string" &&
      MEMBER_BOARD_ALLOWED_SELECTION_REASONS.has(c.selectionReason)
    );
  }

  return (
    typeof c.selectionReason === "string" &&
    MEMBER_BOARD_ALLOWED_SELECTION_REASONS.has(c.selectionReason)
  );
}

function toNum(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

/**
 * Pick the ranked Model Watch board cards for a Member, given the full
 * list of PASS-tier candidates for the day.
 *
 * Returns at most 5 candidates, sorted by rankScore desc. The input
 * order is not assumed to be sorted — the selector sorts a shallow copy
 * to keep the contract obvious at the call site.
 */
export function selectModelWatchBoardCandidates<T extends RankableCandidate>(
  passCandidates: readonly T[]
): T[] {
  if (passCandidates.length === 0) return [];

  // Filter against the allowed-selectionReason invariant BEFORE sorting
  // and slicing. The PASS tier is a union of multiple reasons, and rows
  // like nba_moneyline (selectionReason='market_disabled') can have the
  // strongest rankScore of the day — without this filter they would win
  // a board slot and render with the disabled-market copy. Centralising
  // the filter here means every call site (Dashboard, fallback section,
  // future surfaces) inherits the rule for free.
  const eligible = passCandidates.filter(isAllowedCandidate);
  if (eligible.length === 0) return [];

  const sorted = [...eligible].sort(
    (a, b) => toNum(b.rankScore) - toNum(a.rankScore)
  );

  // Always include the top N up to the default target (or all rows if
  // fewer than the default target exist).
  const baseCount = Math.min(MODEL_WATCH_BOARD_DEFAULT_TARGET, sorted.length);
  const result: T[] = sorted.slice(0, baseCount);

  if (sorted.length <= MODEL_WATCH_BOARD_DEFAULT_TARGET) {
    return result;
  }

  // Expansion stage: candidates 4..MAX must each independently clear
  // BOTH gates (rankScore >= 80% of #1 AND ev >= 0). Stop at the first
  // failure so the board never trails off into noticeably weaker leans.
  const topRank = toNum(sorted[0].rankScore);
  const minRank = topRank * MODEL_WATCH_BOARD_QUALITY_RATIO;

  for (
    let i = MODEL_WATCH_BOARD_DEFAULT_TARGET;
    i < sorted.length && i < MODEL_WATCH_BOARD_MAX;
    i++
  ) {
    const cand = sorted[i];
    const rank = toNum(cand.rankScore);
    const ev = toNum(cand.ev);
    if (rank >= minRank && ev >= 0) {
      result.push(cand);
    } else {
      break;
    }
  }

  return result;
}

/**
 * Pure render-decision for the "no Official picks today" section of the
 * dashboard. This is the branching the spec covers in Step 4 cases (a)–(e):
 *   - 'free-fallback': single highest-ranked PASS candidate (Free / signed-out)
 *   - 'member-board':  ranked Model Watch board (MVP), with the exact
 *                      title + disclaimer wired in at the data layer so
 *                      the Dashboard render is just a switch on `kind`.
 *   - 'no-action':     no PASS candidates exist for anyone today.
 *
 * Pulling this out of the JSX keeps the contract testable without a
 * React/jsdom rendering harness — we can directly assert which kind of
 * section the dashboard chooses for each (passCandidates, isMvp) pair,
 * which is all the spec's UI assertions actually depend on.
 *
 * Pre-condition (enforced by the caller in Dashboard.tsx): this is only
 * consulted when there are zero Official picks AND zero live
 * (non-PASS) candidates. That precondition is what guarantees the
 * negative assertion in case (e) — that no `TopPickCallout` /
 * Official-styled `PickCard` renders alongside the Model Watch board —
 * since those branches are mutually exclusive in the dashboard render
 * tree.
 */
export type DashboardFallbackSection<T extends RankableCandidate> =
  | { kind: "no-action" }
  | { kind: "free-fallback"; candidate: T }
  | {
      kind: "member-board";
      cards: T[];
      title: typeof MODEL_WATCH_BOARD_TITLE;
      disclaimer: typeof MODEL_WATCH_BOARD_DISCLAIMER;
    };

export function selectFallbackSection<T extends RankableCandidate>(args: {
  passCandidates: readonly T[];
  isMvp: boolean;
}): DashboardFallbackSection<T> {
  const { passCandidates, isMvp } = args;

  // Apply the allowed-selectionReason invariant up-front so BOTH the
  // Free single-card surface and the Member board agree on what's
  // eligible. Without this, a high-rankScore disabled-market PASS row
  // would leak into the Free fallback card just as easily as the Member
  // board (one disabled card with a strong rankScore => identical
  // exposure on the Public surface).
  const eligible = passCandidates.filter(isAllowedCandidate);

  if (eligible.length === 0) {
    return { kind: "no-action" };
  }

  if (!isMvp) {
    // Free / signed-out: single highest-ranked eligible PASS card.
    // Mirrors the existing reduce() in Dashboard.tsx but operates on
    // the post-filter list so disabled-market rows can never appear.
    const candidate = eligible.reduce((best, c) =>
      toNum(c.rankScore) > toNum(best.rankScore) ? c : best
    );
    return { kind: "free-fallback", candidate };
  }

  const cards = selectModelWatchBoardCandidates(eligible);
  // Defensive: if the board selector somehow returns nothing (e.g.
  // future quality-gate work shrinks the eligible pool to zero), fall
  // through to no-action rather than rendering an empty Member board
  // shell. selectModelWatchBoardCandidates already filters for the
  // allowed reasons, so this also covers the all-disabled case.
  if (cards.length === 0) {
    return { kind: "no-action" };
  }

  return {
    kind: "member-board",
    cards,
    title: MODEL_WATCH_BOARD_TITLE,
    disclaimer: MODEL_WATCH_BOARD_DISCLAIMER,
  };
}
