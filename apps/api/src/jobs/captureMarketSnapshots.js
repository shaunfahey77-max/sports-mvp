import "dotenv/config";
import { buildNbaPredictions, buildNhlPredictions, buildNcaamPredictions } from "../routes/predict.js";
import { upsertMarketSnapshotsBatch } from "../db/marketSnapshots.js";

function yyyymmddUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function normalizeDateParam(date) {
  const d = String(date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((x) => String(x).startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function normMarket(x) {
  const m = String(x || "moneyline").trim().toLowerCase();
  if (!m) return "moneyline";
  if (m === "ml" || m === "money" || m === "h2h") return "moneyline";
  if (m === "spread" || m === "spreads") return "spread";
  if (m === "total" || m === "totals" || m === "ou") return "total";
  return m;
}

function ensureGameKey(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (s === "undefined" || s === "null") return null;
  return s;
}

function getGameKeyForLedger(g, date) {
  return (
    g?.gameKey ||
    g?.game_key ||
    g?.id ||
    g?.gameId ||
    g?.eventId ||
    `${g?.away?.abbr || g?.away?.name || "AWAY"}@${g?.home?.abbr || g?.home?.name || "HOME"}:${date}`
  );
}

function getEventStart(g) {
  return (
    g?.startTime ||
    g?.start_time ||
    g?.commenceTime ||
    g?.commence_time ||
    g?.gameTime ||
    g?.dateTime ||
    null
  );
}

async function buildPredictionsInternal(league, date) {
  if (league === "nba") return await buildNbaPredictions(date, 14);
  if (league === "nhl") return await buildNhlPredictions(date, 60);
  if (league === "ncaam") {
    return await buildNcaamPredictions(date, 45, {
      tournamentMode: false,
      modeLabel: "regular",
    });
  }
  return { meta: { league, date, error: "unsupported league" }, games: [] };
}

async function main() {
  const date = normalizeDateParam(getArg("date")) || yyyymmddUTC(new Date());
  const leagues = String(getArg("leagues", "nba,ncaam,nhl"))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const captured_at = new Date().toISOString();
  const summary = [];

  for (const league of leagues) {
    const out = await buildPredictionsInternal(league, date);
    const games = Array.isArray(out?.games) ? out.games : [];
    const rows = [];

    for (const g of games) {
      const m = g?.market ?? {};
      const bet = g?.recommendedBet ?? null;
      const compat = g?.market ?? {};

      const game_key = ensureGameKey(getGameKeyForLedger(g, date));
      if (!game_key) continue;

      const market = normMarket(
        bet?.marketType ??
        compat?.marketType ??
        compat?.recommendedMarket ??
        m?.marketType ??
        m?.market ??
        m?.type ??
        g?.marketType ??
        "moneyline"
      );

      const pick =
        bet?.side ??
        compat?.pick ??
        m?.pick ??
        g?.pick ??
        "PASS";

      const odds =
        bet?.odds ??
        compat?.marketOdds ??
        m?.marketOdds ??
        m?.odds ??
        g?.odds ??
        null;

      const line =
        bet?.line ??
        compat?.marketLine ??
        m?.marketLine ??
        m?.line ??
        g?.line ??
        null;

      const side =
        bet?.side ??
        compat?.marketSide ??
        m?.marketSide ??
        null;

      const book =
        bet?.book ??
        compat?.book ??
        m?.book ??
        g?.book ??
        null;

      const mode =
        g?.mode ??
        g?.modeLabel ??
        "regular";

      rows.push({
        snapshot_date: date,
        league,
        mode,
        game_key,
        market,
        market_type: market,
        pick,
        side,
        line,
        odds,
        book,
        event_start: getEventStart(g),
        captured_at,
      });
    }

    const written = await upsertMarketSnapshotsBatch(rows, { chunkSize: 500 });

    summary.push({
      league,
      date,
      games: games.length,
      snapshotsWritten: written.written,
    });
  }

  console.log(JSON.stringify({ ok: true, captured_at, results: summary }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }, null, 2));
  process.exit(1);
});
