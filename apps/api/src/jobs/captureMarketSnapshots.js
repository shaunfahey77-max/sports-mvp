import "dotenv/config";
import { buildNbaPredictions, buildNhlPredictions, buildNcaamPredictions } from "../routes/predict.js";
import { upsertMarketSnapshotsBatch } from "../db/marketSnapshots.js";
import { supabase } from "../db/dailyLedger.js";

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
  const m = String(x || "").trim().toLowerCase();
  if (m === "ml" || m === "money" || m === "h2h") return "moneyline";
  if (m === "spread" || m === "spreads") return "spread";
  if (m === "total" || m === "totals" || m === "ou") return "total";
  return m || "moneyline";
}

function normPick(x) {
  return String(x || "").trim().toLowerCase();
}

function ensureGameKey(v) {
  const s = String(v || "").trim();
  if (!s || s === "undefined" || s === "null") return null;
  return s;
}

function normBookKey(x) {
  return String(x || "").trim().toLowerCase().replace(/\s+/g, "_");
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
    g?.eventStart ||
    g?.event_start ||
    g?.startTime ||
    g?.start_time ||
    g?.commenceTime ||
    g?.commence_time ||
    g?.gameTime ||
    g?.dateTime ||
    null
  );
}

function toMillis(v) {
  const t = Date.parse(v || "");
  return Number.isFinite(t) ? t : null;
}

function sameNumber(a, b) {
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

function getMarketNodeForStoredMarket(g, market) {
  const wanted = normMarket(market);

  const recommendedNode = g?.market ?? null;
  const recommendedMarket = normMarket(
    recommendedNode?.recommendedMarket ||
    recommendedNode?.market ||
    recommendedNode?.marketType ||
    recommendedNode?.type ||
    null
  );

  const candidates = [
    g?.markets?.[wanted],
    g?.marketBreakdown?.[wanted],
    g?.oddsComparisonByMarket?.[wanted],
    wanted === "moneyline" ? g?.moneyline : null,
    wanted === "spread" ? g?.spread : null,
    wanted === "total" ? g?.total : null,
    wanted === "moneyline" ? g?.moneylineMarket : null,
    wanted === "spread" ? g?.spreadMarket : null,
    wanted === "total" ? g?.totalMarket : null,
  ].filter(Boolean);

  for (const node of candidates) {
    const nodeMarket = normMarket(
      node?.recommendedMarket ||
      node?.market ||
      node?.marketType ||
      node?.type ||
      wanted
    );

    if (nodeMarket === wanted && node?.oddsComparison) {
      return node;
    }
  }

  if (recommendedNode?.oddsComparison && recommendedMarket === wanted) {
    return recommendedNode;
  }

  return null;
}

function filterBooksForStoredPick(books, market, pick, publishLine, publishOdds, eventStart) {
  const candidates = Array.isArray(books) ? books.filter(Boolean) : [];
  if (!candidates.length) return [];

  const eventStartMs = toMillis(eventStart);
  const targetLine = Number(publishLine);
  const targetOdds = Number(publishOdds);

  const enriched = candidates
    .map((b) => {
      const line = Number(b?.line);
      const odds = Number(b?.odds);
      const updatedMs = toMillis(b?.lastUpdate);
      const hasLine = Number.isFinite(line);
      const hasOdds = Number.isFinite(odds);
      const beforeStart =
        eventStartMs == null || updatedMs == null ? true : updatedMs <= eventStartMs;

      return {
        raw: b,
        line,
        odds,
        updatedMs,
        hasLine,
        hasOdds,
        beforeStart,
      };
    })
    .filter((x) => x.hasOdds && x.beforeStart);

  if (!enriched.length) return [];

  if (market === "moneyline") {
    if (Number.isFinite(targetOdds)) {
      const exactOdds = enriched.filter((x) => x.odds === targetOdds);
      if (exactOdds.length) return exactOdds.map((x) => x.raw);
    }
    return enriched.map((x) => x.raw);
  }

  const withLine = enriched.filter((x) => x.hasLine);
  if (!withLine.length) return [];

  const sameLine = Number.isFinite(targetLine)
    ? withLine.filter((x) => x.line === targetLine)
    : [];

  if (sameLine.length) {
    if (Number.isFinite(targetOdds)) {
      const exactOdds = sameLine.filter((x) => x.odds === targetOdds);
      if (exactOdds.length) return exactOdds.map((x) => x.raw);
    }
    return sameLine.map((x) => x.raw);
  }

  return withLine.map((x) => x.raw);
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

    const gameMap = new Map();
    for (const g of games) {
      const game_key = ensureGameKey(getGameKeyForLedger(g, date));
      if (game_key) gameMap.set(game_key, g);
    }

    const { data: storedPicks, error: storedPicksError } = await supabase
      .from("picks_daily")
      .select("date,league,mode,game_key,market,pick,publish_book,publish_line,publish_odds,market_line,market_odds")
      .eq("date", date)
      .eq("league", league);

    if (storedPicksError) {
      throw new Error(`stored picks fetch failed: ${storedPicksError.message}`);
    }

    for (const pickRow of storedPicks || []) {
      const g = gameMap.get(pickRow.game_key);
      if (!g) continue;

      const market = normMarket(pickRow.market);
      const pick = normPick(pickRow.pick);
      if (!market || !pick || pick === "pass") continue;

      const marketNode = getMarketNodeForStoredMarket(g, market);
      if (!marketNode?.oddsComparison) continue;

      const oddsComparison = marketNode.oddsComparison;
      const books = Array.isArray(oddsComparison?.books) ? oddsComparison.books : [];
      const eventStart = getEventStart(g);

      const matchedBooks = filterBooksForStoredPick(
        books,
        market,
        pick,
        pickRow.publish_line ?? pickRow.market_line,
        pickRow.publish_odds ?? pickRow.market_odds,
        eventStart
      );

      for (const bookRow of matchedBooks) {
        const book = bookRow?.book ?? bookRow?.bookKey ?? null;
        const bookKey = bookRow?.bookKey ?? null;
        const line = bookRow?.line ?? null;
        const odds = bookRow?.odds ?? null;
        const realCapturedAt = bookRow?.lastUpdate ?? null;

        const hasRealHistoricalSource =
          book != null &&
          realCapturedAt != null &&
          odds != null &&
          (market === "moneyline" || line != null);

        if (!hasRealHistoricalSource) continue;

        const snapshot_key = [
          date,
          league,
          pickRow.game_key,
          market,
          pick,
          normBookKey(bookKey || book),
          realCapturedAt
        ].join("|");

        rows.push({
          snapshot_key,
          snapshot_date: date,
          league,
          mode: pickRow.mode ?? g?.mode ?? g?.modeLabel ?? "regular",
          game_key: pickRow.game_key,
          market,
          market_type: market,
          pick,
          side: pick,
          line,
          odds,
          book,
          event_start: eventStart,
          captured_at: realCapturedAt,
          meta: {
            source: "captureMarketSnapshots",
            bookKey,
            preferredBook: oddsComparison?.preferredBook ?? null,
            bestBook: oddsComparison?.bestBook ?? null,
            bestBookKey: oddsComparison?.bestBookKey ?? null,
            publishBook: pickRow.publish_book ?? null,
            publishLine: pickRow.publish_line ?? pickRow.market_line ?? null,
            publishOdds: pickRow.publish_odds ?? pickRow.market_odds ?? null,
          },
        });
      }
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
