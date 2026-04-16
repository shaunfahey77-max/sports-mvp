import { MAX_PICKS_PER_LEAGUE_PER_DAY, MAX_PICKS_PER_GAME } from "../config/scoringModelConfig";

/**
 * Return the (gameKey, market, pick) tuples that must be removed from
 * `scored_picks` for a given scoring run because the candidate that
 * previously produced them is now PASS.
 *
 * Rationale: scoring routes only upsert non-PASS candidates into
 * `scored_picks`. If a candidate flips from A/B/C to PASS across runs
 * (e.g. new odds-range guardrail, line movement pushing edge below
 * threshold), its prior surfaced row would remain visible to subscribers.
 * Call this alongside the scored-picks upsert to delete those stale rows.
 *
 * Only PASS candidates from the current batch are considered — settled
 * results are never touched because callers should additionally scope the
 * DELETE to `result = 'pending'`.
 */
export function computeStaleScoredPicksKeys<
  T extends { tier: string; gameKey: string; marketType: string; side: string }
>(candidates: T[]): Array<{ gameKey: string; market: string; pick: string }> {
  return candidates
    .filter((c) => c.tier === "PASS")
    .map((c) => ({ gameKey: c.gameKey, market: c.marketType, pick: c.side }));
}

/**
 * Apply per-league and per-game caps to a set of picks, then sort chronologically.
 *
 * Algorithm:
 *  1. Input must be pre-sorted by rankScore DESC (best picks first).
 *  2. Walk picks in rankScore order; admit a pick only if:
 *     - Its league has fewer than MAX_PICKS_PER_LEAGUE_PER_DAY admitted picks, AND
 *     - Its gameKey has fewer than MAX_PICKS_PER_GAME admitted picks.
 *  3. After capping, sort the admitted set chronologically (eventStart ASC),
 *     with rankScore DESC as the tiebreaker within the same start time.
 */
export function capAndSort<T extends {
  league: string;
  gameKey: string;
  eventStart: Date | string;
  rankScore: string | number;
}>(picks: T[]): T[] {
  const leagueCount: Record<string, number> = {};
  const gameCount: Record<string, number> = {};
  const admitted: T[] = [];

  for (const pick of picks) {
    const lc = leagueCount[pick.league] ?? 0;
    const gc = gameCount[pick.gameKey] ?? 0;

    if (lc >= MAX_PICKS_PER_LEAGUE_PER_DAY) continue;
    if (gc >= MAX_PICKS_PER_GAME) continue;

    admitted.push(pick);
    leagueCount[pick.league] = lc + 1;
    gameCount[pick.gameKey] = gc + 1;
  }

  // Sort chronologically, best pick first when games share the same start time
  admitted.sort((a, b) => {
    const tA = new Date(a.eventStart).getTime();
    const tB = new Date(b.eventStart).getTime();
    if (tA !== tB) return tA - tB;
    return Number(b.rankScore) - Number(a.rankScore);
  });

  return admitted;
}
