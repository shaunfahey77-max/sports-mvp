// apps/api/src/routes/parlaysOdds.js
import "dotenv/config";
import express from "express";

const router = express.Router();

/* =========================================================
   Parlays Odds — v3 (Predictions mode w/ Odds Backfill)
   ---------------------------------------------------------
   Problem solved:
   - /api/predictions often has moneyline picks with marketOdds=null
   - That makes the parlay candidate pool tiny (poolSize=1), so legs>=2 returns none
   Fix:
   - In mode=predictions, we call /api/upsetsOdds for the same league/date (DraftKings h2h)
   - We backfill missing moneyline odds into prediction games
   - Then compute EV/Kelly using model winProb + book odds

   Endpoints:
   GET /api/parlaysOdds/ping
   GET /api/parlaysOdds?league=nba&date=YYYY-MM-DD&legs=2&limit=5&mode=predictions&evOnly=1
========================================================= */

function clampNum(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function internalBaseUrl(req) {
  // Force localhost base (works for local + avoids proxy issues)
  const base = process.env.INTERNAL_BASE_URL || "http://127.0.0.1:3001";
  return base;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const txt = await res.text();
  let json;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`Non-JSON response (${res.status}) from ${url}: ${txt.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = json?.error || json?.message || txt;
    throw new Error(`HTTP ${res.status} for ${url} — ${String(msg).slice(0, 400)}`);
  }
  return json;
}

function americanToDecimal(oddsAmerican) {
  const o = Number(oddsAmerican);
  if (!Number.isFinite(o) || o === 0) return null;
  if (o > 0) return 1 + o / 100;
  return 1 + 100 / Math.abs(o);
}

function decimalToAmerican(dec) {
  const d = Number(dec);
  if (!Number.isFinite(d) || d <= 1) return null;
  // for combined parlay odds, always positive in practice
  const a = Math.round((d - 1) * 100);
  return a;
}

function impliedFromAmerican(oddsAmerican) {
  const o = Number(oddsAmerican);
  if (!Number.isFinite(o) || o === 0) return null;
  if (o > 0) return 100 / (o + 100);
  return Math.abs(o) / (Math.abs(o) + 100);
}

function computeMarketEV({ oddsAmerican, winProb, stake = 100 }) {
  const o = Number(oddsAmerican);
  const p = Number(winProb);
  if (!Number.isFinite(o) || !Number.isFinite(p) || p <= 0 || p >= 1) {
    return { evForStake100: null, kellyHalf: null };
  }

  // Profit on win for $100 stake
  const profit = o > 0 ? (stake * o) / 100 : (stake * 100) / Math.abs(o);

  // EV = p*profit - (1-p)*stake
  const ev = p * profit - (1 - p) * stake;

  // Kelly fraction (full): (bp - q)/b  where b = profit/stake
  const b = profit / stake;
  const q = 1 - p;
  const kellyFull = (b * p - q) / b;
  const kellyHalf = kellyFull / 2;

  return {
    evForStake100: ev,
    kellyHalf,
  };
}

function normTeamKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\.\,\'\"\(\)\[\]\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchupKey(awayName, homeName) {
  return `${normTeamKey(awayName)} @ ${normTeamKey(homeName)}`;
}

function choose(n, k) {
  // iterative combinations generator indices
  const out = [];
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    out.push(idx.slice());
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}

async function buildPredictionParlays({
  req,
  league,
  date,
  legs,
  limit,
  evOnly,
}) {
  const base = internalBaseUrl(req);

  // 1) Pull predictions
  const predUrl =
    `${base}/api/predictions?league=${encodeURIComponent(league)}` +
    (date ? `&date=${encodeURIComponent(date)}` : "");
  const preds = await fetchJson(predUrl);

  const games = Array.isArray(preds?.games) ? preds.games : [];

  // 2) Pull odds (moneyline) via upsetsOdds (DraftKings h2h)
  //    This endpoint already has working Odds API integration + caching.
  const oddsUrl =
    `${base}/api/upsetsOdds?league=${encodeURIComponent(league)}` +
    (date ? `&date=${encodeURIComponent(date)}` : "") +
    `&limit=50&ttlSec=60&overlayModel=0`;
  const odds = await fetchJson(oddsUrl);

  const rows = Array.isArray(odds?.rows) ? odds.rows : [];

  // Build map: "away @ home" -> { homeOdds, awayOdds }
  const oddsByMatchup = new Map();
  for (const r of rows) {
    const home = r?.home?.name || r?.favorite?.name || "";
    const away = r?.away?.name || r?.underdog?.name || "";
    const ml = r?.market?.moneyline || {};
    const homeOdds = Number.isFinite(ml.homeOdds) ? ml.homeOdds : null;
    const awayOdds = Number.isFinite(ml.awayOdds) ? ml.awayOdds : null;
    const key = matchupKey(away, home);
    oddsByMatchup.set(key, { homeOdds, awayOdds });
  }

  // 3) Build candidates from predictions, backfilling moneyline odds when missing
  const candidates = [];

  for (const g of games) {
    const m = g?.market || {};
    const marketType = String(m.marketType || "").toLowerCase();

    // We only build *parlay legs* from moneyline picks (clean + consistent)
    if (marketType !== "moneyline") continue;

    const awayName = g?.away?.name || g?.away?.abbr || "";
    const homeName = g?.home?.name || g?.home?.abbr || "";
    const key = matchupKey(awayName, homeName);

    const pick = String(m.pick || m.marketSide || "").toLowerCase(); // "home" / "away"
    const winProb = Number(m.winProb);

    let oddsAmerican = Number.isFinite(m.marketOdds) ? Number(m.marketOdds) : null;

    if (!Number.isFinite(oddsAmerican)) {
      const o = oddsByMatchup.get(key);
      if (o) {
        if (pick === "home") oddsAmerican = Number.isFinite(o.homeOdds) ? o.homeOdds : null;
        if (pick === "away") oddsAmerican = Number.isFinite(o.awayOdds) ? o.awayOdds : null;
      }
    }

    // If still missing, skip (can't price EV / can't parlay)
    if (!Number.isFinite(oddsAmerican) || !Number.isFinite(winProb)) continue;

    const { evForStake100, kellyHalf } = computeMarketEV({
      oddsAmerican,
      winProb,
      stake: 100,
    });

    if (evOnly && !(Number.isFinite(evForStake100) && evForStake100 > 0)) continue;

    candidates.push({
      league,
      gameId: g?.gameId || g?.id || null,
      matchup: `${g?.away?.abbr || awayName} @ ${g?.home?.abbr || homeName}`.trim(),
      pickSide: pick,
      odds: oddsAmerican,
      decimalOdds: americanToDecimal(oddsAmerican),
      implied: impliedFromAmerican(oddsAmerican),
      modelProb: winProb,
      modelProbSource: "predictions",
      evForStake100,
      kellyHalf,
      tier: String(m.tier || "PASS"),
      why: [
        "Source: /api/predictions (moneyline picks)",
        "Backfill odds: /api/upsetsOdds (DraftKings h2h) when missing",
      ],
    });
  }

  // Hard cap so combos don't explode
  candidates.sort((a, b) => (b.evForStake100 ?? -1e9) - (a.evForStake100 ?? -1e9));
  const poolMax = clampNum(Number(process.env.PARLAYS_PRED_POOL_MAX || 18), 6, 30);
  const pool = candidates.slice(0, poolMax);

  const n = pool.length;
  if (n < legs) {
    return {
      ok: true,
      route: "parlaysOdds",
      version: "parlaysOdds-v3-predictions-odds-backfill",
      mode: "predictions",
      league,
      date,
      legs,
      poolSize: n,
      candidates: n,
      count: 0,
      parlays: [],
      meta: {
        source: "api/predictions + upsetsOdds moneyline backfill",
        evOnly,
        internalBase: base,
        note: `Not enough moneyline candidates with odds to build legs=${legs}. Try evOnly=0 or lower legs.`,
      },
    };
  }

  const combos = choose(n, legs);
  const parlays = [];

  for (const ix of combos) {
    const legsArr = ix.map((i) => pool[i]);

    // Combine
    let dec = 1;
    let prob = 1;
    for (const L of legsArr) {
      const d = Number(L.decimalOdds);
      const p = Number(L.modelProb);
      if (!Number.isFinite(d) || d <= 1) { dec = null; break; }
      if (!Number.isFinite(p) || p <= 0 || p >= 1) { prob = null; break; }
      dec *= d;
      prob *= p;
    }
    if (!Number.isFinite(dec) || !Number.isFinite(prob)) continue;

    const combinedAmericanOdds = decimalToAmerican(dec);
    const { evForStake100, kellyHalf } = computeMarketEV({
      oddsAmerican: combinedAmericanOdds,
      winProb: prob,
      stake: 100,
    });

    if (evOnly && !(Number.isFinite(evForStake100) && evForStake100 > 0)) continue;

    parlays.push({
      legs: legsArr.map((L) => ({
        league: L.league,
        gameId: L.gameId,
        matchup: L.matchup,
        pickSide: L.pickSide,
        odds: L.odds,
        modelProb: L.modelProb,
        evForStake100: L.evForStake100,
        tier: L.tier,
      })),
      combinedDecimalOdds: dec,
      combinedAmericanOdds,
      modelProb: prob,
      evForStake100,
      kellyHalf,
    });
  }

  parlays.sort((a, b) => (b.evForStake100 ?? -1e9) - (a.evForStake100 ?? -1e9));

  return {
    ok: true,
    route: "parlaysOdds",
    version: "parlaysOdds-v3-predictions-odds-backfill",
    mode: "predictions",
    league,
    date,
    legs,
    poolSize: pool.length,
    candidates: candidates.length,
    count: Math.min(limit, parlays.length),
    parlays: parlays.slice(0, limit),
    meta: {
      source: "api/predictions + upsetsOdds moneyline backfill",
      evOnly,
      internalBase: base,
    },
  };
}

router.get("/ping", (req, res) => {
  res.json({
    ok: true,
    route: "parlaysOdds",
    version: "parlaysOdds-v3-predictions-odds-backfill",
  });
});

router.get("/", async (req, res) => {
  try {
    const league = String(req.query.league || "nba").toLowerCase();
    const date = String(req.query.date || "").trim() || null;

    const legs = clampNum(req.query.legs ?? 2, 2, 6);
    const limit = clampNum(req.query.limit ?? 5, 1, 25);

    const mode = String(req.query.mode || "predictions").toLowerCase();
    const evOnly = String(req.query.evOnly || "0") === "1" || String(req.query.evOnly || "").toLowerCase() === "true";

    if (mode !== "predictions") {
      return res.status(400).json({
        ok: false,
        route: "parlaysOdds",
        version: "parlaysOdds-v3-predictions-odds-backfill",
        error: `Unsupported mode="${mode}". Use mode=predictions.`,
      });
    }

    const out = await buildPredictionParlays({
      req,
      league,
      date,
      legs,
      limit,
      evOnly,
    });

    res.json(out);
  } catch (e) {
    res.status(200).json({
      ok: false,
      route: "parlaysOdds",
      version: "parlaysOdds-v3-predictions-odds-backfill",
      error: String(e?.message || e),
      meta: { internalBase: process.env.INTERNAL_BASE_URL || "http://127.0.0.1:3001" },
    });
  }
});

export default router;
