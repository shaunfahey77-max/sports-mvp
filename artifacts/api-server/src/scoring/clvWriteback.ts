/**
 * CLV writeback helper. Given a settled pick + the matching game snapshot,
 * computes the four CLV-related columns that get written back to scored_picks
 * (close_odds, close_line, clv_implied_delta, clv_line_delta).
 *
 * Centralizes the logic so the nightly validation path and the ESPN backfill
 * path stay in lockstep, and so the historical-backfill script reuses the
 * exact same mapping.
 *
 * Side conventions for spread:
 *   - "home" pick: close_odds = closeSpreadLine,     close_line =  closeSpread
 *   - "away" pick: close_odds = closeAwaySpreadLine, close_line = -closeSpread
 *
 * Side conventions for total:
 *   - "over"  pick: close_odds = closeOverLine,  close_line = closeTotal
 *   - "under" pick: close_odds = closeUnderLine, close_line = closeTotal
 *
 * Moneyline has no line — only close_odds is written.
 */

import { computeClvImpliedDelta, computeClvLineDelta } from "./expectedValue";

export interface CloseSourceSnapshot {
  homeCloseMl: string | null;
  awayCloseMl: string | null;
  closeSpread: string | null;
  closeSpreadLine: string | null;
  closeAwaySpreadLine: string | null;
  closeTotal: string | null;
  closeOverLine: string | null;
  closeUnderLine: string | null;
}

export interface CloseSourcePick {
  market: string;
  pick: string;
  publishOdds: string;
  publishLine: string | null;
}

export interface ClvWritebackValues {
  closeOdds: string | undefined;
  closeLine: string | undefined;
  clvImpliedDelta: string | undefined;
  clvLineDelta: string | undefined;
}

function parseOrNull(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function computeClvWritebackValues(
  pick: CloseSourcePick,
  snap: CloseSourceSnapshot,
): ClvWritebackValues {
  const publishOdds = parseFloat(pick.publishOdds);
  const publishLine = parseOrNull(pick.publishLine);

  let closeOddsNum: number | null = null;
  let closeLineNum: number | null = null;
  let lineSide: "home" | "away" | "over" | "under" | null = null;

  if (pick.market === "moneyline") {
    if (pick.pick === "home") {
      closeOddsNum = parseOrNull(snap.homeCloseMl);
    } else if (pick.pick === "away") {
      closeOddsNum = parseOrNull(snap.awayCloseMl);
    }
    // Unknown side → all fields stay null/undefined (no silent misclassification).
    // Moneyline has no line; lineSide stays null so clvLineDelta will be undefined.
  } else if (pick.market === "spread") {
    const closeSpread = parseOrNull(snap.closeSpread);
    if (pick.pick === "home") {
      closeOddsNum = parseOrNull(snap.closeSpreadLine);
      closeLineNum = closeSpread;
      lineSide = "home";
    } else if (pick.pick === "away") {
      // Away spread price lives in closeAwaySpreadLine (added in Plan 1).
      // Away line is the negation of the canonical home spread.
      closeOddsNum = parseOrNull(snap.closeAwaySpreadLine);
      closeLineNum = closeSpread != null ? -closeSpread : null;
      lineSide = "away";
    }
    // Unknown side (e.g. "over"/"under" on spread) → all fields stay null.
  } else if (pick.market === "total") {
    if (pick.pick === "over") {
      closeOddsNum = parseOrNull(snap.closeOverLine);
      closeLineNum = parseOrNull(snap.closeTotal);
      lineSide = "over";
    } else if (pick.pick === "under") {
      closeOddsNum = parseOrNull(snap.closeUnderLine);
      closeLineNum = parseOrNull(snap.closeTotal);
      lineSide = "under";
    }
    // Unknown side (e.g. "home"/"away" on total) → all fields stay null.
  }
  // Unknown market → all fields stay null/undefined.

  const clvImplied = computeClvImpliedDelta(publishOdds, closeOddsNum);
  const clvLine =
    lineSide != null ? computeClvLineDelta(publishLine, closeLineNum, lineSide) : null;

  return {
    closeOdds: closeOddsNum != null ? String(closeOddsNum) : undefined,
    closeLine: closeLineNum != null ? String(closeLineNum) : undefined,
    clvImpliedDelta: clvImplied != null ? String(clvImplied) : undefined,
    clvLineDelta: clvLine != null ? String(clvLine) : undefined,
  };
}
