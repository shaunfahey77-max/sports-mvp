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

let LEDGER_WRITES_DISABLED = false;

export function setLedgerWritesDisabled(v) {
  LEDGER_WRITES_DISABLED = Boolean(v);
}

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
    mode: row.mode ?? "regular",
    game_key: gameKey,
    market: normMarket(row.market),

    pick: row.pick ?? null,
    market_type: row.market_type ?? normMarket(row.market),
    market_line: row.market_line ?? null,
    market_side: row.market_side ?? null,
    market_odds: row.market_odds ?? row.odds ?? null,
    odds: row.odds ?? null,

    win_prob: row.win_prob ?? null,
    raw_win_prob: row.raw_win_prob ?? row.win_prob ?? null,
    cal_win_prob: row.cal_win_prob ?? row.win_prob ?? null,
    calibration_method: row.calibration_method ?? null,
    calibration_version: row.calibration_version ?? null,

    publish_book: row.publish_book ?? null,
    publish_line: row.publish_line ?? row.market_line ?? null,
    publish_odds: row.publish_odds ?? row.odds ?? null,

    edge: row.edge ?? null,
    ev: row.ev ?? null,
    kelly: row.kelly ?? null,

    ...(row.result !== undefined ? { result: row.result ?? null } : {}),
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
          mode: r.mode ?? "regular",
          game_key: gameKey,
          market: normMarket(r.market),

          pick: r.pick ?? null,
          market_type: r.market_type ?? normMarket(r.market),
          market_line: r.market_line ?? null,
          market_side: r.market_side ?? null,
          market_odds: r.market_odds ?? r.odds ?? null,
          odds: r.odds ?? null,

          win_prob: r.win_prob ?? null,
          raw_win_prob: r.raw_win_prob ?? r.win_prob ?? null,
          cal_win_prob: r.cal_win_prob ?? r.win_prob ?? null,
          calibration_method: r.calibration_method ?? null,
          calibration_version: r.calibration_version ?? null,

          publish_book: r.publish_book ?? null,
          publish_line: r.publish_line ?? r.market_line ?? null,
          publish_odds: r.publish_odds ?? r.odds ?? null,

          edge: r.edge ?? null,
          ev: r.ev ?? null,
          kelly: r.kelly ?? null,

          ...(r.result !== undefined ? { result: r.result ?? null } : {}),
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
 * Result-only batch updater (safe): updates only result + updated_at,
 * preserving odds / pick / edge metadata already stored on the row.
 */
export async function updatePickResultsBatch(rows, { chunkSize = 200 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, written: 0 };

  let written = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    for (const r of chunk) {
      const gameKey = ensureGameKey(r.game_key);
      if (!gameKey) continue;

      const payload = {
        result: r.result ?? null,
        score_margin: r.score_margin ?? null,
        graded_at: r.graded_at ?? nowIso(),

        close_line: r.close_line ?? null,
        close_odds: r.close_odds ?? null,
        clv_line_delta: r.clv_line_delta ?? null,
        clv_odds_delta: r.clv_odds_delta ?? null,
        clv_implied_delta: r.clv_implied_delta ?? null,
        close_reason: r.close_reason ?? null,

        updated_at: nowIso(),
      };

      const { error } = await supabase
        .from("picks_daily")
        .update(payload)
        .eq("date", r.date)
        .eq("league", normLeague(r.league))
        .eq("game_key", gameKey)
        .eq("market", normMarket(r.market));

      if (error) throw new Error(`updatePickResultsBatch failed: ${error.message}`);

      written += 1;
    }
  }

  return { ok: true, written };
}

/**
 * Write an entire slate to the ledger.
 */
export async function writeSlatePicksToLedger({ date, league, games, modelVersion }) {
  if (LEDGER_WRITES_DISABLED) return { ok: true, written: 0, skipped: true };
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

    const bet = g?.recommendedBet || null;
    const compat = g?.market || {};

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

    const market_line =
      bet?.line ??
      compat?.marketLine ??
      m?.marketLine ??
      m?.line ??
      g?.line ??
      null;

    const market_side =
      bet?.side ??
      compat?.marketSide ??
      m?.marketSide ??
      null;

    const raw_win_prob =
      bet?.modelProb ??
      compat?.winProb ??
      m?.winProb ??
      m?.win_prob ??
      g?.winProb ??
      g?.win_prob ??
      null;

    const cal_win_prob = raw_win_prob;

    const win_prob = cal_win_prob;

    const edge =
      bet?.edge ??
      compat?.edgeVsMarket ??
      m?.edgeVsMarket ??
      m?.edge ??
      g?.edge ??
      null;

    const ev =
      bet?.evForStake100 ??
      compat?.evForStake100 ??
      m?.evForStake100 ??
      m?.ev ??
      g?.ev ??
      null;

    const kelly =
      bet?.kellyHalf ??
      compat?.kellyHalf ??
      m?.kellyHalf ??
      m?.kelly ??
      g?.kelly ??
      null;

    const mode =
      g?.mode ??
      g?.modeLabel ??
      "regular";

    const publish_book =
      bet?.book ??
      compat?.book ??
      m?.book ??
      g?.book ??
      null;

    const publish_line = market_line;
    const publish_odds = odds;
    const market_type = market;
    const market_odds = odds;

    rows.push({
      date,
      league,
      mode,
      game_key,
      market,
      market_type,
      pick,
      market_line,
      market_side,
      market_odds,
      odds,
      win_prob,
      raw_win_prob,
      cal_win_prob,
      calibration_method: "identity",
      calibration_version: "v1",
      publish_book,
      publish_line,
      publish_odds,
      edge,
      ev,
      kelly,
      meta: {
        model_version: g?.model?.version ?? modelVersion ?? null,
        away: g?.away?.abbr ?? g?.away?.name ?? null,
        home: g?.home?.abbr ?? g?.home?.name ?? null,
      },
    });
  }

  return await upsertPicksDailyBatch(rows, { chunkSize: 200 });
}