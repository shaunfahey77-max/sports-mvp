export const MARKET_GATING = {
  nba:   { moneyline: true,  spread: true,  total: true  },
  ncaam: { moneyline: false, spread: false, total: true  },
  nhl:   { moneyline: true,  spread: true,  total: true  },
};

export const THRESHOLDS = {
  minEvForStake100: 7.5,
  minKellyHalf: 0.02,
  minEdge: 0.04,
  allowedTiers: ["STRONG", "ELITE"],
};

export const MARKET_RULES = {
  nba: {
    moneyline: {
      minEvForStake100: 12,
      minKellyHalf: 0.025,
      minEdge: 0.07,
      minOdds: -175,
      maxOdds: 180,
      allowedTiers: ["STRONG", "ELITE"],
    },
    spread: {
      minEvForStake100: 8,
      minKellyHalf: 0.02,
      minEdge: 0.05,
      minOdds: -140,
      maxOdds: 180,
      allowedTiers: ["STRONG", "ELITE"],
    },
    total: {
      minEvForStake100: 8,
      minKellyHalf: 0.02,
      minEdge: 0.05,
      minOdds: -140,
      maxOdds: 140,
      allowedTiers: ["STRONG", "ELITE"],
    },
  },
  nhl: {
    moneyline: {
      minEvForStake100: 8,
      minKellyHalf: 0.02,
      minEdge: 0.055,
      minOdds: -175,
      maxOdds: 180,
      allowedTiers: ["STRONG", "ELITE"],
    },
    spread: {
      minEvForStake100: 6,
      minKellyHalf: 0.015,
      minEdge: 0.02,
      minOdds: -260,
      maxOdds: 220,
      allowedTiers: ["STRONG", "ELITE"],
    },
    total: {
      minEvForStake100: 7,
      minKellyHalf: 0.02,
      minEdge: 0.04,
      minOdds: -160,
      maxOdds: 140,
      allowedTiers: ["STRONG", "ELITE"],
    },
  },
  ncaam: {
    total: {
      minEvForStake100: 10,
      minKellyHalf: 0.025,
      minEdge: 0.08,
      minOdds: -140,
      maxOdds: 120,
      allowedTiers: ["STRONG", "ELITE"],
    },
  },
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
