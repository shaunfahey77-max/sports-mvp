function americanProfit(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return 0;
  return n > 0 ? n / 100 : 100 / Math.abs(n);
}

export function buildPerformanceFromPicks(rows) {
  const byGame = new Set();
  let picks = 0;
  let pass = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let scored = 0;
  let roiNumerator = 0;
  let roiDenominator = 0;

  for (const row of rows || []) {
    if (row?.game_key) byGame.add(row.game_key);

    const pick = String(row?.pick || "").toUpperCase();
    if (pick === "PASS") {
      pass += 1;
      continue;
    }

    picks += 1;

    const result = String(row?.result || "").toLowerCase();
    const odds = row?.publish_odds ?? row?.market_odds ?? row?.close_odds ?? null;

    if (result === "win") {
      wins += 1;
      scored += 1;
      roiNumerator += americanProfit(odds);
      roiDenominator += 1;
    } else if (result === "loss") {
      losses += 1;
      scored += 1;
      roiNumerator -= 1;
      roiDenominator += 1;
    } else if (result === "push") {
      pushes += 1;
      scored += 1;
      roiDenominator += 1;
    }
  }

  const acc = scored ? wins / scored : null;
  const roi = roiDenominator ? roiNumerator / roiDenominator : null;

  return {
    games: byGame.size,
    picks,
    pass,
    completed: byGame.size,
    wins,
    losses,
    pushes,
    scored,
    acc,
    roi,
    error: null,
    updated_at: new Date().toISOString(),
  };
}
