const API = "http://127.0.0.1:3001/api";

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function gradePick(game, pick) {
  const home = Number(game?.home?.score);
  const away = Number(game?.away?.score);

  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;

  const diff = home - away;
  const total = home + away;

  if (pick.marketType === "moneyline") {
    if (pick.pick === "home") return diff > 0;
    if (pick.pick === "away") return diff < 0;
  }

  if (pick.marketType === "spread") {
    const line = Number(pick.marketLine);
    if (!Number.isFinite(line)) return null;

    if (pick.pick === "home") return diff + line > 0;
    if (pick.pick === "away") return -diff + line > 0;
  }

  if (pick.marketType === "total") {
    const line = Number(pick.marketLine);
    if (!Number.isFinite(line)) return null;

    if (pick.pick === "over") return total > line;
    if (pick.pick === "under") return total < line;
    if (total === line) return "push";
  }

  return null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

async function run() {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let skipped = 0;

  const byMarket = {
    moneyline: { wins: 0, losses: 0, pushes: 0, skipped: 0 },
    spread: { wins: 0, losses: 0, pushes: 0, skipped: 0 },
    total: { wins: 0, losses: 0, pushes: 0, skipped: 0 },
  };

  for (let i = 1; i <= 90; i++) {
    const date = daysAgo(i);
    console.log(`Scoring ${date}`);

    try {
      const data = await fetchJson(`${API}/predictions?date=${date}`);
      const games = Array.isArray(data?.games) ? data.games : [];

      for (const game of games) {
        const pick = game?.market;
        if (!pick?.marketType || !pick?.pick) {
          skipped++;
          continue;
        }

        const marketKey =
          pick.marketType === "moneyline"
            ? "moneyline"
            : pick.marketType === "spread"
            ? "spread"
            : pick.marketType === "total"
            ? "total"
            : null;

        if (!marketKey) {
          skipped++;
          continue;
        }

        const result = gradePick(game, pick);

        if (result === true) {
          wins++;
          byMarket[marketKey].wins++;
        } else if (result === false) {
          losses++;
          byMarket[marketKey].losses++;
        } else if (result === "push") {
          pushes++;
          byMarket[marketKey].pushes++;
        } else {
          skipped++;
          byMarket[marketKey].skipped++;
        }
      }
    } catch (err) {
      console.log(`Error scoring ${date}: ${err.message}`);
    }
  }

  const graded = wins + losses + pushes;

  console.log("");
  console.log("=== OVERALL ===");
  console.log("Wins:   ", wins);
  console.log("Losses: ", losses);
  console.log("Pushes: ", pushes);
  console.log("Skipped:", skipped);
  console.log("Graded: ", graded);

  if (wins + losses > 0) {
    console.log("Win %:  ", (wins / (wins + losses)).toFixed(4));
  }

  console.log("");
  console.log("=== BY MARKET ===");
  for (const [market, s] of Object.entries(byMarket)) {
    const decisions = s.wins + s.losses;
    const pct = decisions > 0 ? (s.wins / decisions).toFixed(4) : "n/a";
    console.log(
      `${market}: wins=${s.wins} losses=${s.losses} pushes=${s.pushes} skipped=${s.skipped} winpct=${pct}`
    );
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
