const API = "http://127.0.0.1:3001/api";
const LEAGUES = ["nba", "ncaam", "nhl"];
const DAYS = 180;
const STAKE = 100;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const TIER_RANK = { PASS: 0, LEAN: 1, EDGE: 2, STRONG: 3, ELITE: 4 };

function tierFromCandidate(c) {
  const edge = num(c?.edge);
  const ev = num(c?.evForStake100);
  const kh = num(c?.kellyHalf);

  if (edge == null || ev == null || kh == null) return "PASS";
  if (edge < 0.015 || ev < 1.0 || kh < 0.01) return "PASS";
  if (edge >= 0.080 && kh >= 0.04) return "ELITE";
  if (edge >= 0.055 && kh >= 0.025) return "STRONG";
  if (edge >= 0.030) return "EDGE";
  return "LEAN";
}

function profitForWin(americanOdds, stake = STAKE) {
  const odds = num(americanOdds);
  if (odds == null || odds === 0) return null;
  if (odds > 0) return stake * (odds / 100);
  return stake * (100 / Math.abs(odds));
}

function chooseMoneylinePick(markets) {
  const home = markets?.moneyline?.home || null;
  const away = markets?.moneyline?.away || null;

  const candidates = [
    home
      ? {
          marketType: "moneyline",
          side: "home",
          line: null,
          odds: num(home.odds),
          edge: num(home.edge),
          evForStake100: num(home.evForStake100),
          kellyHalf: num(home.kellyHalf),
          modelProb: num(home.modelProb),
        }
      : null,
    away
      ? {
          marketType: "moneyline",
          side: "away",
          line: null,
          odds: num(away.odds),
          edge: num(away.edge),
          evForStake100: num(away.evForStake100),
          kellyHalf: num(away.kellyHalf),
          modelProb: num(away.modelProb),
        }
      : null,
  ]
    .filter(Boolean)
    .map((c) => ({ ...c, tier: tierFromCandidate(c) }))
    .filter((c) => c.tier !== "PASS");

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const ta = TIER_RANK[a.tier] ?? 0;
    const tb = TIER_RANK[b.tier] ?? 0;
    if (tb !== ta) return tb - ta;
    return (b.evForStake100 ?? -1e9) - (a.evForStake100 ?? -1e9);
  });

  return candidates[0];
}

function chooseSpreadPick(markets) {
  const home = markets?.spread?.home || null;
  const away = markets?.spread?.away || null;

  const candidates = [
    home
      ? {
          marketType: "spread",
          side: "home",
          line: num(home.line),
          odds: num(home.odds),
          edge: num(home.edge),
          evForStake100: num(home.evForStake100),
          kellyHalf: num(home.kellyHalf),
          modelProb: num(home.modelProb),
        }
      : null,
    away
      ? {
          marketType: "spread",
          side: "away",
          line: num(away.line),
          odds: num(away.odds),
          edge: num(away.edge),
          evForStake100: num(away.evForStake100),
          kellyHalf: num(away.kellyHalf),
          modelProb: num(away.modelProb),
        }
      : null,
  ]
    .filter(Boolean)
    .map((c) => ({ ...c, tier: tierFromCandidate(c) }))
    .filter((c) => c.tier !== "PASS");

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const ta = TIER_RANK[a.tier] ?? 0;
    const tb = TIER_RANK[b.tier] ?? 0;
    if (tb !== ta) return tb - ta;
    return (b.evForStake100 ?? -1e9) - (a.evForStake100 ?? -1e9);
  });

  return candidates[0];
}

function chooseTotalPick(markets) {
  const over = markets?.total?.over || null;
  const under = markets?.total?.under || null;
  const line = num(markets?.total?.line);

  const candidates = [
    over
      ? {
          marketType: "total",
          side: "over",
          line,
          odds: num(over.odds),
          edge: num(over.edge),
          evForStake100: num(over.evForStake100),
          kellyHalf: num(over.kellyHalf),
          modelProb: num(over.modelProb),
        }
      : null,
    under
      ? {
          marketType: "total",
          side: "under",
          line,
          odds: num(under.odds),
          edge: num(under.edge),
          evForStake100: num(under.evForStake100),
          kellyHalf: num(under.kellyHalf),
          modelProb: num(under.modelProb),
        }
      : null,
  ]
    .filter(Boolean)
    .map((c) => ({ ...c, tier: tierFromCandidate(c) }))
    .filter((c) => c.tier !== "PASS");

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const ta = TIER_RANK[a.tier] ?? 0;
    const tb = TIER_RANK[b.tier] ?? 0;
    if (tb !== ta) return tb - ta;
    return (b.evForStake100 ?? -1e9) - (a.evForStake100 ?? -1e9);
  });

  return candidates[0];
}

