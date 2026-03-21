import { supabase } from "../../db/dailyLedger.js";
import { settleRows, fetchFinalsForLeague } from "./settlementEngine.js";
import { buildPerformanceFromPicks } from "./performanceEngine.js";
import { validatePerformanceRow } from "./validationEngine.js";

async function fetchPickRows(date, league) {
  const { data, error } = await supabase
    .from("picks_daily")
    .select("date,league,game_key,market,pick,market_line,publish_line,publish_odds,market_odds,close_odds,result")
    .eq("date", date)
    .eq("league", league)
    .order("game_key", { ascending: true });

  if (error) throw new Error(`${league} picks_daily fetch failed: ${error.message}`);
  return data || [];
}

async function applySettlementUpdates(updates) {
  let written = 0;

  for (const u of updates) {
    const { error } = await supabase
      .from("picks_daily")
      .update({
        result: u.result,
        graded_at: u.graded_at,
        updated_at: new Date().toISOString(),
      })
      .eq("date", u.date)
      .eq("league", u.league)
      .eq("game_key", u.game_key)
      .eq("market", u.market)
      .eq("pick", u.pick);

    if (error) {
      throw new Error(`settlement update failed for ${u.league} ${u.game_key} ${u.market} ${u.pick}: ${error.message}`);
    }

    written += 1;
  }

  return written;
}

async function upsertPerformanceDaily(date, league, perf) {
  const row = {
    date,
    league,
    games: perf.games,
    picks: perf.picks,
    pass: perf.pass,
    completed: perf.completed,
    wins: perf.wins,
    losses: perf.losses,
    pushes: perf.pushes,
    scored: perf.scored,
    acc: perf.acc,
    roi: perf.roi,
    error: perf.error,
    updated_at: perf.updated_at,
  };

  const { error } = await supabase
    .from("performance_daily")
    .upsert(row, { onConflict: "date,league" });

  if (error) throw new Error(`${league} performance_daily upsert failed: ${error.message}`);
  return row;
}

export async function runScoringForLeague(date, league) {
  const existingRows = await fetchPickRows(date, league);
  const finalsMap = await fetchFinalsForLeague(date, league);
  const settlementUpdates = settleRows(existingRows, finalsMap);
  const ledgerResultsUpdated = await applySettlementUpdates(settlementUpdates);
  const settledRows = await fetchPickRows(date, league);
  const perf = buildPerformanceFromPicks(settledRows);

  validatePerformanceRow(perf, settledRows);
  await upsertPerformanceDaily(date, league, perf);

  return {
    league,
    date,
    games: perf.games,
    picks: perf.picks,
    pass: perf.pass,
    completed: perf.completed,
    wins: perf.wins,
    losses: perf.losses,
    pushes: perf.pushes,
    scored: perf.scored,
    acc: perf.acc,
    roi: perf.roi,
    ledgerResultsUpdated,
  };
}
