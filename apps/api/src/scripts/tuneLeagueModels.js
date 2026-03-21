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
    start: String(raw.start || "2024-10-01").trim(),
    end: String(raw.end || "2026-03-19").trim(),
    leagues: String(raw.leagues || "nba,nhl,ncaam")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function profitFromAmericanOdds(result, odds) {
  const o = num(odds);
  if (!Number.isFinite(o)) return null;
  const r = String(result || "").toUpperCase();
  if (r === "PUSH") return 0;
  if (r !== "WIN" && r !== "LOSS") return null;
  if (r === "LOSS") return -1;
  if (o > 0) return o / 100;
  return 100 / Math.abs(o);
}

async function fetchAllRows({ league, start, end }) {
  const pageSize = 1000;
  let from = 0;
  let all = [];

  while (true) {
    const { data, error } = await supabase
      .from("picks_daily")
      .select("league,date,market,pick,publish_odds,win_prob,cal_win_prob,edge,result,meta")
      .eq("league", league)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const chunk = data || [];
    all = all.concat(chunk);

    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

function monthKey(dateStr) {
  return String(dateStr || "").slice(0, 7);
}

function summarizeRows(rows) {
  const out = {
    totalRows: rows.length,
    byMarket: {},
    byTier: {},
    scoredRows: 0,
    byProbBand: {},
  };

  const bands = [
    [0.50, 0.55],
    [0.55, 0.60],
    [0.60, 0.65],
    [0.65, 0.70],
    [0.70, 0.75],
    [0.75, 0.80],
    [0.80, 0.90],
  ];

  for (const row of rows) {
    const market = String(row.market || "unknown").toLowerCase();
    const tier = String(row?.meta?.tier || "UNKNOWN").toUpperCase();
    const result = String(row.result || "").toUpperCase();
    const wp = num(row.cal_win_prob ?? row.win_prob);

    out.byMarket[market] = (out.byMarket[market] || 0) + 1;
    out.byTier[tier] = (out.byTier[tier] || 0) + 1;

    if (["WIN", "LOSS", "PUSH"].includes(result)) out.scoredRows += 1;

    if (wp != null && ["WIN", "LOSS"].includes(result)) {
      for (const [lo, hi] of bands) {
        if (wp >= lo && wp < hi) {
          const key = `${lo.toFixed(2)}-${hi.toFixed(2)}`;
          if (!out.byProbBand[key]) out.byProbBand[key] = { samples: 0, wins: 0 };
          out.byProbBand[key].samples += 1;
          if (result === "WIN") out.byProbBand[key].wins += 1;
          break;
        }
      }
    }
  }

  for (const key of Object.keys(out.byProbBand)) {
    const x = out.byProbBand[key];
    x.actualWinRate = x.samples ? x.wins / x.samples : null;
  }

  return out;
}

function evaluateCandidates(rows, league) {
  const configs = {
    nba: {
      markets: ["moneyline", "spread", "total"],
      wpCuts: [0.58, 0.60, 0.62, 0.64, 0.66, 0.68, 0.70, 0.71, 0.72, 0.74],
      edgeCuts: [null, 0.02, 0.04, 0.06, 0.08, 0.10, 0.12],
    },
    nhl: {
      markets: ["moneyline", "spread", "total"],
      wpCuts: [0.54, 0.56, 0.58, 0.60, 0.62, 0.64, 0.66, 0.68, 0.70, 0.71, 0.72],
      edgeCuts: [null, 0.02, 0.04, 0.06, 0.08, 0.10, 0.12],
    },
    ncaam: {
      markets: ["moneyline", "spread", "total"],
      wpCuts: [0.60, 0.62, 0.64, 0.66, 0.68, 0.70, 0.71, 0.72, 0.74, 0.76],
      edgeCuts: [null, 0.06, 0.08, 0.10, 0.12, 0.16, 0.20],
    },
  };

  const cfg = configs[league];
  const results = [];

  for (const market of cfg.markets) {
    for (const wpCut of cfg.wpCuts) {
      for (const edgeCut of cfg.edgeCuts) {
        let picks = 0;
        let wins = 0;
        let losses = 0;
        let pushes = 0;
        let profit = 0;
        let counted = 0;
        const byMonth = {};

        for (const row of rows) {
          const tier = String(row?.meta?.tier || "").toUpperCase();
          const rowMarket = String(row.market || "").toLowerCase();
          const wp = num(row.cal_win_prob ?? row.win_prob);
          const edge = num(row.edge);
          const result = String(row.result || "").toUpperCase();

          if (tier !== "ELITE") continue;
          if (rowMarket !== market) continue;
          if (wp == null || wp < wpCut) continue;
          if (edgeCut != null && (edge == null || edge < edgeCut)) continue;
          if (!["WIN", "LOSS", "PUSH"].includes(result)) continue;

          picks += 1;
          if (result === "WIN") wins += 1;
          if (result === "LOSS") losses += 1;
          if (result === "PUSH") pushes += 1;

          const p = profitFromAmericanOdds(result, row.publish_odds);
          if (p != null) {
            profit += p;
            counted += 1;
            const mk = monthKey(row.date);
            if (!byMonth[mk]) byMonth[mk] = { profit: 0, counted: 0 };
            byMonth[mk].profit += p;
            byMonth[mk].counted += 1;
          }
        }

        const scored = wins + losses;
        const monthly = Object.values(byMonth);
        const positiveMonths = monthly.filter((m) => m.counted > 0 && (m.profit / m.counted) > 0).length;
        const totalMonths = monthly.filter((m) => m.counted > 0).length;

        results.push({
          market,
          wpCut,
          edgeCut,
          picks,
          wins,
          losses,
          pushes,
          winRate: scored ? wins / scored : null,
          roi: counted ? profit / counted : null,
          positiveMonths,
          totalMonths,
        });
      }
    }
  }

  results.sort((a, b) => {
    const aRoi = a.roi ?? -999;
    const bRoi = b.roi ?? -999;
    if (bRoi !== aRoi) return bRoi - aRoi;
    if (b.winRate !== a.winRate) return (b.winRate ?? -999) - (a.winRate ?? -999);
    return b.picks - a.picks;
  });

  return {
    totalRows: rows.length,
    eliteRows: rows.filter((r) => String(r?.meta?.tier || "").toUpperCase() === "ELITE").length,
    top12: results.slice(0, 12),
    only71Plus: results.filter((r) => r.wpCut >= 0.71).slice(0, 12),
  };
}

async function main() {
  const args = parseArgs();
  const output = {
    ok: true,
    start: args.start,
    end: args.end,
    leagues: {},
  };

  for (const league of args.leagues) {
    const rows = await fetchAllRows({ league, start: args.start, end: args.end });
    output.leagues[league] = {
      summary: summarizeRows(rows),
      candidates: evaluateCandidates(rows, league),
    };
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
