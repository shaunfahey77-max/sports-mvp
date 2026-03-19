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

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return ymd(dt);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
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

const days = Number(process.argv[2] || 90);
const leagues = String(process.argv[3] || "nba,nhl,ncaam")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

for (let d = days - 1; d >= 0; d--) {
  const date = addDays(todayUtc(), -d);
  for (const league of leagues) {
    const out = await buildPredictions(league, date);
    const games = Array.isArray(out?.games) ? out.games : [];
    const picks = games.filter((g) => g?.market?.recommendedMarket).length;

    const written = await writeSlatePicksToLedger({
      date,
      league,
      games,
      modelVersion:
        out?.meta?.modelVersion ??
        out?.meta?.model?.version ??
        out?.meta?.version ??
        null,
    });

    console.log(
      JSON.stringify(
        {
          type: "seed",
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