function gradeMoneyline(game, pick) {
  const home = num(game?.home?.score);
  const away = num(game?.away?.score);
  if (home == null || away == null || !pick) return null;

  if (pick.side === "home") return home > away;
  if (pick.side === "away") return away > home;
  return null;
}

function gradeSpread(game, pick) {
  const home = num(game?.home?.score);
  const away = num(game?.away?.score);
  const line = num(pick?.line);
  if (home == null || away == null || line == null || !pick) return null;

  const diff = home - away;

  if (pick.side === "home") {
    if (diff + line > 0) return true;
    if (diff + line < 0) return false;
    return "push";
  }

  if (pick.side === "away") {
    if ((away - home) + line > 0) return true;
    if ((away - home) + line < 0) return false;
    return "push";
  }

  return null;
}

function gradeTotal(game, pick) {
  const home = num(game?.home?.score);
  const away = num(game?.away?.score);
  const line = num(pick?.line);
  if (home == null || away == null || line == null || !pick) return null;

  const total = home + away;

  if (pick.side === "over") {
    if (total > line) return true;
    if (total < line) return false;
    return "push";
  }

  if (pick.side === "under") {
    if (total < line) return true;
    if (total > line) return false;
    return "push";
  }

  return null;
}

function initStats() {
  return {
    wins: 0,
    losses: 0,
    pushes: 0,
    skipped: 0,
    risked: 0,
    profit: 0,
  };
}

function record(stats, result, odds) {
  if (result === true) {
    const winProfit = profitForWin(odds);
    if (winProfit == null) {
      stats.skipped++;
      return;
    }
    stats.wins++;
    stats.risked += STAKE;
    stats.profit += winProfit;
    return;
  }

  if (result === false) {
    stats.losses++;
    stats.risked += STAKE;
    stats.profit -= STAKE;
    return;
  }

  if (result === "push") {
    stats.pushes++;
    return;
  }

  stats.skipped++;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function printStats(label, s) {
  const decisions = s.wins + s.losses;
  const winpct = decisions > 0 ? (s.wins / decisions).toFixed(4) : "n/a";
  const roi = s.risked > 0 ? ((s.profit / s.risked) * 100).toFixed(2) + "%" : "n/a";

  console.log(
    `${label}: wins=${s.wins} losses=${s.losses} pushes=${s.pushes} skipped=${s.skipped} winpct=${winpct} risked=${s.risked.toFixed(2)} profit=${s.profit.toFixed(2)} roi=${roi}`
  );
}

async function run() {
  const overall = {
    moneyline: initStats(),
    spread: initStats(),
    total: initStats(),
  };

  const byLeague = {
    nba: { moneyline: initStats(), spread: initStats(), total: initStats() },
    ncaam: { moneyline: initStats(), spread: initStats(), total: initStats() },
    nhl: { moneyline: initStats(), spread: initStats(), total: initStats() },
  };

  let gamesSeen = 0;

  for (let i = 1; i <= DAYS; i++) {
    const date = daysAgo(i);

    for (const league of LEAGUES) {
      console.log(`Scoring ${league} ${date}`);

      try {
        const data = await fetchJson(`${API}/predictions?league=${league}&date=${date}`);
        const games = Array.isArray(data?.games) ? data.games : [];

        for (const game of games) {
          gamesSeen++;

          const markets = game?.markets || null;

          const mlPick = chooseMoneylinePick(markets);
          const spPick = chooseSpreadPick(markets);
          const ttPick = chooseTotalPick(markets);

          const mlResult = gradeMoneyline(game, mlPick);
          const spResult = gradeSpread(game, spPick);
          const ttResult = gradeTotal(game, ttPick);

          record(overall.moneyline, mlResult, mlPick?.odds);
          record(overall.spread, spResult, spPick?.odds);
          record(overall.total, ttResult, ttPick?.odds);

          record(byLeague[league].moneyline, mlResult, mlPick?.odds);
          record(byLeague[league].spread, spResult, spPick?.odds);
          record(byLeague[league].total, ttResult, ttPick?.odds);
        }
      } catch (err) {
        console.log(`Error scoring ${league} ${date}: ${err.message}`);
      }
    }
  }

  console.log("");
  console.log("=== SUMMARY ===");
  console.log(`Games seen: ${gamesSeen}`);

  console.log("");
  console.log("=== OVERALL BY MARKET ===");
  printStats("moneyline", overall.moneyline);
  printStats("spread", overall.spread);
  printStats("total", overall.total);

  console.log("");
  console.log("=== BY LEAGUE ===");
  for (const league of LEAGUES) {
    console.log("");
    console.log(`[${league}]`);
    printStats("moneyline", byLeague[league].moneyline);
    printStats("spread", byLeague[league].spread);
    printStats("total", byLeague[league].total);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
