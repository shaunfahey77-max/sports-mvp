import process from "node:process";
import { supabase } from "../../db/dailyLedger.js";

const DAYS = Number(process.argv[2] || 360);
const LEAGUE = String(process.argv[3] || "nba").toLowerCase();
const VARIANT = String(process.argv[4] || "baseline");

function americanToDecimal(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function profitUnits(odds, result) {
  if (result === "push" || result === "pass") return 0;
  if (result !== "win") return -1;
  const dec = americanToDecimal(odds);
  if (!dec) return 0;
  return dec - 1;
}

function normalizeResult(row) {
  const r =
    row?.result ??
    row?.outcome ??
    row?.grade ??
    row?.status ??
    null;

  if (!r) return "unknown";

  const x = String(r).toLowerCase();
  if (["win", "won", "w"].includes(x)) return "win";
  if (["loss", "lose", "lost", "l"].includes(x)) return "loss";
  if (["push", "p"].includes(x)) return "push";
  if (["pass", "no_bet"].includes(x)) return "pass";
  return "unknown";
}

function getMeta(row) {
  return row?.meta && typeof row.meta === "object" ? row.meta : {};
}

function getCandidateShape(row) {
  const meta = getMeta(row);
  return {
    market: row.market ?? meta.market ?? null,
    pick: row.pick ?? meta.pick ?? null,
    odds:
      row.publish_odds ??
      row.market_odds ??
      meta.publish_odds ??
      meta.market_odds ??
      null,
    line:
      row.publish_line ??
      row.market_line ??
      meta.publish_line ??
      meta.market_line ??
      null,
    edge:
      meta.edge ??
      meta.edgeVsMarket ??
      row.edge ??
      null,
    ev:
      meta.evForStake100 ??
      row.ev_for_stake100 ??
      row.ev ??
      null,
    kelly:
      meta.kellyHalf ??
      row.kelly_half ??
      row.kelly ??
      null,
    winProb:
      meta.winProb ??
      meta.modelProb ??
      row.win_prob ??
      row.model_prob ??
      null,
    tier:
      meta.tier ?? row.tier ?? null,
    result: normalizeResult(row),
    clv:
      row.clv_implied_delta ??
      meta.clv_implied_delta ??
      null,
  };
}

function passesBaseline(c) {
  if (!c.market || !c.pick) return false;
  if (!Number.isFinite(Number(c.odds))) return false;
  if (!Number.isFinite(Number(c.edge))) return false;
  if (!Number.isFinite(Number(c.ev))) return false;

  if (LEAGUE === "nba") {
    return Number(c.edge) >= 0.05 && Number(c.ev) >= 5 && Number(c.kelly ?? 0) >= 0.015;
  }
  if (LEAGUE === "nhl") {
    return Number(c.edge) >= 0.045 && Number(c.ev) >= 4 && Number(c.kelly ?? 0) >= 0.01;
  }
  if (LEAGUE === "ncaam") {
    return Number(c.edge) >= 0.055 && Number(c.ev) >= 5 && Number(c.kelly ?? 0) >= 0.015;
  }
  return false;
}

function scoreVariant(c) {
  const edge = Number(c.edge ?? 0);
  const ev = Number(c.ev ?? 0);
  const kelly = Number(c.kelly ?? 0);
  const winProb = Number(c.winProb ?? 0);
  const clv = Number(c.clv ?? 0);

  let score = 0;
  score += edge * 100;
  score += ev * 1.2;
  score += kelly * 120;
  score += winProb * 20;
  score += clv * 10;

  if (!Number.isFinite(Number(c.odds))) score -= 50;
  if (!c.market || !c.pick) score -= 50;

  if (LEAGUE === "nba") {
    if (String(c.market) === "spread") score += 4;
    if (String(c.market) === "moneyline") score += 2;
  }

  if (LEAGUE === "nhl") {
    if (String(c.market) === "moneyline") score += 4;
    if (kelly < 0.01) score -= 1;
  }

  if (LEAGUE === "ncaam") {
    if (String(c.market) === "total") score += 4;
  }

  return score;
}

function passesVariant(c) {
  if (!c.market || !c.pick) return false;
  if (!Number.isFinite(Number(c.odds))) return false;

  const score = scoreVariant(c);

  if (LEAGUE === "nba") return score >= 14;
  if (LEAGUE === "nhl") return score >= 11;
  if (LEAGUE === "ncaam") return score >= 13;

  return false;
}

function summarize(rows, chooser) {
  const chosen = rows.filter(chooser);
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let units = 0;
  let clvCount = 0;
  let clvSum = 0;

  for (const c of chosen) {
    const result = c.result;
    if (result === "win") wins += 1;
    else if (result === "loss") losses += 1;
    else if (result === "push") pushes += 1;

    units += profitUnits(c.odds, result);

    if (Number.isFinite(Number(c.clv))) {
      clvCount += 1;
      clvSum += Number(c.clv);
    }
  }

  const graded = wins + losses + pushes;
  const winPct = wins + losses > 0 ? wins / (wins + losses) : 0;
  const roi = graded > 0 ? units / graded : 0;

  return {
    picks: chosen.length,
    graded,
    wins,
    losses,
    pushes,
    winPct,
    roi,
    avgClvImplied: clvCount ? clvSum / clvCount : null,
  };
}

async function main() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - DAYS);

  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("picks_daily")
    .select(`
      date,
      league,
      market,
      pick,
      publish_line,
      publish_odds,
      market_line,
      market_odds,
      clv_implied_delta,
      result,
      outcome,
      grade,
      status,
      meta
    `)
    .eq("league", LEAGUE)
    .gte("date", startStr)
    .lte("date", endStr)
    .neq("pick", "PASS")
    .order("date", { ascending: true });

  if (error) {
    console.error(error);
    process.exit(1);
  }

  const candidates = (data || []).map(getCandidateShape);

  const baseline = summarize(candidates, passesBaseline);
  const variant = summarize(candidates, passesVariant);

  console.log(JSON.stringify({
    ok: true,
    league: LEAGUE,
    days: DAYS,
    window: { start: startStr, end: endStr },
    candidateRows: candidates.length,
    baseline,
    variant,
    delta: {
      picks: variant.picks - baseline.picks,
      graded: variant.graded - baseline.graded,
      winPct: variant.winPct - baseline.winPct,
      roi: variant.roi - baseline.roi,
    }
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
