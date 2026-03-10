export const MARKET_GATING = {
  nba:   { moneyline: false, spread: true,  total: false },
  ncaam: { moneyline: false, spread: false, total: true  },
  nhl:   { moneyline: false, spread: true,  total: false },
};

export const THRESHOLDS = {
  minEvForStake100: 7.5,
  minKellyHalf: 0.02,
  minEdge: 0.04,
  allowedTiers: ["STRONG", "ELITE"],
};

export const HISTORICAL_MARKET_ROI = {
  nba: {
    moneyline: -0.0176,
    spread: -0.0031,
    total: -0.0193,
  },
  ncaam: {
    moneyline: -0.2046,
    spread: -0.0303,
    total: 0.0133,
  },
  nhl: {
    moneyline: -0.0086,
    spread: 0.0048,
    total: -0.0580,
  },
};

export const RANKING_WEIGHTS = {
  ev: 0.45,
  kelly: 0.25,
  modelProb: 0.20,
  marketRoi: 0.10,
};

export const TIER_RANK = {
  PASS: 0,
  LEAN: 1,
  EDGE: 2,
  STRONG: 3,
  ELITE: 4,
};
