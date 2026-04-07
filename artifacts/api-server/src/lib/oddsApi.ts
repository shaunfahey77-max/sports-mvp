import { getTeamAbbrev } from "./teamAbbreviations";

const BASE = "https://api.the-odds-api.com/v4";
const BOOK_PRIORITY = ["draftkings", "fanduel", "betmgm", "caesars", "pointsbetus", "williamhill_us", "bovada"];

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

/** Pick the best bookmaker line from priority list, falling back to first available */
export function pickBestBookmaker(bookmakers: OddsBookmaker[], marketKey: string): OddsMarket | null {
  for (const bk of BOOK_PRIORITY) {
    const found = bookmakers.find((b) => b.key === bk);
    if (found) {
      const mkt = found.markets.find((m) => m.key === marketKey);
      if (mkt && mkt.outcomes.length > 0) return mkt;
    }
  }
  // Fallback: first bookmaker that has this market
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
}

export function transformGame(game: OddsGame, league: string): TransformedSnapshot | null {
  const h2h = pickBestBookmaker(game.bookmakers, "h2h");
  if (!h2h) return null;

  const homeH2h = h2h.outcomes.find((o) => o.name === game.home_team);
  const awayH2h = h2h.outcomes.find((o) => o.name === game.away_team);
  if (!homeH2h || !awayH2h) return null;

  const spreads = pickBestBookmaker(game.bookmakers, "spreads");
  let publishSpread: number | null = null;
  let publishSpreadLine: number | null = null;
  if (spreads) {
    const homeSpread = spreads.outcomes.find((o) => o.name === game.home_team);
    if (homeSpread?.point != null) {
      publishSpread = homeSpread.point;
      publishSpreadLine = homeSpread.price;
    }
  }

  const totals = pickBestBookmaker(game.bookmakers, "totals");
  let publishTotal: number | null = null;
  let publishOverLine: number | null = null;
  let publishUnderLine: number | null = null;
  if (totals) {
    const over = totals.outcomes.find((o) => o.name === "Over");
    const under = totals.outcomes.find((o) => o.name === "Under");
    if (over?.point != null) {
      publishTotal = over.point;
      publishOverLine = over.price;
      publishUnderLine = under?.price ?? over.price;
    }
  }

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
    homePublishMl: homeH2h.price,
    awayPublishMl: awayH2h.price,
    publishSpread,
    publishSpreadLine,
    publishTotal,
    publishOverLine,
    publishUnderLine,
    snapshotDate: date,
  };
}
