/**
 * Market probability utilities.
 * Converts American odds to implied probability and removes the vig
 * so that the two sides of a market sum to 1.
 */

export function americanToImplied(odds: number): number {
  if (odds >= 0) {
    return 100 / (odds + 100);
  }
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

export function americanToDecimal(odds: number): number {
  if (odds >= 0) {
    return odds / 100 + 1;
  }
  return 100 / Math.abs(odds) + 1;
}

/**
 * Remove vig from a two-sided market.
 * Returns fair probability for side A given side A and side B American odds.
 */
export function removeTwoSidedVig(oddsA: number, oddsB: number): { fairA: number; fairB: number } {
  const impliedA = americanToImplied(oddsA);
  const impliedB = americanToImplied(oddsB);
  const total = impliedA + impliedB;
  return {
    fairA: impliedA / total,
    fairB: impliedB / total,
  };
}

/**
 * For a single-side market (e.g. one side of a spread or total),
 * derive fair probability from a juice line (e.g. -110).
 * Assumes the other side has symmetric juice.
 */
export function singleSideFairProb(juiceLine: number): number {
  const implied = americanToImplied(juiceLine);
  const otherSideImplied = americanToImplied(-juiceLine > 0 ? -juiceLine : 100);
  const total = implied + otherSideImplied;
  return implied / total;
}

/**
 * Given a market type and available odds, compute fair market probability
 * for the requested side using vig removal.
 */
export function computeMarketProbFair(params: {
  marketType: "moneyline" | "spread" | "total";
  side: "home" | "away" | "over" | "under";
  homePublishMl: number;
  awayPublishMl: number;
  publishSpreadLine?: number | null;
  publishAwaySpreadLine?: number | null;
  publishOverLine?: number | null;
  publishUnderLine?: number | null;
}): number {
  const { marketType, side, homePublishMl, awayPublishMl } = params;

  if (marketType === "moneyline") {
    const { fairA, fairB } = removeTwoSidedVig(homePublishMl, awayPublishMl);
    return side === "home" ? fairA : fairB;
  }

  if (marketType === "spread") {
    const homeLine = params.publishSpreadLine ?? -110;
    // Prefer the real away juice; fall back to symmetric assumption only when absent.
    const awayLine =
      params.publishAwaySpreadLine ??
      (homeLine < 0 ? Math.abs(homeLine) : -homeLine);
    const { fairA, fairB } = removeTwoSidedVig(homeLine, awayLine);
    if (side === "home") return fairA;
    if (side === "away") return fairB;
  }

  if (marketType === "total") {
    const overLine = params.publishOverLine ?? -110;
    const underLine = params.publishUnderLine ?? -110;
    const { fairA, fairB } = removeTwoSidedVig(overLine, underLine);
    if (side === "over") return fairA;
    if (side === "under") return fairB;
  }

  return 0.5;
}

/**
 * Compute market quality score based on line availability and market type.
 * Returns 0.0–1.0.
 */
export function computeMarketQuality(params: {
  league: string;
  marketType: string;
  publishOdds: number;
  hasSpread: boolean;
  hasTotal: boolean;
}): number {
  const baseQuality: Record<string, Record<string, number>> = {
    nba: { moneyline: 1.0, spread: 0.95, total: 0.90 },
    ncaam: { moneyline: 0.85, spread: 0.80, total: 0.75 },
    nhl: { moneyline: 0.90, spread: 0.80, total: 0.80 },
  };

  const base = baseQuality[params.league]?.[params.marketType] ?? 0.7;

  if (params.marketType !== "moneyline" && !params.hasSpread && !params.hasTotal) {
    return base * 0.5;
  }

  const oddsExtreme = Math.abs(params.publishOdds) > 400;
  if (oddsExtreme) return base * 0.8;

  return base;
}
