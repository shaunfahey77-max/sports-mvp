// apps/api/src/routes/upsets.js
import express from "express";

const router = express.Router();

/**
 * Upsets v8 — market-aware (odds-implied vs model prob)
 * - Source: /api/predictions (premium model output)
 * - leagues: nba | nhl | ncaam
 *
 * Key fixes vs v7:
 * ✅ Uses MARKET implied probability (from odds) when available
 * ✅ Defines “upset candidate” as: underdog implied <= maxImplied AND modelProb - implied >= minEdge
 * ✅ Doesn’t rely on factor-derived “gap” to decide favorite/underdog (that was a big source of false positives)
 * ✅ Strict mode = only return rows where the model actually recommends the underdog side
 * ✅ Always returns stable numeric meta fields
 *
 * Query:
 *  - league (default nba)
 *  - date (YYYY-MM-DD, default today)
 *  - limit (default 20, max 50)
 *  - mode: watch | strict  (default watch)
 *  - model: forwarded to /api/predictions (optional)
 *  - maxImplied (default 0.45)  // underdog must be <= 45% implied
 *  - minEdge (default 0.05)     // modelProb - implied >= 5%
 *  - minProb (default 0.35)     // model probability for the underdog side
 *
 * Output:
 *  - rows[] (for web UI)
 *  - candidates[] (back-compat)
 */

const VERSION = "upsets-v8-market-aware";

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function asInt(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function asFloat(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function makeMatchup(away, home) {
  const a = away?.abbr || away?.name || "AWAY";
  const h = home?.abbr || home?.name || "HOME";
  return `${a} @ ${h}`;
}

// ✅ strict validation: must be a real prob between (0,1)
function isRealProb(p) {
  return Number.isFinite(p) && p > 0 && p < 1;
}

// --- Odds helpers -----------------------------------------------------------
// Accepts american odds as number or string: +150, -110, "150", "-110"
function toAmericanOdds(x) {
  if (x == null) return null;
  const s = String(x).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

function impliedProbFromAmerican(oddsAmerican) {
  const o = toAmericanOdds(oddsAmerican);
  if (o == null) return null;
  if (o > 0) return 100 / (o + 100);
  return -o / (-o + 100);
}

function americanToDecimal(oddsAmerican) {
  const o = toAmericanOdds(oddsAmerican);
  if (o == null) return null;
  if (o > 0) return 1 + o / 100;
  return 1 + 100 / (-o);
}

// Best-effort fetch that works on Node 18+ (global fetch) and older Node
async function safeFetch(url) {
  if (typeof fetch === "function") return fetch(url);
  const mod = await import("node-fetch");
  return mod.default(url);
}

async function fetchJson(url) {
  const r = await safeFetch(url);
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = j?.error || `Request failed (${r.status})`;
    throw new Error(msg);
  }
  return j;
}

// Determine which side is the underdog using available market moneyline odds.
// Returns { underdogSide: "home"|"away", favoriteSide: "home"|"away", underdogOdds, favoriteOdds, impliedUnderdog }
// If odds not available / invalid, returns null.
function deriveDogFromMarketMoneyline(market) {
  const ml = market?.moneyline || market?.ml || market?.markets?.moneyline || null;

  // Try common shapes:
  // ml.homeOdds / ml.awayOdds
  // ml.home / ml.away
  // market.homeOdds / market.awayOdds
  const homeOdds =
    toAmericanOdds(ml?.homeOdds ?? ml?.home ?? market?.homeOdds ?? market?.homeMoneylineOdds);
  const awayOdds =
    toAmericanOdds(ml?.awayOdds ?? ml?.away ?? market?.awayOdds ?? market?.awayMoneylineOdds);

  // Sometimes the prediction object uses market.marketOdds + market.pick, which is useless for dog detection.
  // We REQUIRE both sides' odds to classify dog/fav.
  if (homeOdds == null || awayOdds == null) return null;

  // Higher implied probability => favorite (typically more negative)
  const pHome = impliedProbFromAmerican(homeOdds);
  const pAway = impliedProbFromAmerican(awayOdds);
  if (!isRealProb(pHome) || !isRealProb(pAway)) return null;

  const homeIsFav = pHome >= pAway;
  const favoriteSide = homeIsFav ? "home" : "away";
  const underdogSide = homeIsFav ? "away" : "home";

  const underdogOdds = underdogSide === "home" ? homeOdds : awayOdds;
  const favoriteOdds = favoriteSide === "home" ? homeOdds : awayOdds;

  const impliedUnderdog = impliedProbFromAmerican(underdogOdds);

  return {
    underdogSide,
    favoriteSide,
    underdogOdds,
    favoriteOdds,
    impliedUnderdog,
    homeOdds,
    awayOdds,
  };
}

// Model probability for a side.
// We prefer explicit market probs if your /api/predictions emits them.
// Supports (best-effort):
// - market.homeWinProb / market.awayWinProb
// - market.probs.home / market.probs.away
// - market.winProb as "picked side" prob + market.pick side
function getModelProbForSide(market, side /* "home"|"away" */) {
  const m = market || {};

  const directHome = m?.homeWinProb ?? m?.homeProb ?? m?.probs?.home ?? m?.probHome;
  const directAway = m?.awayWinProb ?? m?.awayProb ?? m?.probs?.away ?? m?.probAway;

  if (side === "home" && isRealProb(Number(directHome))) return Number(directHome);
  if (side === "away" && isRealProb(Number(directAway))) return Number(directAway);

  // Fallback: picked-side winProb (as used in your v7)
  const pick = String(m?.pick || "").toLowerCase(); // "home"|"away"
  const pickedSideProb = m?.winProb;

  if ((pick === "home" || pick === "away") && isRealProb(Number(pickedSideProb))) {
    const pPick = Number(pickedSideProb);
    if (side === pick) return pPick;
    return 1 - pPick;
  }

  // Last fallback: confidence (very weak)
  const conf = Number(m?.confidence);
  if (Number.isFinite(conf)) {
    const pPick = clamp(conf, 0.05, 0.95);
    if (pick === "home" || pick === "away") {
      if (side === pick) return pPick;
      return 1 - pPick;
    }
  }

  return null;
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "upsets", version: VERSION });
});

