
// BASELINE STABILITY PATCH — FORCE PICKS MODE

const MIN_EDGE = -0.02;
const MIN_EV = -5;

function forcePickSelection(markets = []) {
  if (!markets.length) return null;

  // sort by EV descending as fallback
  const sorted = [...markets].sort((a, b) => (b.evForStake100 || 0) - (a.evForStake100 || 0));
  return sorted[0];
}

export function applyBaselineOverride(game) {
  if (!game?.market) return game;

  const m = game.market;

  // allow weak edges instead of PASS
  if (
    (m.edgeVsMarket ?? -999) < MIN_EDGE &&
    (m.evForStake100 ?? -999) < MIN_EV
  ) {
    // don't immediately PASS — downgrade instead
    m.tier = "WEAK";
  }

  // FORCE fallback pick if missing
  if (!m.recommendedMarket) {
    const fallback = forcePickSelection(m.candidates || []);
    if (fallback) {
      m.recommendedMarket = fallback.marketType;
      m.pick = fallback.pick;
      m.marketOdds = fallback.marketOdds;
      m.marketLine = fallback.marketLine;
      m.edgeVsMarket = fallback.edgeVsMarket ?? 0;
      m.evForStake100 = fallback.evForStake100 ?? 0;
      m.winProb = fallback.winProb ?? 0.5;
      m.tier = m.tier || "WEAK";
    }
  }

  return game;
}

// Hook into existing export pipeline
export function applyBaselineToGames(games = []) {
  return games.map(applyBaselineOverride);
}

