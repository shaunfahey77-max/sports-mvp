import { supabase } from "./dailyLedger.js";

function nowIso() {
  return new Date().toISOString();
}

function normLeague(x) {
  return String(x || "").trim().toLowerCase();
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

function minuteBucket(iso) {
  const d = new Date(iso || nowIso());
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

function makeSnapshotKey(row) {
  return [
    row.snapshot_date,
    normLeague(row.league),
    String(row.mode || "regular").trim().toLowerCase(),
    row.game_key,
    normMarket(row.market),
    String(row.book || "unknown").trim().toLowerCase(),
    minuteBucket(row.captured_at),
  ].join("|");
}

function toMillis(v) {
  const t = new Date(v || "").getTime();
  return Number.isFinite(t) ? t : null;
}

export async function upsertMarketSnapshotsBatch(rows, { chunkSize = 500 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, written: 0 };

  let written = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    const payload = chunk
      .map((r) => {
        const gameKey = ensureGameKey(r.game_key);
        if (!gameKey) return null;

        const captured_at = r.captured_at || nowIso();

        return {
          snapshot_key: makeSnapshotKey({
            ...r,
            game_key: gameKey,
            captured_at,
          }),
          snapshot_date: r.snapshot_date || r.date,
          league: normLeague(r.league),
          mode: String(r.mode || "regular").trim().toLowerCase(),
          game_key: gameKey,
          market: normMarket(r.market),
          market_type: r.market_type ?? normMarket(r.market),
          pick: r.pick ?? null,
          side: r.side ?? null,
          line: r.line ?? null,
          odds: r.odds ?? null,
          book: r.book ?? null,
          event_start: r.event_start ?? null,
          captured_at,
          meta: r.meta ?? null,
        };
      })
      .filter(Boolean);

    if (!payload.length) continue;

    const { error } = await supabase
      .from("market_snapshots")
      .upsert(payload, { onConflict: "snapshot_key" });

    if (error) throw new Error(`upsertMarketSnapshotsBatch failed: ${error.message}`);

    written += payload.length;
  }

  return { ok: true, written };
}

export async function getLatestClosingSnapshotMap({ date, league, mode = null }) {
  let query = supabase
    .from("market_snapshots")
    .select("snapshot_date,league,mode,game_key,market,market_type,line,odds,book,event_start,captured_at,meta")
    .eq("snapshot_date", date)
    .eq("league", normLeague(league))
    .order("captured_at", { ascending: false });

  if (mode) {
    query = query.eq("mode", String(mode).trim().toLowerCase());
  }

  const { data, error } = await query;
  if (error) throw new Error(`getLatestClosingSnapshotMap failed: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  const map = new Map();

  // First pass: prefer latest snapshot that is at/before event start when event_start exists.
  for (const row of rows) {
    const key = `${row.game_key}__${normMarket(row.market)}`;
    if (map.has(key)) continue;

    const capMs = toMillis(row.captured_at);
    const evtMs = toMillis(row.event_start);

    if (evtMs == null || capMs == null || capMs <= evtMs + 120000) {
      map.set(key, {
        ...row,
        close_reason: evtMs == null ? "latest_snapshot_no_event_start" : "pregame_snapshot",
      });
    }
  }

  // Second pass fallback: latest available snapshot even if post-start.
  for (const row of rows) {
    const key = `${row.game_key}__${normMarket(row.market)}`;
    if (map.has(key)) continue;

    map.set(key, {
      ...row,
      close_reason: "poststart_snapshot_fallback",
    });
  }

  return map;
}
