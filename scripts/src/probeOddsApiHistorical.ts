/**
 * One-shot probe to verify The Odds API historical endpoint works for a
 * given league + date, and to report exact credit cost and remaining
 * balance before committing to a full-season ingest.
 *
 * Read-only: makes ONE historical odds call. Does NOT write to the DB.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx src/probeOddsApiHistorical.ts \
 *     --league nfl --date 2025-01-05
 */

const SPORT_KEYS: Record<string, string> = {
  nba: "basketball_nba",
  nhl: "icehockey_nhl",
  mlb: "baseball_mlb",
  nfl: "americanfootball_nfl",
  ncaaf: "americanfootball_ncaaf",
};

interface Args {
  league: string;
  date: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === "--league") out.league = next();
    else if (a === "--date") out.date = next();
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.league || !out.date) {
    throw new Error("Both --league and --date are required");
  }
  return out as Args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.error("ODDS_API_KEY not set");
    process.exit(1);
  }
  const sportKey = SPORT_KEYS[args.league];
  if (!sportKey) {
    console.error(`Unknown league: ${args.league}`);
    process.exit(1);
  }

  const isoDatetime = `${args.date}T16:00:00Z`;
  const params = new URLSearchParams({
    apiKey,
    date: isoDatetime,
    regions: "us",
    markets: "h2h,spreads,totals",
    oddsFormat: "american",
  });
  const url = `https://api.the-odds-api.com/v4/historical/sports/${sportKey}/odds?${params.toString()}`;

  const t0 = Date.now();
  const res = await fetch(url);
  const elapsedMs = Date.now() - t0;

  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  const last = res.headers.get("x-requests-last");

  if (!res.ok) {
    const body = await res.text();
    console.error(JSON.stringify({
      ok: false,
      status: res.status,
      elapsedMs,
      creditsRemaining: remaining,
      creditsUsed: used,
      lastCallCost: last,
      body: body.slice(0, 500),
    }, null, 2));
    process.exit(2);
  }

  const json = (await res.json()) as {
    timestamp?: string;
    previous_timestamp?: string;
    next_timestamp?: string;
    data?: Array<{
      id: string;
      sport_key: string;
      commence_time: string;
      home_team: string;
      away_team: string;
      bookmakers?: Array<{ key: string; markets?: unknown[] }>;
    }>;
  };

  const games = json.data ?? [];
  const sample = games.slice(0, 3).map((g) => ({
    id: g.id,
    commence_time: g.commence_time,
    matchup: `${g.away_team} @ ${g.home_team}`,
    bookmakers: g.bookmakers?.length ?? 0,
  }));

  console.log(JSON.stringify({
    ok: true,
    league: args.league,
    sportKey,
    queriedAt: isoDatetime,
    snapshotTimestamp: json.timestamp,
    previousSnapshot: json.previous_timestamp,
    nextSnapshot: json.next_timestamp,
    elapsedMs,
    creditsRemaining: remaining ? Number(remaining) : null,
    creditsUsed: used ? Number(used) : null,
    lastCallCost: last ? Number(last) : null,
    gameCount: games.length,
    sample,
  }, null, 2));
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
