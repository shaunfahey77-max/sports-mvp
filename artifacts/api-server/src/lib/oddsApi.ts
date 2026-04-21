import { getTeamAbbrev } from "./teamAbbreviations";
import { SPREAD_LINE_ABS_MAX, TOTAL_LINE_RANGE } from "../config/scoringModelConfig";

const BASE = "https://api.the-odds-api.com/v4";

export const SPORT_KEYS: Record<string, string> = {
  nba: "basketball_nba",
  nhl: "icehockey_nhl",
  mlb: "baseball_mlb",
  // NFL Phase 0.75E foundation: registered for future ingest only.
  // The cron LEAGUES list intentionally does NOT include "nfl" yet —
  // adding it would burn API credits hitting empty offseason endpoints
  // (NFL preseason starts ~early August 2026). Wire into cron once the
  // nfl_spread model lands and preseason approaches.
  nfl: "americanfootball_nfl",
};

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsMarket {
  key: "h2h" | "spreads" | "totals";
  last_update: string;
  outcomes: OddsOutcome[];
}

export interface OddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsMarket[];
}

export interface OddsGame {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

export interface OddsScore {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{ name: string; score: string }> | null;
  last_update: string | null;
}

export interface OddsApiHeaders {
  requestsRemaining: number;
  requestsUsed: number;
}

export interface FetchResult<T> {
  data: T;
  headers: OddsApiHeaders;
}

function apiKey(): string {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY not set");
  return key;
}

async function oddsGet<T>(path: string, params: Record<string, string> = {}): Promise<FetchResult<T>> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("apiKey", apiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Odds API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as T;
  return {
    data,
    headers: {
      requestsRemaining: parseInt(res.headers.get("x-requests-remaining") ?? "0"),
      requestsUsed: parseInt(res.headers.get("x-requests-used") ?? "0"),
    },
  };
}

export async function fetchOdds(sportKey: string): Promise<FetchResult<OddsGame[]>> {
  return oddsGet<OddsGame[]>(`/sports/${sportKey}/odds`, {
    regions: "us",
    markets: "h2h,spreads,totals",
    oddsFormat: "american",
  });
}

export async function fetchScores(sportKey: string, daysFrom: number): Promise<FetchResult<OddsScore[]>> {
  return oddsGet<OddsScore[]>(`/sports/${sportKey}/scores`, {
    daysFrom: String(daysFrom),
  });
}

// The historical endpoints return a wrapper object, not a raw array
interface HistoricalResponse<T> {
  timestamp: string;
  previous_timestamp: string | null;
  next_timestamp: string | null;
  data: T;
}

export async function fetchHistoricalOdds(sportKey: string, isoDatetime: string): Promise<FetchResult<OddsGame[]>> {
  const result = await oddsGet<HistoricalResponse<OddsGame[]>>(`/historical/sports/${sportKey}/odds`, {
    date: isoDatetime,
    regions: "us",
    markets: "h2h,spreads,totals",
    oddsFormat: "american",
  });
  return { data: result.data.data ?? [], headers: result.headers };
}

export async function fetchHistoricalScores(sportKey: string, isoDatetime: string): Promise<FetchResult<OddsScore[]>> {
  const result = await oddsGet<HistoricalResponse<OddsScore[]>>(`/historical/sports/${sportKey}/scores`, {
    date: isoDatetime,
    daysFrom: "1",
  });
  return { data: result.data.data ?? [], headers: result.headers };
}

// ---------------------------------------------------------------------------
// Best-Line Shopping: picks the best available price / line across ALL books
// ---------------------------------------------------------------------------

interface BestH2H {
  homeOdds: number;
  awayOdds: number;
  homeBook: string;
  awayBook: string;
}

interface BestSpread {
  homePoint: number;
  homeOdds: number;
  awayPoint: number;
  awayOdds: number;
  homeBook: string;
  awayBook: string;
}

interface BestTotal {
  overPoint: number;
  overOdds: number;
  underPoint: number;
  underOdds: number;
  overBook: string;
  underBook: string;
}

export interface BestLines {
  h2h: BestH2H | null;
  spread: BestSpread | null;
  total: BestTotal | null;
}

/**
 * Converts American odds to decimal for comparison purposes.
 * Higher decimal = better payout for the bettor.
 */
function americanToDecimal(american: number): number {
  if (american >= 100) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

/**
 * Scan all bookmakers and pick the best available line for each market.
 *
 * Moneyline shops each side independently — there is no "line" concept to
 * mismatch, so best-price-per-side is safe.
 *
 * SPREADS and TOTALS use matched-pair shopping. For each distinct point
 * value offered across books, collect the best price for each side AT
 * THAT POINT, then pick the point whose matched pair has the best combined
 * decimal-odds sum. This prevents the root cause of the NHL spread/total
 * edge inflation investigated in Task #4: the previous independent-best
 * picker would pair home -1.5 (from book A) with away +2.5 (from book B),
 * or over 3.5 (from book A) with under 6.5 (from book B). The downstream
 * model then computes `rawProbAway = 1 - rawProbHome` under the assumption
 * that both sides are at the same line, and `computeMarketProbFair`
 * removes vig between two prices also assumed to share a line, producing
 * spurious edges of 30-50%.
 *
 * A per-league plausibility filter (SPREAD_LINE_ABS_MAX, TOTAL_LINE_RANGE)
 * additionally drops any line point outside the realistic main-line range
 * for that sport, catching alt-line / team-total / period-total leakage
 * that occasionally appears under the main `spreads` / `totals` market
 * keys in the feed.
 */
export function pickBestLines(
  bookmakers: OddsBookmaker[],
  homeTeam: string,
  awayTeam: string,
  league?: string
): BestLines {
  // --- Moneyline (independent best-per-side — no line to mismatch) ---
  let bestHome: { odds: number; book: string } | null = null;
  let bestAway: { odds: number; book: string } | null = null;
  for (const bk of bookmakers) {
    const h2h = bk.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;
    const homeOut = h2h.outcomes.find((o) => o.name === homeTeam);
    const awayOut = h2h.outcomes.find((o) => o.name === awayTeam);
    if (homeOut) {
      const d = americanToDecimal(homeOut.price);
      if (!bestHome || d > americanToDecimal(bestHome.odds)) {
        bestHome = { odds: homeOut.price, book: bk.key };
      }
    }
    if (awayOut) {
      const d = americanToDecimal(awayOut.price);
      if (!bestAway || d > americanToDecimal(bestAway.odds)) {
        bestAway = { odds: awayOut.price, book: bk.key };
      }
    }
  }

  // --- Spreads (matched-pair shopping) ---
  const spreadAbsMax = league ? SPREAD_LINE_ABS_MAX[league] : undefined;
  const spreadByPoint = new Map<
    number,
    { bestHome: { price: number; book: string } | null; bestAway: { price: number; book: string } | null }
  >();
  for (const bk of bookmakers) {
    const mkt = bk.markets.find((m) => m.key === "spreads");
    if (!mkt) continue;
    const homeOut = mkt.outcomes.find((o) => o.name === homeTeam);
    const awayOut = mkt.outcomes.find((o) => o.name === awayTeam);
    if (homeOut?.point == null || awayOut?.point == null) continue;
    // A single book's home and away spread must be zero-sum (home -X ↔ away +X).
    // If a book fails this, its own data is inconsistent — skip it.
    if (Math.abs(homeOut.point + awayOut.point) > 1e-6) continue;
    // Plausibility filter: drop alt-line leaks (e.g. NHL spread ±2.5 when
    // the main puck line is strictly ±1.5).
    if (spreadAbsMax != null && Math.abs(homeOut.point) > spreadAbsMax) continue;

    const entry =
      spreadByPoint.get(homeOut.point) ?? ({ bestHome: null, bestAway: null } as {
        bestHome: { price: number; book: string } | null;
        bestAway: { price: number; book: string } | null;
      });
    if (!entry.bestHome || americanToDecimal(homeOut.price) > americanToDecimal(entry.bestHome.price)) {
      entry.bestHome = { price: homeOut.price, book: bk.key };
    }
    if (!entry.bestAway || americanToDecimal(awayOut.price) > americanToDecimal(entry.bestAway.price)) {
      entry.bestAway = { price: awayOut.price, book: bk.key };
    }
    spreadByPoint.set(homeOut.point, entry);
  }
  let bestSpread: BestSpread | null = null;
  let bestSpreadScore = -Infinity;
  for (const [point, e] of spreadByPoint) {
    if (!e.bestHome || !e.bestAway) continue;
    const score = americanToDecimal(e.bestHome.price) + americanToDecimal(e.bestAway.price);
    if (score > bestSpreadScore) {
      bestSpreadScore = score;
      bestSpread = {
        homePoint: point,
        homeOdds: e.bestHome.price,
        homeBook: e.bestHome.book,
        awayPoint: -point,
        awayOdds: e.bestAway.price,
        awayBook: e.bestAway.book,
      };
    }
  }

  // --- Totals (matched-pair shopping) ---
  const totalRange = league ? TOTAL_LINE_RANGE[league] : undefined;
  const totalByPoint = new Map<
    number,
    { bestOver: { price: number; book: string } | null; bestUnder: { price: number; book: string } | null }
  >();
  for (const bk of bookmakers) {
    const mkt = bk.markets.find((m) => m.key === "totals");
    if (!mkt) continue;
    const overOut = mkt.outcomes.find((o) => o.name === "Over");
    const underOut = mkt.outcomes.find((o) => o.name === "Under");
    if (overOut?.point == null || underOut?.point == null) continue;
    // A single book's over and under total must share the same point.
    if (Math.abs(overOut.point - underOut.point) > 1e-6) continue;
    if (totalRange && (overOut.point < totalRange.min || overOut.point > totalRange.max)) continue;

    const entry =
      totalByPoint.get(overOut.point) ?? ({ bestOver: null, bestUnder: null } as {
        bestOver: { price: number; book: string } | null;
        bestUnder: { price: number; book: string } | null;
      });
    if (!entry.bestOver || americanToDecimal(overOut.price) > americanToDecimal(entry.bestOver.price)) {
      entry.bestOver = { price: overOut.price, book: bk.key };
    }
    if (!entry.bestUnder || americanToDecimal(underOut.price) > americanToDecimal(entry.bestUnder.price)) {
      entry.bestUnder = { price: underOut.price, book: bk.key };
    }
    totalByPoint.set(overOut.point, entry);
  }
  let bestTotal: BestTotal | null = null;
  let bestTotalScore = -Infinity;
  for (const [point, e] of totalByPoint) {
    if (!e.bestOver || !e.bestUnder) continue;
    const score = americanToDecimal(e.bestOver.price) + americanToDecimal(e.bestUnder.price);
    if (score > bestTotalScore) {
      bestTotalScore = score;
      bestTotal = {
        overPoint: point,
        overOdds: e.bestOver.price,
        overBook: e.bestOver.book,
        underPoint: point,
        underOdds: e.bestUnder.price,
        underBook: e.bestUnder.book,
      };
    }
  }

  return {
    h2h:
      bestHome && bestAway
        ? { homeOdds: bestHome.odds, awayOdds: bestAway.odds, homeBook: bestHome.book, awayBook: bestAway.book }
        : null,
    spread: bestSpread,
    total: bestTotal,
  };
}

/** @deprecated Use pickBestLines instead */
export function pickBestBookmaker(bookmakers: OddsBookmaker[], marketKey: string): OddsMarket | null {
  const BOOK_PRIORITY = ["draftkings", "fanduel", "betmgm", "caesars", "pointsbetus", "williamhill_us", "bovada"];
  for (const bk of BOOK_PRIORITY) {
    const found = bookmakers.find((b) => b.key === bk);
    if (found) {
      const mkt = found.markets.find((m) => m.key === marketKey);
      if (mkt && mkt.outcomes.length > 0) return mkt;
    }
  }
  for (const bk of bookmakers) {
    const mkt = bk.markets.find((m) => m.key === marketKey);
    if (mkt && mkt.outcomes.length > 0) return mkt;
  }
  return null;
}

export interface TransformedSnapshot {
  gameKey: string;
  league: string;
  eventStart: string;
  homeTeam: string;
  awayTeam: string;
  homePublishMl: number;
  awayPublishMl: number;
  publishSpread: number | null;
  publishSpreadLine: number | null;
  publishAwaySpreadLine: number | null;
  publishTotal: number | null;
  publishOverLine: number | null;
  publishUnderLine: number | null;
  snapshotDate: string;
  bestBooks: {
    moneylineHome?: string;
    moneylineAway?: string;
    spreadHome?: string;
    spreadAway?: string;
    totalOver?: string;
    totalUnder?: string;
  };
}

/**
 * Transform a raw OddsGame into our internal snapshot format,
 * using best available line across ALL bookmakers.
 */
export function transformGame(game: OddsGame, league: string): TransformedSnapshot | null {
  const best = pickBestLines(game.bookmakers, game.home_team, game.away_team, league);
  if (!best.h2h) return null;

  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(game.commence_time));
  const awayAbbrev = getTeamAbbrev(game.away_team, league);
  const homeAbbrev = getTeamAbbrev(game.home_team, league);
  const gameKey = `${league}_${date}_${awayAbbrev}_${homeAbbrev}`;

  return {
    gameKey,
    league,
    eventStart: game.commence_time,
    homeTeam: game.home_team,
    awayTeam: game.away_team,
    homePublishMl: best.h2h.homeOdds,
    awayPublishMl: best.h2h.awayOdds,
    publishSpread: best.spread?.homePoint ?? null,
    publishSpreadLine: best.spread?.homeOdds ?? null,
    publishAwaySpreadLine: best.spread?.awayOdds ?? null,
    publishTotal: best.total?.overPoint ?? null,
    publishOverLine: best.total?.overOdds ?? null,
    publishUnderLine: best.total?.underOdds ?? null,
    snapshotDate: date,
    bestBooks: {
      moneylineHome: best.h2h.homeBook,
      moneylineAway: best.h2h.awayBook,
      spreadHome: best.spread?.homeBook,
      spreadAway: best.spread?.awayBook,
      totalOver: best.total?.overBook,
      totalUnder: best.total?.underBook,
    },
  };
}
