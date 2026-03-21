import "dotenv/config";
import {
  buildNbaPredictions,
  buildNhlPredictions,
  buildNcaamPredictions,
} from "../routes/predict.js";
import { writeSlatePicksToLedger } from "../db/dailyLedger.js";

function ymd(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function* dateRange(start, end) {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const last = new Date(Date.UTC(ey, em - 1, ed));

  while (cur <= last) {
    yield ymd(cur);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

function parseArgs() {
  const raw = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const cleaned = arg.replace(/^--/, "");
      const idx = cleaned.indexOf("=");
      if (idx === -1) return [cleaned, true];
      return [cleaned.slice(0, idx), cleaned.slice(idx + 1)];
    })
  );

  return {
    start: String(raw.start || "").trim(),
    end: String(raw.end || "").trim(),
    leagues: String(raw.leagues || "nba,nhl,ncaam")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    dryRun: String(raw["dry-run"] || "false").toLowerCase() === "true",
  };
}

async function buildPredictions(league, date) {
  if (league === "nba") return await buildNbaPredictions(date, 14);
  if (league === "nhl") return await buildNhlPredictions(date, 60);
  if (league === "ncaam") {
    return await buildNcaamPredictions(date, 45, {
      tournamentMode: false,
      modeLabel: "regular",
    });
  }
  throw new Error(`Unsupported league: ${league}`);
}

const args = parseArgs();

if (!isYmd(args.start) || !isYmd(args.end)) {
  console.error(
    "Usage: node src/scripts/seedHistoricalRange.js --start=2024-10-01 --end=2026-03-19 --leagues=nba,nhl,ncaam --dry-run=true"
  );
  process.exit(1);
}

let totalDates = 0;
let totalGames = 0;
let totalPicks = 0;
let totalWritten = 0;

for (const date of dateRange(args.start, args.end)) {
  totalDates += 1;

  for (const league of args.leagues) {
    const out = await buildPredictions(league, date);
    const games = Array.isArray(out?.games) ? out.games : [];
    const picks = games.filter((g) => g?.market?.recommendedMarket).length;

    let written = { ok: true, written: 0, skipped: args.dryRun };
    if (!args.dryRun) {
      written = await writeSlatePicksToLedger({
        date,
        league,
        games,
        modelVersion:
          out?.meta?.modelVersion ??
          out?.meta?.model?.version ??
          out?.meta?.version ??
          null,
      });
    }

    totalGames += games.length;
    totalPicks += picks;
    totalWritten += Number(written?.written || 0);

    console.log(
      JSON.stringify(
        {
          type: "seed-range",
          date,
          league,
          games: games.length,
          picks,
          written,
        },
        null,
        2
      )
    );
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      start: args.start,
      end: args.end,
      leagues: args.leagues,
      dryRun: args.dryRun,
      totalDates,
      totalGames,
      totalPicks,
      totalWritten,
    },
    null,
    2
  )
);
