import "dotenv/config";
import { supabase } from "../db/dailyLedger.js";

function parseArgs() {
  const raw = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const cleaned = arg.replace(/^--/, "");
      const idx = cleaned.indexOf("=");
      if (idx === -1) return [cleaned, true];
      return [cleaned.slice(0, idx), cleaned.slice(idx + 1)];
    })
  );

  return {
    start: String(raw.start || "2025-10-01").trim(),
    end: String(raw.end || "2026-03-19").trim(),
    leagues: String(raw.leagues || "nba,nhl,ncaam")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

function profitFromAmericanOdds(result, odds) {
  const o = Number(odds);
  if (!Number.isFinite(o)) return null;
  const r = String(result || "").toUpperCase();
  if (r === "PUSH") return 0;
  if (r === "LOSS") return -1;
  if (r !== "WIN") return null;
  return o > 0 ? o / 100 : 100 / Math.abs(o);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function calcAgg(rows) {
  let picks = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let counted = 0;
  let profit = 0;

  for (const row of rows) {
    const r = String(row.result || "").toUpperCase();
    if (!["WIN", "LOSS", "PUSH"].includes(r)) continue;

    picks += 1;
    if (r === "WIN") wins += 1;
    if (r === "LOSS") losses += 1;
    if (r === "PUSH") pushes += 1;

    const p = profitFromAmericanOdds(r, row.publish_odds);
    if (p != null) {
      profit += p;
      counted += 1;
    }
  }

  const scored = wins + losses;
  return {
    picks,
    wins,
    losses,
    pushes,
    winRate: scored ? wins / scored : null,
    roi: counted ? profit / counted : null,
    profit,
    counted,
  };
}

function monthKey(date) {
  return String(date || "").slice(0, 7);
}

function monthlyBreakdown(rows) {
  const byMonth = new Map();
  for (const row of rows) {
    const k = monthKey(row.date);
    if (!k) continue;
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(row);
  }

  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, monthRows]) => ({
      month,
      ...calcAgg(monthRows),
    }));
}

function scoreCell(summary) {
  const roi = summary.roi ?? -999;
  const picks = summary.picks ?? 0;
  if (picks < 8) return -999;
  return roi + Math.min(picks / 1000, 0.05);
}

function buildCandidateRows(allRows, league, market, wpCut, edgeCut) {
  return allRows.filter((row) => {
    if (String(row.league || "").toLowerCase() !== league) return false;

    const tier = String(row.meta?.tier || "").toUpperCase();
    if (tier !== "ELITE") return false;

    const rowMarket = String(row.market || "").toLowerCase();
    if (rowMarket !== market) return false;

    const wp = num(row.cal_win_prob ?? row.win_prob ?? null);
    const edge = num(row.edge ?? row.meta?.edge ?? null);

    if (wp == null) return false;
    if (wp < wpCut) return false;
    if (edgeCut != null) {
      if (edge == null) return false;
      if (edge < edgeCut) return false;
    }

    return true;
  });
}

function gridForLeague(league) {
  if (league === "nba") {
    return {
      markets: ["moneyline", "spread", "total"],
      wpCuts: [0.58, 0.60, 0.62, 0.64, 0.66],
      edgeCuts: [null, 0.02, 0.04, 0.06, 0.08],
    };
  }

  if (league === "nhl") {
    return {
      markets: ["moneyline", "spread", "total"],
      wpCuts: [0.54, 0.56, 0.58, 0.60, 0.62, 0.64],
      edgeCuts: [null, 0.02, 0.04, 0.06, 0.08],
    };
  }

  if (league === "ncaam") {
    return {
      markets: ["moneyline", "spread", "total"],
      wpCuts: [0.62, 0.64, 0.66, 0.68, 0.70, 0.72, 0.74],
      edgeCuts: [null, 0.06, 0.08, 0.10, 0.12, 0.16, 0.20],
    };
  }

  return {
    markets: ["moneyline", "spread", "total"],
    wpCuts: [0.60],
    edgeCuts: [null],
  };
}

async function fetchAllRows(args) {
  const pageSize = 1000;
  let from = 0;
  let all = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("picks_daily")
      .select("league,date,market,result,publish_odds,win_prob,cal_win_prob,edge,meta")
      .in("league", args.leagues)
      .gte("date", args.start)
      .lte("date", args.end)
      .order("date", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const chunk = data || [];
    all = all.concat(chunk);

    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

async function main() {
  const args = parseArgs();
  const rows = await fetchAllRows(args);

  const output = {
    ok: true,
    start: args.start,
    end: args.end,
    totalRows: rows.length,
    leagues: {},
  };

  for (const league of args.leagues) {
    const leagueRows = rows.filter((r) => String(r.league || "").toLowerCase() === league);
    const eliteRows = leagueRows.filter((r) => String(r.meta?.tier || "").toUpperCase() === "ELITE");

    const grid = gridForLeague(league);
    const tested = [];

    for (const market of grid.markets) {
      for (const wpCut of grid.wpCuts) {
        for (const edgeCut of grid.edgeCuts) {
          const candidateRows = buildCandidateRows(rows, league, market, wpCut, edgeCut);
          const summary = calcAgg(candidateRows);
          const months = monthlyBreakdown(candidateRows);

          tested.push({
            market,
            wpCut,
            edgeCut,
            ...summary,
            positiveMonths: months.filter((m) => (m.roi ?? -999) > 0).length,
            totalMonths: months.length,
            months,
            score: scoreCell(summary),
          });
        }
      }
    }

    tested.sort((a, b) =>
      (b.score - a.score) ||
      ((b.roi ?? -999) - (a.roi ?? -999)) ||
      (b.picks - a.picks)
    );

    output.leagues[league] = {
      totalRows: leagueRows.length,
      eliteRows: eliteRows.length,
      currentTopPickRows: leagueRows.filter((r) => r.meta?.topPick === true).length,
      best: tested.slice(0, 12).map((x) => ({
        market: x.market,
        wpCut: x.wpCut,
        edgeCut: x.edgeCut,
        picks: x.picks,
        wins: x.wins,
        losses: x.losses,
        pushes: x.pushes,
        winRate: x.winRate,
        roi: x.roi,
        positiveMonths: x.positiveMonths,
        totalMonths: x.totalMonths,
      })),
    };
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