router.get("/", async (req, res) => {
  const t0 = Date.now();
  try {
    const league = String(req.query.league || "nba").trim().toLowerCase();
    const date = String(req.query.date || iso(new Date())).slice(0, 10);

    const limit = clamp(asInt(req.query.limit, 20), 1, 50);

    const mode = String(req.query.mode || "watch").trim().toLowerCase(); // watch | strict
    const model = req.query.model != null ? String(req.query.model).trim().toLowerCase() : null;

    // Upset definition
    const maxImplied = clamp(asFloat(req.query.maxImplied, 0.45), 0.05, 0.9);
    const minEdge = clamp(asFloat(req.query.minEdge, 0.05), 0.0, 0.5);
    const minProb = clamp(asFloat(req.query.minProb, 0.35), 0.05, 0.95);

    // Use the same host the request hit (works local + deploy)
    const base = `${req.protocol}://${req.get("host")}`;

    const predUrl =
      `${base}/api/predictions?league=${encodeURIComponent(league)}` +
      `&date=${encodeURIComponent(date)}` +
      (model ? `&model=${encodeURIComponent(model)}` : "");

    const pred = await fetchJson(predUrl);

    const games = Array.isArray(pred?.games) ? pred.games : [];
    const slateGames = games.length;

    let strictUnderdogPicks = 0;
    let skippedNoTwoSidedOdds = 0;
    let skippedNoModelProb = 0;

    const rows = [];

    for (const g of games) {
      const home = g?.home || g?.homeTeam || null;
      const away = g?.away || g?.awayTeam || null;
      if (!home || !away) continue;

      const market = g?.market || {};

      // ✅ Determine dog/fav from MARKET ML odds (two-sided)
      const dogInfo = deriveDogFromMarketMoneyline(market);
      if (!dogInfo) {
        skippedNoTwoSidedOdds += 1;
        continue;
      }

      const {
        underdogSide,
        favoriteSide,
        underdogOdds,
        favoriteOdds,
        impliedUnderdog,
        homeOdds,
        awayOdds,
      } = dogInfo;

      if (!isRealProb(impliedUnderdog)) {
        skippedNoTwoSidedOdds += 1;
        continue;
      }

      // Gate: must be a true underdog by implied probability
      if (impliedUnderdog > maxImplied) continue;

      // ✅ Model probability for underdog side
      const pDog = getModelProbForSide(market, underdogSide);
      if (!isRealProb(pDog)) {
        skippedNoModelProb += 1;
        continue;
      }

      const edge = pDog - impliedUnderdog;
      if (edge < minEdge) continue;
      if (pDog < minProb) continue;

      // strict mode: only show if model actually recommends the underdog
      const pickSide = String(market?.pick || "").toLowerCase() || null;
      const modelPickedUnderdog = pickSide === underdogSide;

      if (modelPickedUnderdog) strictUnderdogPicks += 1;
      if (mode === "strict" && !modelPickedUnderdog) continue;

      const underdogTeam = underdogSide === "home" ? home : away;
      const favoriteTeam = favoriteSide === "home" ? home : away;

      // Simple sort score: prioritize edge, then probability, then longer odds slightly
      const score = edge * 100 + pDog * 10 + Math.max(0, (americanToDecimal(underdogOdds) ?? 1) - 2);

      const why = [];
      why.push(`Underdog implied: ${(impliedUnderdog * 100).toFixed(1)}%`);
      why.push(`Model underdog: ${(pDog * 100).toFixed(1)}%`);
      why.push(`Edge: ${(edge * 100).toFixed(1)}%`);
      why.push(`Dog odds: ${underdogOdds > 0 ? `+${underdogOdds}` : `${underdogOdds}`}`);
      if (mode === "strict") why.push("Strict mode: model must pick the underdog");
      if (modelPickedUnderdog) why.push("Model picked the underdog");

      rows.push({
        id: g?.gameId || `${league}-${date}-${makeMatchup(away, home)}`,
        gameId: g?.gameId || null,
        league,
        date,
        matchup: makeMatchup(away, home),

        home: { id: home?.id, name: home?.name, abbr: home?.abbr, logo: home?.logo },
        away: { id: away?.id, name: away?.name, abbr: away?.abbr, logo: away?.logo },

        underdog: {
          id: underdogTeam?.id,
          name: underdogTeam?.name,
          abbr: underdogTeam?.abbr,
          isHome: underdogSide === "home",
        },
        favorite: {
          id: favoriteTeam?.id,
          name: favoriteTeam?.name,
          abbr: favoriteTeam?.abbr,
          isHome: favoriteSide === "home",
        },

        // UI key: winProb should mean underdog win probability
        winProb: pDog,

        market: {
          moneyline: {
            homeOdds,
            awayOdds,
            underdogOdds,
            favoriteOdds,
            impliedUnderdog,
          },
        },

        pick: {
          pickSide: pickSide,
          modelPickedUnderdog,
          // keep your existing fields if present
          recommendedTeamId: market?.recommendedTeamId ?? null,
          recommendedTeamName: market?.recommendedTeamName ?? null,
          confidence: Number.isFinite(Number(market?.confidence)) ? Number(market.confidence) : null,
          // explicit probability fields
          modelProbUnderdog: pDog,
          marketImpliedUnderdog: impliedUnderdog,
          edge,
        },

        signals: {
          score,
          mode,
          favoriteSide,
          underdogSide,
          model: model || null,
        },

        why,
      });
    }

    rows.sort((a, b) => (b?.signals?.score ?? 0) - (a?.signals?.score ?? 0));
    const trimmed = rows.slice(0, limit);

    return res.json({
      ok: true,
      league,
      date,
      mode,
      maxImplied,
      minEdge,
      minProb,
      count: trimmed.length,
      rows: trimmed,
      candidates: trimmed, // back-compat
      meta: {
        source: "premium-predictions",
        slateGames,
        rowsIn: rows.length,
        rowsOut: trimmed.length,
        strictUnderdogPicks, // ALWAYS number
        skippedNoTwoSidedOdds, // ALWAYS number
        skippedNoModelProb, // ALWAYS number
        limitUsed: limit,
        modelForwarded: model || null,
        elapsedMs: Date.now() - t0,
        version: VERSION,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;