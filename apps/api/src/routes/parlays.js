// apps/api/src/routes/parlays.js
import express from "express";
import { buildNbaPredictions, buildNhlPredictions, buildNcaamPredictions } from "./predict.js";

const router = express.Router();

const VERSION = "parlays-v1";

function toDecimalOdds(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  if (a > 0) return 1 + a / 100;
  return 1 + 100 / Math.abs(a);
}

function toAmericanOdds(decimal) {
  const d = Number(decimal);
  if (!Number.isFinite(d) || d <= 1) return null;
  const b = d - 1;
  if (b >= 1) return Math.round(b * 100);
  return -Math.round(100 / b);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function tierRank(t) {
  const x = String(t || "").toUpperCase();
  if (x === "ELITE") return 4;
  if (x === "STRONG") return 3;
  if (x === "EDGE") return 2;
  if (x === "LEAN") return 1;
  return 0;
}

function kellyFromProbAndDecimal(p, dec) {
  const P = Number(p);
  const D = Number(dec);
  if (!Number.isFinite(P) || !Number.isFinite(D) || D <= 1) return null;
  const b = D - 1;
  const q = 1 - P;
  return (b * P - q) / b;
}

async function buildPredictions(league, date, windowDays) {
  if (league === "nba") return await buildNbaPredictions(date, windowDays ?? 14);
  if (league === "nhl") return await buildNhlPredictions(date, windowDays ?? 60);
  if (league === "ncaam") {
    return await buildNcaamPredictions(date, windowDays ?? 45, {
      tournamentMode: false,
      modeLabel: "regular",
    });
  }
  return { meta: { league, date, error: "unsupported league" }, games: [] };
}

function normalizeDateParam(date) {
  const d = String(date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function pickLegCandidates(games, league) {
  const legs = [];

  for (const g of games) {
    const rb = g?.recommendedBet || null;
    if (!rb) continue;

    const tier = String(rb.tier ?? g?.market?.tier ?? "").toUpperCase();
    if (!tier || tier === "PASS") continue;

    // Allow LEAN legs only if caller opted in AND they clear basic thresholds
    if (tier === "LEAN") {
      if (!includeLean) continue;
      const e = Number(rb.edge ?? g?.market?.edgeVsMarket ?? NaN);
      const ev = Number(rb.evForStake100 ?? g?.market?.evForStake100 ?? NaN);
      if (!Number.isFinite(e) || e < minEdgeLean) continue;
      if (!Number.isFinite(ev) || ev < minEvLean) continue;
    }

    const odds = rb.odds ?? g?.market?.marketOdds ?? null;
    const dec = toDecimalOdds(odds);
    if (!dec) continue;

    const p = rb.modelProb ?? null;
    if (!Number.isFinite(Number(p))) continue;

    const ev100 = rb.evForStake100 ?? g?.market?.evForStake100 ?? null;
    const kHalf = rb.kellyHalf ?? g?.market?.kellyHalf ?? null;

    const away = g?.away?.abbr || g?.away?.name || "AWAY";
    const home = g?.home?.abbr || g?.home?.name || "HOME";
    const gameKey = g?.gameId || `${league}:${away}@${home}`;

    legs.push({
      league,
      gameId: gameKey,
      matchup: `${away} @ ${home}`,
      marketType: rb.marketType,
      side: rb.side,
      line: rb.line ?? null,
      odds,
      decimalOdds: dec,
      tier,
      tierRank: tierRank(tier),
      modelProb: Number(p),
      edge: Number(rb.edge ?? g?.market?.edgeVsMarket ?? NaN),
      evForStake100: Number(ev100 ?? NaN),
      kellyHalf: Number(kHalf ?? NaN),
    });
  }

  // Strongest first: tier, EV, edge, prob
  legs.sort((a, b) => {
    const tr = b.tierRank - a.tierRank;
    if (tr) return tr;

    const evA = Number.isFinite(a.evForStake100) ? a.evForStake100 : -1e9;
    const evB = Number.isFinite(b.evForStake100) ? b.evForStake100 : -1e9;
    const ev = evB - evA;
    if (ev) return ev;

    const eA = Number.isFinite(a.edge) ? a.edge : -1e9;
    const eB = Number.isFinite(b.edge) ? b.edge : -1e9;
    const e = eB - eA;
    if (e) return e;

    return b.modelProb - a.modelProb;
  });

  return legs;
}

function* combinations(arr, k, start = 0, prefix = []) {
  if (prefix.length === k) {
    yield prefix;
    return;
  }
  for (let i = start; i < arr.length; i++) {
    yield* combinations(arr, k, i + 1, prefix.concat(arr[i]));
  }
}

function scoreParlay(legs) {
  // NOTE: This assumes independence between legs.
  // (We can add correlation guards next once this endpoint is stable.)
  let dec = 1;
  let p = 1;

  for (const l of legs) {
    dec *= l.decimalOdds;
    p *= l.modelProb;
  }

  const payout = dec - 1;
  const evPerDollar = p * payout - (1 - p);
  const evForStake100 = evPerDollar * 100;

  const kellyFull = kellyFromProbAndDecimal(p, dec);
  const kellyHalf = kellyFull == null ? null : kellyFull / 2;

  return {
    legs,
    combinedDecimalOdds: dec,
    combinedAmericanOdds: toAmericanOdds(dec),
    modelProb: p,
    evForStake100,
    kellyFull,
    kellyHalf,
  };
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "parlays", version: VERSION });
});

// GET /api/parlays?league=ncaam&date=YYYY-MM-DD&legs=3
router.get("/", async (req, res) => {
  try {
    const league = String(req.query.league || "ncaam").trim().toLowerCase();
    const date = normalizeDateParam(req.query.date) || null;

    const legsN = clamp(parseInt(String(req.query.legs || "3"), 10) || 3, 2, 6);
    const includeLean = String(req.query.includeLean ?? "1") !== "0";
    const minEdgeLean = Number(req.query.minEdge ?? 0.02);
    const minEvLean = Number(req.query.minEV ?? 1);

    const topK = clamp(parseInt(String(req.query.limit || "5"), 10) || 5, 1, 20);

    if (!date) {
      return res.status(400).json({ ok: false, error: "date=YYYY-MM-DD is required" });
    }

    const out = await buildPredictions(league, date);
    const games = Array.isArray(out?.games) ? out.games : [];

    const candidates = pickLegCandidates(games, league);

    // Bound compute: only evaluate combos among top 14–18 legs
    const TOP = clamp(parseInt(String(req.query.top || "16"), 10) || 16, 8, 24);
    const pool = candidates.slice(0, TOP);

    const results = [];
    for (const combo of combinations(pool, legsN)) {
      const ids = new Set(combo.map((x) => x.gameId));
      if (ids.size !== combo.length) continue;

      const scored = scoreParlay(combo);
      results.push(scored);
    }

    results.sort((a, b) => {
      const ev = b.evForStake100 - a.evForStake100;
      if (ev) return ev;
      const k = (b.kellyHalf ?? -1e9) - (a.kellyHalf ?? -1e9);
      if (k) return k;
      return b.modelProb - a.modelProb;
    });

    return res.json({
      ok: true,
      league,
      date,
      legs: legsN,
      poolSize: pool.length,
      candidates: candidates.length,
      count: results.length,
      parlays: results.slice(0, topK),
      meta: {
        version: VERSION,
        topPoolUsed: TOP,
        note: "Parlay probability assumes independence; add correlation guards next.",
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
