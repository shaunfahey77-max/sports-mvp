import express from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = express.Router();

const TABLE = "user_bets";
const DEFAULT_USER_KEY = "local-dev";

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function intNum(v) {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}

function text(v, fallback = null) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeResult(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  if (["win", "loss", "push", "pending", "void"].includes(s)) return s;
  return null;
}

function normalizeMarket(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "moneyline";
  if (["ml", "money", "moneyline", "h2h"].includes(s)) return "moneyline";
  if (["spread", "spreads"].includes(s)) return "spread";
  if (["total", "totals", "ou"].includes(s)) return "total";
  return s;
}

function normalizeBetType(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "straight";
  if (["straight", "single"].includes(s)) return "straight";
  if (["parlay"].includes(s)) return "parlay";
  return "straight";
}

function normalizeParlayType(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  if (["sgp", "same_game", "same-game", "same game parlay"].includes(s)) return "sgp";
  if (["multi_game", "multi-game", "multi game", "standard"].includes(s)) return "multi_game";
  return s;
}

function calcToWin(stake, odds) {
  const s = num(stake);
  const o = num(odds);
  if (s == null || o == null || s <= 0 || o === 0) return null;
  if (o > 0) return (s * o) / 100;
  return (s * 100) / Math.abs(o);
}

function calcProfit(result, stake, toWin) {
  const r = normalizeResult(result);
  const s = num(stake);
  const tw = num(toWin);
  if (r == null || s == null) return null;
  if (r === "pending") return null;
  if (r === "void" || r === "push") return 0;
  if (r === "win") return tw ?? null;
  if (r === "loss") return -s;
  return null;
}

function getUserKey(req) {
  return text(req.headers["x-user-key"], DEFAULT_USER_KEY);
}

function buildPayload(body, { partial = false } = {}) {
  const payload = {};

  const assign = (key, value) => {
    if (partial) {
      if (value !== undefined) payload[key] = value;
    } else {
      payload[key] = value;
    }
  };

  assign("user_key", text(body.user_key, undefined));
  assign("date", text(body.date, undefined));
  assign("league", text(body.league, undefined)?.toLowerCase());
  assign("mode", text(body.mode, undefined)?.toLowerCase());

  assign("bet_type", body.bet_type !== undefined ? normalizeBetType(body.bet_type) : undefined);
  assign("legs_count", body.legs_count !== undefined ? intNum(body.legs_count) : undefined);
  assign("parlay_type", body.parlay_type !== undefined ? normalizeParlayType(body.parlay_type) : undefined);
  assign("legs_summary", body.legs_summary !== undefined ? text(body.legs_summary, null) : undefined);

  assign("game_key", text(body.game_key, undefined));
  assign("game_label", text(body.game_label, undefined));

  assign("market", body.market !== undefined ? normalizeMarket(body.market) : undefined);
  assign("pick", text(body.pick, undefined));
  assign("line", body.line !== undefined ? num(body.line) : undefined);
  assign("odds", body.odds !== undefined ? num(body.odds) : undefined);
  assign("stake", body.stake !== undefined ? num(body.stake) : undefined);
  assign("book", text(body.book, undefined));
  assign("notes", text(body.notes, undefined));
  assign("source", text(body.source, undefined)?.toLowerCase());
  assign("source_pick_id", body.source_pick_id !== undefined ? num(body.source_pick_id) : undefined);
  assign("source_meta", body.source_meta !== undefined ? body.source_meta : undefined);

  assign("publish_line", body.publish_line !== undefined ? num(body.publish_line) : undefined);
  assign("publish_odds", body.publish_odds !== undefined ? num(body.publish_odds) : undefined);
  assign("close_line", body.close_line !== undefined ? num(body.close_line) : undefined);
  assign("close_odds", body.close_odds !== undefined ? num(body.close_odds) : undefined);
  assign("clv_line_delta", body.clv_line_delta !== undefined ? num(body.clv_line_delta) : undefined);
  assign("clv_odds_delta", body.clv_odds_delta !== undefined ? num(body.clv_odds_delta) : undefined);
  assign("clv_implied_delta", body.clv_implied_delta !== undefined ? num(body.clv_implied_delta) : undefined);
  assign("close_reason", text(body.close_reason, undefined));

  assign("result", body.result !== undefined ? normalizeResult(body.result) : undefined);
  assign("settled_at", body.settled_at !== undefined ? body.settled_at : undefined);

  if (!partial || body.stake !== undefined || body.odds !== undefined) {
    const stake = body.stake !== undefined ? num(body.stake) : payload.stake;
    const odds = body.odds !== undefined ? num(body.odds) : payload.odds;
    assign("to_win", calcToWin(stake, odds));
  }

  const result = body.result !== undefined ? normalizeResult(body.result) : payload.result;
  const stake = body.stake !== undefined ? num(body.stake) : payload.stake;
  const toWin = payload.to_win;
  if (!partial || body.result !== undefined || body.stake !== undefined || body.odds !== undefined) {
    assign("profit", calcProfit(result, stake, toWin));
  }

  assign("updated_at", new Date().toISOString());

  return payload;
}

