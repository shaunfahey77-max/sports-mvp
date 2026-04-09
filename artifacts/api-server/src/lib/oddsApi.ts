import { getTeamAbbrev } from "./teamAbbreviations";

const BASE = "https://api.the-odds-api.com/v4";

export const SPORT_KEYS: Record<string, string> = {
  nba: "basketball_nba",
  nhl: "icehockey_nhl",
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
 * For spread shopping: compute a score for a home side (point, price) combination.
 * Lower point spread (e.g., -1.5 vs -3.5) at similar juice is better for home.
 * We score as: decimal_odds * spread_adjustment_factor
 */
function spreadHomeScore(point: number, price: number): number {
  const decimal = americanToDecimal(price);
  // Every 0.5 points of spread is worth roughly 2% probability
  const spreadAdj = Math.exp(point * 0.04); // higher point = better for home (less negative)
  return decimal * spreadAdj;
}

/**
 * Scan all bookmakers and pick the best available line for each market/side.
 */
export function pickBestLines(bookmakers: OddsBookmaker[], homeTeam: string, awayTeam: string): BestLines {
  let bestHome: { odds: number; book: string } | null = null;
  let bestAway: { odds: number; book: string } | null = null;
  let bestSpreadHome: { point: number; odds: number; book: string; score: number } | null = null;
  let bestSpreadAway: { point: number; odds: number; book: string; score: number } | null = null;
  let bestOver: { point: number; odds: number; book: string } | null = null;
  let bestUnder: { point: number; odds: number; book: string } | null = null;

  for (const bk of bookmakers) {
    // --- Moneyline (h2h) ---
    const h2h = bk.markets.find((m) => m.key === "h2h");
    if (h2h) {
      const homeOut = h2h.outcomes.find((o) => o.name === homeTeam);
      const awayOut = h2h.outcomes.find((o) => o.name === awayTeam);
      if (homeOut) {
        const homeDecimal = americanToDecimal(homeOut.price);
        if (!bestHome || homeDecimal > americanToDecimal(bestHome.odds)) {
          bestHome = { odds: homeOut.price, book: bk.key };
        }
      }
      if (awayOut) {
        const awayDecimal = americanToDecimal(awayOut.price);
        if (!bestAway || awayDecimal > americanToDecimal(bestAway.odds)) {
          bestAway = { odds: awayOut.price, book: bk.key };
        }
      }
    }

    // --- Spreads ---
    const spreads = bk.markets.find((m) => m.key === "spreads");
    if (spreads) {
      const homeOut = spreads.outcomes.find((o) => o.name === homeTeam);
      const awayOut = spreads.outcomes.find((o) => o.name === awayTeam);
      if (homeOut?.point != null) {
        const score = spreadHomeScore(homeOut.point, homeOut.price);
        if (!bestSpreadHome || score > bestSpreadHome.score) {
          bestSpreadHome = { point: homeOut.point, odds: homeOut.price, book: bk.key, score };
        }
      }
      if (awayOut?.point != null) {
        // Away score: higher point (less negative) is better; mirror of home
        const score = spreadHomeScore(-awayOut.point, awayOut.price);
        if (!bestSpreadAway || score > bestSpreadAway.score) {
          bestSpreadAway = { point: awayOut.point, odds: awayOut.price, book: bk.key, score };
        }
      }
    }

    // --- Totals ---
    const totals = bk.markets.find((m) => m.key === "totals");
    if (totals) {
      const overOut = totals.outcomes.find((o) => o.name === "Over");
      const underOut = totals.outcomes.find((o) => o.name === "Under");
      if (overOut?.point != null) {
        // For over: lower total + better price is more favorable
        const overScore = americanToDecimal(overOut.price) * Math.exp(-overOut.point * 0.02);
        const prevScore = bestOver ? americanToDecimal(bestOver.odds) * Math.exp(-bestOver.point * 0.02) : -Infinity;
        if (overScore > prevScore) {
          bestOver = { point: overOut.point, odds: overOut.price, book: bk.key };
        }
      }
      if (underOut?.point != null) {
        // For under: higher total + better price is more favorable
        const underScore = americanToDecimal(underOut.price) * Math.exp(underOut.point * 0.02);
        const prevScore = bestUnder ? americanToDecimal(bestUnder.odds) * Math.exp(bestUnder.point * 0.02) : -Infinity;
        if (underScore > prevScore) {
          bestUnder = { point: underOut.point, odds: underOut.price, book: bk.key };
        }
      }
    }
  }

  return {
    h2h:
      bestHome && bestAway
        ? { homeOdds: bestHome.odds, awayOdds: bestAway.odds, homeBook: bestHome.book, awayBook: bestAway.book }
        : null,
    spread:
      bestSpreadHome && bestSpreadAway
        ? {
            homePoint: bestSpreadHome.point,
            homeOdds: bestSpreadHome.odds,
            awayPoint: bestSpreadAway.point,
            awayOdds: bestSpreadAway.odds,
            homeBook: bestSpreadHome.book,
            awayBook: bestSpreadAway.book,
          }
        : null,
    total:
      bestOver && bestUnder
        ? {
            overPoint: bestOver.point,
            overOdds: bestOver.odds,
            underPoint: bestUnder.point,
            underOdds: bestUnder.odds,
            overBook: bestOver.book,
            underBook: bestUnder.book,
          }
        : null,
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
  const best = pickBestLines(game.bookmakers, game.home_team, game.away_team);
  if (!best.h2h) return null;

  const date = game.commence_time.split("T")[0];
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
