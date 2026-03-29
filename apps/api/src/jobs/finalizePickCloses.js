import { supabase } from "../db/dailyLedger.js";
  import { upsertPickClosesBatch } from "../db/pickCloses.js";

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
    const argv = process.argv.slice(2).map((x) => String(x));
    for (const arg of argv) {
      if (arg.startsWith(`--${name}=`)) return arg.slice(`--${name}=`.length);
      if (arg.startsWith(`${name}=`)) return arg.slice(`${name}=`.length);
    }
    if (name === "date") {
      const positional = argv.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
      if (positional) return positional;
    }
    return fallback;
  }

  function normMarket(x) {
    const m = String(x || "").trim().toLowerCase();
    if (m === "ml" || m === "money" || m === "h2h") return "moneyline";
    if (m === "spread" || m === "spreads") return "spread";
    if (m === "total" || m === "totals" || m === "ou") return "total";
    return m;
  }

  function normPick(x) {
    return String(x || "").trim().toLowerCase();
  }

  function normBook(x) {
    return String(x || "").trim().toLowerCase();
  }

  function toMillis(v) {
    const t = Date.parse(v || "");
    return Number.isFinite(t) ? t : null;
  }

  function chooseLatestSnapshot(rows) {
    if (!rows.length) return null;
    return rows
      .slice()
      .sort((a, b) => (toMillis(b.captured_at) ?? -1) - (toMillis(a.captured_at) ?? -1))[0];
  }

  /**
   * Exported function — can be called from scoring pipeline or CLI.
   * Reads market_snapshots for the given date/leagues and writes closing
   * line data + CLV deltas back to picks_daily via upsertPickClosesBatch.
   */
  export async function finalizePickCloses({ date, leagues }) {
    const resolvedDate = normalizeDateParam(date) || yyyymmddUTC(new Date());
    const resolvedLeagues = Array.isArray(leagues) ? leagues : ["nba", "ncaam", "nhl"];

    const summary = [];

    for (const league of resolvedLeagues) {
      const { data: picks, error: picksError } = await supabase
        .from("picks_daily")
        .select(`
          date,
          league,
          game_key,
          market,
          pick,
          publish_book,
          publish_line,
          publish_odds,
          publish_captured_at,
          publish_snapshot_key
        `)
        .eq("date", resolvedDate)
        .eq("league", league)
        .order("game_key", { ascending: true });

      if (picksError) throw new Error(`picks_daily fetch failed: ${picksError.message}`);

      const activePicks = (picks || []).filter((r) => normPick(r.pick) && normPick(r.pick) !== "pass");

      const { data: snapshots, error: snapshotsError } = await supabase
        .from("market_snapshots")
        .select(`
          id,
          snapshot_key,
          snapshot_date,
          league,
          game_key,
          market,
          pick,
          line,
          odds,
          book,
          event_start,
          captured_at
        `)
        .eq("snapshot_date", resolvedDate)
        .eq("league", league);

      if (snapshotsError) throw new Error(`market_snapshots fetch failed: ${snapshotsError.message}`);

      const snapshotMap = new Map();
      for (const s of snapshots || []) {
        const key = [String(s.game_key || ""), normMarket(s.market), normPick(s.pick)].join("__");
        if (!snapshotMap.has(key)) snapshotMap.set(key, []);
        snapshotMap.get(key).push(s);
      }

      const rows = [];
      for (const pickRow of activePicks) {
        const market = normMarket(pickRow.market);
        const pick = normPick(pickRow.pick);
        const key = [String(pickRow.game_key || ""), market, pick].join("__");
        const candidates = (snapshotMap.get(key) || []).filter(Boolean);
        const publishBook = normBook(pickRow.publish_book);
        const sameBook = publishBook ? candidates.filter((s) => normBook(s.book) === publishBook) : [];

        let chosen = chooseLatestSnapshot(sameBook);
        let closeMethod = null;
        let closeQuality = null;

        if (chosen) {
          closeMethod = "same_book_close";
          closeQuality = "exact";
        } else {
          chosen = chooseLatestSnapshot(candidates);
          closeMethod = chosen ? "market_match_close" : null;
          closeQuality = chosen ? "fallback" : "unavailable";
        }

        rows.push({
          date: resolvedDate,
          league,
          game_key: pickRow.game_key,
          market,
          pick,
          publish_book: pickRow.publish_book ?? null,
          publish_line: pickRow.publish_line ?? null,
          publish_odds: pickRow.publish_odds ?? null,
          publish_captured_at: pickRow.publish_captured_at ?? null,
          publish_snapshot_key: pickRow.publish_snapshot_key ?? null,
          close_book: chosen?.book ?? null,
          close_line: chosen?.line ?? null,
          close_odds: chosen?.odds ?? null,
          close_captured_at: chosen?.captured_at ?? null,
          close_snapshot_key: chosen?.snapshot_key ?? null,
          close_method: closeMethod,
          close_quality: closeQuality,
          event_start: chosen?.event_start ?? null,
        });
      }

      const written = await upsertPickClosesBatch(rows, { chunkSize: 200 });

      summary.push({
        league,
        date: resolvedDate,
        picks: activePicks.length,
        closesWritten: written.written,
        exact: rows.filter((r) => r.close_quality === "exact").length,
        fallback: rows.filter((r) => r.close_quality === "fallback").length,
        unavailable: rows.filter((r) => r.close_quality === "unavailable").length,
      });
    }

    return { ok: true, date: resolvedDate, results: summary };
  }

  // CLI entry point — kept for direct invocation
  if (process.argv[1]?.includes("finalizePickCloses")) {
    import("dotenv/config").then(() =>
      finalizePickCloses({
        date: getArg("date"),
        leagues: String(getArg("leagues", "nba,ncaam,nhl"))
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      })
        .then((r) => console.log(JSON.stringify(r, null, 2)))
        .catch((err) => {
          console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }, null, 2));
          process.exit(1);
        })
    );
  }
  