router.get("/bets", async (req, res) => {
  try {
    const user_key = text(req.query.user_key, getUserKey(req));
    const league = text(req.query.league, null)?.toLowerCase();
    const result = normalizeResult(req.query.result);
    const bet_type = text(req.query.bet_type, null)?.toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100)));

    let query = supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("user_key", user_key)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (league) query = query.eq("league", league);
    if (result) query = query.eq("result", result);
    if (bet_type) query = query.eq("bet_type", normalizeBetType(bet_type));

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ ok: true, data: data || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get("/bets/summary", async (req, res) => {
  try {
    const user_key = text(req.query.user_key, getUserKey(req));

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("stake,profit,result,clv_line_delta,clv_implied_delta,bet_type")
      .eq("user_key", user_key);

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];

    const settled = rows.filter((r) => ["win", "loss", "push", "void"].includes(String(r.result || "").toLowerCase()));
    const wins = settled.filter((r) => String(r.result || "").toLowerCase() === "win").length;
    const losses = settled.filter((r) => String(r.result || "").toLowerCase() === "loss").length;
    const pushes = settled.filter((r) => String(r.result || "").toLowerCase() === "push").length;

    const totalStake = settled.reduce((a, r) => a + (num(r.stake) || 0), 0);
    const totalProfit = settled.reduce((a, r) => a + (num(r.profit) || 0), 0);

    const clvRows = rows.filter((r) => num(r.clv_line_delta) != null);
    const impliedRows = rows.filter((r) => num(r.clv_implied_delta) != null);

    const avg_clv_line = clvRows.length
      ? clvRows.reduce((a, r) => a + num(r.clv_line_delta), 0) / clvRows.length
      : null;

    const avg_clv_implied = impliedRows.length
      ? impliedRows.reduce((a, r) => a + num(r.clv_implied_delta), 0) / impliedRows.length
      : null;

    const straightBets = rows.filter((r) => normalizeBetType(r.bet_type) === "straight").length;
    const parlayBets = rows.filter((r) => normalizeBetType(r.bet_type) === "parlay").length;

    return res.json({
      ok: true,
      data: {
        bets: rows.length,
        settled: settled.length,
        wins,
        losses,
        pushes,
        total_stake: totalStake,
        total_profit: totalProfit,
        roi: totalStake > 0 ? totalProfit / totalStake : null,
        avg_clv_line,
        avg_clv_implied,
        straight_bets: straightBets,
        parlay_bets: parlayBets,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.post("/bets", async (req, res) => {
  try {
    const payload = buildPayload(
      { ...req.body, user_key: req.body?.user_key ?? getUserKey(req) },
      { partial: false }
    );

    const betType = normalizeBetType(payload.bet_type);

    const required = ["date", "league"];
    for (const key of required) {
      if (!payload[key]) {
        return res.status(400).json({ ok: false, error: `Missing required field: ${key}` });
      }
    }

    if (payload.stake == null || payload.stake <= 0) {
      return res.status(400).json({ ok: false, error: "Stake must be greater than 0" });
    }

    if (betType === "straight") {
      for (const key of ["market", "pick"]) {
        if (!payload[key]) {
          return res.status(400).json({ ok: false, error: `Missing required field: ${key}` });
        }
      }
    }

    if (betType === "parlay") {
      if (payload.legs_count == null || payload.legs_count < 2) {
        return res.status(400).json({ ok: false, error: "Parlays require legs_count of at least 2" });
      }
      payload.market = payload.market ?? "parlay";
      payload.pick = payload.pick ?? "parlay";
    }

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    return res.status(201).json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.patch("/bets/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "Invalid bet id" });
    }

    const body = req.body || {};

    const { data: existing, error: existingError } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .single();

    if (existingError) throw existingError;

    const updatePayload = {};

    if (body.date !== undefined) updatePayload.date = text(body.date, null);
    if (body.league !== undefined) updatePayload.league = text(body.league, null)?.toLowerCase();
    if (body.mode !== undefined) updatePayload.mode = text(body.mode, null)?.toLowerCase();

    if (body.bet_type !== undefined) updatePayload.bet_type = normalizeBetType(body.bet_type);
    if (body.legs_count !== undefined) updatePayload.legs_count = intNum(body.legs_count);
    if (body.parlay_type !== undefined) updatePayload.parlay_type = normalizeParlayType(body.parlay_type);
    if (body.legs_summary !== undefined) updatePayload.legs_summary = text(body.legs_summary, null);

    if (body.game_key !== undefined) updatePayload.game_key = text(body.game_key, null);
    if (body.game_label !== undefined) updatePayload.game_label = text(body.game_label, null);

    if (body.market !== undefined) updatePayload.market = normalizeMarket(body.market);
    if (body.pick !== undefined) updatePayload.pick = text(body.pick, null);

    if (body.line !== undefined) updatePayload.line = num(body.line);
    if (body.odds !== undefined) updatePayload.odds = num(body.odds);
    if (body.stake !== undefined) updatePayload.stake = num(body.stake);

    if (body.book !== undefined) updatePayload.book = text(body.book, null);
    if (body.notes !== undefined) updatePayload.notes = text(body.notes, null);

    if (body.source !== undefined) updatePayload.source = text(body.source, null)?.toLowerCase();
    if (body.source_pick_id !== undefined) updatePayload.source_pick_id = num(body.source_pick_id);
    if (body.source_meta !== undefined) updatePayload.source_meta = body.source_meta;

    if (body.publish_line !== undefined) updatePayload.publish_line = num(body.publish_line);
    if (body.publish_odds !== undefined) updatePayload.publish_odds = num(body.publish_odds);
    if (body.close_line !== undefined) updatePayload.close_line = num(body.close_line);
    if (body.close_odds !== undefined) updatePayload.close_odds = num(body.close_odds);
    if (body.clv_line_delta !== undefined) updatePayload.clv_line_delta = num(body.clv_line_delta);
    if (body.clv_odds_delta !== undefined) updatePayload.clv_odds_delta = num(body.clv_odds_delta);
    if (body.clv_implied_delta !== undefined) updatePayload.clv_implied_delta = num(body.clv_implied_delta);
    if (body.close_reason !== undefined) updatePayload.close_reason = text(body.close_reason, null);

    if (body.result !== undefined) updatePayload.result = normalizeResult(body.result);
    if (body.settled_at !== undefined) updatePayload.settled_at = body.settled_at;

    if (!Object.keys(updatePayload).length) {
      return res.status(400).json({ ok: false, error: "No valid fields provided" });
    }

    const nextStake = ("stake" in updatePayload) ? updatePayload.stake : existing.stake;
    const nextOdds = ("odds" in updatePayload) ? updatePayload.odds : existing.odds;
    const nextResult = ("result" in updatePayload) ? updatePayload.result : existing.result;

    updatePayload.to_win = calcToWin(nextStake, nextOdds);
    updatePayload.profit = calcProfit(nextResult, nextStake, updatePayload.to_win);
    updatePayload.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;
