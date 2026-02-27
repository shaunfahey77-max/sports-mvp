// apps/api/src/db/dailyLedger.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Server-side writes require service role
function assertSupabaseEnv() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (set in apps/api/.env)");
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (set in apps/api/.env)");
  }
}

assertSupabaseEnv();

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

function safeJson(v) {
  if (v == null) return null;
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return v;
  }
}

function ensureGameKey(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (s === "undefined" || s === "null") return null;
  return s;
}

/**
 * A) Ensure daily performance rows exist (upsert on date,league)
 */
export async function upsertPerformanceDaily(row) {
  const payload = {
    date: row.date, // YYYY-MM-DD
    league: normLeague(row.league),

    games: row.games ?? 0,
    completed: row.completed ?? 0,
    picks: row.picks ?? 0,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    pushes: row.pushes ?? 0,
    pass: row.pass ?? 0,

    // ✅ IMPORTANT: persist scored + acc
    scored: row.scored ?? null,
    acc: row.acc ?? null,
    win_rate: row.win_rate ?? row.acc ?? null,
    roi: row.roi ?? null,

    by_conf: safeJson(row.by_conf ?? null),
    by_edge: safeJson(row.by_edge ?? null),
    by_market: safeJson(row.by_market ?? null),

    model_version: row.model_version ?? null,
    vegas_ok: row.vegas_ok ?? null,

    error: row.error ?? null,
    notes: row.notes ?? null,

    updated_at: nowIso(),
  };

  const { data, error } = await supabase
    .from("performance_daily")
    .upsert(payload, { onConflict: "date,league" })
    .select()
    .single();

  if (error) throw new Error(`upsertPerformanceDaily failed: ${error.message}`);
  return data;
}

/**
 * B) Picks ledger (upsert on date,league,game_key,market)
 */
export async function upsertPickDaily(row) {
  const gameKey = ensureGameKey(row.game_key);
  if (!gameKey) throw new Error("upsertPickDaily failed: missing game_key");

  const payload = {
    date: row.date,
    league: normLeague(row.league),
    game_key: gameKey,
    market: normMarket(row.market),

    pick: row.pick ?? null,
    odds: row.odds ?? null,
    win_prob: row.win_prob ?? null,
    edge: row.edge ?? null,
    ev: row.ev ?? null,
    kelly: row.kelly ?? null,

    result: row.result ?? null,
    meta: safeJson(row.meta ?? null),

    updated_at: nowIso(),
  };

  const { data, error } = await supabase
    .from("picks_daily")
    .upsert(payload, { onConflict: "date,league,game_key,market" })
    .select()
    .single();

  if (error) throw new Error(`upsertPickDaily failed: ${error.message}`);
  return data;
}

/**
 * Bulk upsert helper (premium): faster + fewer partial failures.
 */
export async function upsertPicksDailyBatch(rows, { chunkSize = 200 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, written: 0 };

  let written = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    const payload = chunk
      .map((r) => {
        const gameKey = ensureGameKey(r.game_key);
        if (!gameKey) return null;

        return {
          date: r.date,
          league: normLeague(r.league),
          game_key: gameKey,
          market: normMarket(r.market),

          pick: r.pick ?? null,
          odds: r.odds ?? null,
          win_prob: r.win_prob ?? null,
          edge: r.edge ?? null,
          ev: r.ev ?? null,
          kelly: r.kelly ?? null,

          result: r.result ?? null,
          meta: safeJson(r.meta ?? null),

          updated_at: nowIso(),
        };
      })
      .filter(Boolean);

    if (payload.length === 0) continue;

    const { error } = await supabase
      .from("picks_daily")
      .upsert(payload, { onConflict: "date,league,game_key,market" });

    if (error) throw new Error(`upsertPicksDailyBatch failed: ${error.message}`);

    written += payload.length;
  }

  return { ok: true, written };
}

/**
 * Write an entire slate to the ledger.
 */
export async function writeSlatePicksToLedger({ date, league, games, modelVersion }) {
  if (!Array.isArray(games) || games.length === 0) return { ok: true, written: 0 };

  const rows = [];

  for (const g of games) {
    const m = g?.market ?? {};

    const fallbackKey = `${g?.away?.abbr || g?.away?.name || "AWAY"}@${
      g?.home?.abbr || g?.home?.name || "HOME"
    }:${date}`;

    const game_key =
      ensureGameKey(g?.gameKey) ||
      ensureGameKey(g?.game_key) ||
      ensureGameKey(g?.id) ||
      ensureGameKey(g?.gameId) ||
      ensureGameKey(g?.eventId) ||
      fallbackKey;

    const market = normMarket(m?.market ?? m?.type ?? g?.marketType ?? "moneyline");
    const pick = m?.pick ?? g?.pick ?? "PASS";

    const odds = m?.marketOdds ?? m?.odds ?? g?.odds ?? null;
    const win_prob = m?.winProb ?? m?.win_prob ?? g?.winProb ?? g?.win_prob ?? null;
    const edge = m?.edge ?? g?.edge ?? null;
    const ev = m?.evForStake100 ?? m?.ev ?? g?.ev ?? null;
    const kelly = m?.kellyHalf ?? m?.kelly ?? g?.kelly ?? null;

    rows.push({
      date,
      league,
      game_key,
      market,
      pick,
      odds,
      win_prob,
      edge,
      ev,
      kelly,
      result: null,
      meta: {
        model_version: modelVersion ?? null,
        away: g?.away?.abbr ?? g?.away?.name ?? null,
        home: g?.home?.abbr ?? g?.home?.name ?? null,
      },
    });
  }

  return await upsertPicksDailyBatch(rows, { chunkSize: 200 });
}