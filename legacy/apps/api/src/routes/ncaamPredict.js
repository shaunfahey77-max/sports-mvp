// legacy/apps/api/src/routes/ncaamPredict.js
import express from "express";

const router = express.Router();

const ESPN_NCAAM_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

function normalizeDateParam(dateLike) {
  const s = String(dateLike || "").trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function ymdToEspnDate(ymd) {
  return String(ymd || "").replaceAll("-", "");
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function logistic(z) {
  return 1 / (1 + Math.exp(-z));
}

async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      "user-agent": "sports-mvp/1.0 (+local dev)",
      accept: "application/json,text/plain,*/*",
    },
  }).finally(() => clearTimeout(t));

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status} for ${url}${text ? ` — ${text}` : ""}`);
  }

  return res.json();
}

function parseRecordSummary(summary) {
  const s = String(summary || "").trim();
  const m = s.match(/^(\d+)\s*-\s*(\d+)/);
  if (!m) return null;

  const wins = Number(m[1]);
  const losses = Number(m[2]);
  const games = wins + losses;
  if (!Number.isFinite(wins) || !Number.isFinite(losses) || games <= 0) return null;

  return { wins, losses, games, pct: wins / games };
}

function pickRecordObj(competitor) {
  const recs = safeArr(competitor?.records);
  const best =
    recs.find((r) => String(r?.type || "").toLowerCase() === "total") ||
    recs.find((r) => String(r?.name || "").toLowerCase() === "overall") ||
    recs[0] ||
    null;

  const summary =
    best?.summary ||
    competitor?.record?.summary ||
    competitor?.team?.record?.summary ||
    null;

  return parseRecordSummary(summary);
}

function pickRankNumber(obj) {
  const a = obj?.curatedRank?.current;
  const b = obj?.rank?.current;
  const c = obj?.team?.rank?.current;
  const d = obj?.team?.curatedRank?.current;
  const cand = [a, b, c, d].find((x) => x != null);
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tierFromWinProb(p) {
  if (p >= 0.64) return "A";
  if (p >= 0.59) return "B";
  if (p >= 0.55) return "C";
  return "D";
}

function confidenceFromWinProb(p) {
  // map 0.50..0.80 into ~0.50..0.95
  const x = (p - 0.5) / 0.3;
  return clamp(0.5 + x * 0.45, 0.5, 0.95);
}

function pickLogo(teamObj) {
  // ESPN often provides team.logos[0].href
  const direct = teamObj?.logo;
  if (direct) return direct;
  const logos = safeArr(teamObj?.logos);
  const href = logos?.[0]?.href;
  return href || null;
}

function safeScore(competitor) {
  const n = Number(competitor?.score);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatus(ev, comp) {
  const s =
    comp?.status?.type?.description ||
    comp?.status?.type?.name ||
    ev?.status?.type?.description ||
    ev?.status?.type?.name ||
    "Scheduled";
  return String(s);
}

/**
 * Premium pick builder:
 * - Uses record% + rank bonus
 * - Adds SMALL home-court prior to avoid “away bias” look
 * - winProb ALWAYS refers to picked side (>= 0.50)
 * - edge ALWAYS >= 0
 */
function makePick({ homeRec, awayRec, homeRank, awayRank }) {
  if (!homeRec?.pct || !awayRec?.pct) return null;

  const rankBonus = (rank) => {
    if (!rank) return 0;
    // top 25 gets up to +0.035, fades to 0
    return clamp((26 - Math.min(rank, 26)) / 25, 0, 1) * 0.035;
  };

  // ✅ small home-court prior
  const HOME_COURT = 0.015;

  const homeStrength = homeRec.pct + rankBonus(homeRank) + HOME_COURT;
  const awayStrength = awayRec.pct + rankBonus(awayRank);

  // Positive diff => away stronger
  const diff = awayStrength - homeStrength;

  // Convert diff into probability (clamp extremes)
  const pAway = clamp(logistic(diff * 6), 0.05, 0.95);
  const pHome = 1 - pAway;

  const pickSide = pAway >= pHome ? "away" : "home";
  const winProb = pickSide === "away" ? pAway : pHome;

  const tier = tierFromWinProb(winProb);
  const confidence = confidenceFromWinProb(winProb);
  const edge = winProb - 0.5;

  return {
    pickSide,
    winProb: Number(winProb.toFixed(4)),
    edge: Number(edge.toFixed(4)),
    tier,
    confidence: Number(confidence.toFixed(4)),
    signals: {
      homeRecord: homeRec,
      awayRecord: awayRec,
      homeRank,
      awayRank,
      homeStrength: Number(homeStrength.toFixed(4)),
      awayStrength: Number(awayStrength.toFixed(4)),
      pAway: Number(pAway.toFixed(4)),
      pHome: Number(pHome.toFixed(4)),
      homeCourt: HOME_COURT,
    },
  };
}

async function getEspnSlate(dateYYYYMMDD) {
  const espnDate = ymdToEspnDate(dateYYYYMMDD);
  const sourceUrl = `${ESPN_NCAAM_SCOREBOARD}?dates=${encodeURIComponent(espnDate)}`;
  const json = await fetchJson(sourceUrl);
  const events = safeArr(json?.events);
  return { events, sourceUrl };
}

/**
 * ✅ Exported builder (used by /api/predictions + /api/upsets)
 * Returns unified contract games[] with home/away + market
 */
export async function buildNcaamEspnPredictions(dateYYYYMMDD) {
  const date = normalizeDateParam(dateYYYYMMDD) || todayUTCYYYYMMDD();
  const { events, sourceUrl } = await getEspnSlate(date);

  const games = [];
  let noPickCount = 0;

  for (const ev of events) {
    const comp = safeArr(ev?.competitions)[0] || null;
    const competitors = safeArr(comp?.competitors);

    const homeC = competitors.find((c) => c?.homeAway === "home") || null;
    const awayC = competitors.find((c) => c?.homeAway === "away") || null;

    const homeT = homeC?.team || {};
    const awayT = awayC?.team || {};

    const eventId = ev?.id ? String(ev.id) : null;
    if (!eventId) continue;

    const status = normalizeStatus(ev, comp);

    const home = {
      id: `ncaam-${String(homeT?.abbreviation || homeT?.id || "home").toLowerCase()}`,
      name: homeT?.displayName || homeT?.shortDisplayName || homeT?.abbreviation || "Home",
      abbr: homeT?.abbreviation || null,
      logo: pickLogo(homeT),
      espnTeamId: homeT?.id || null,
    };

    const away = {
      id: `ncaam-${String(awayT?.abbreviation || awayT?.id || "away").toLowerCase()}`,
      name: awayT?.displayName || awayT?.shortDisplayName || awayT?.abbreviation || "Away",
      abbr: awayT?.abbreviation || null,
      logo: pickLogo(awayT),
      espnTeamId: awayT?.id || null,
    };

    const homeRec = pickRecordObj(homeC);
    const awayRec = pickRecordObj(awayC);

    const homeRank = pickRankNumber(homeC) || pickRankNumber(homeT) || null;
    const awayRank = pickRankNumber(awayC) || pickRankNumber(awayT) || null;

    const pick = makePick({ homeRec, awayRec, homeRank, awayRank });

    const matchup = `${away.abbr || away.name} @ ${home.abbr || home.name}`;
    const gameId = `ncaam-${eventId}`;

    // scores if available (often null when Scheduled)
    const homeScore = safeScore(homeC);
    const awayScore = safeScore(awayC);

    if (!pick) noPickCount += 1;

    const market = pick
      ? {
          pick: pick.pickSide, // "home" | "away"
          winProb: pick.winProb, // picked-side win prob
          confidence: pick.confidence,
          edge: pick.edge,
          tier: pick.tier,
          recommendedTeamId: pick.pickSide === "home" ? home.id : away.id,
          recommendedTeamName: pick.pickSide === "home" ? home.name : away.name,
        }
      : {
          pick: null,
          winProb: null,
          confidence: null,
          edge: null,
          tier: null,
          recommendedTeamId: null,
          recommendedTeamName: null,
        };

    games.push({
      // unified identifiers
      gameId,
      id: gameId,
      league: "ncaam",
      date,
      status,
      home,
      away,
      homeScore,
      awayScore,
      market,

      // back-compat fields (your UI/upsets have seen these too)
      matchup,
      pickSide: market.pick,
      winProb: market.winProb,
      edge: market.edge,
      tier: market.tier,
      confidence: market.confidence,
      signals: pick?.signals || { homeRecord: homeRec, awayRecord: awayRec, homeRank, awayRank },
      pick: pick
        ? {
            gameId,
            matchup,
            pickSide: market.pick,
            winProb: market.winProb,
            edge: market.edge,
            tier: market.tier,
            confidence: market.confidence,
            signals: pick.signals,
          }
        : null,
    });
  }

  return {
    ok: true,
    league: "ncaam",
    date,
    meta: {
      league: "ncaam",
      date,
      model: "NCAAM espn-record-rank-v3-homecourt",
      source: "espn-scoreboard",
      sourceUrl,
      windowDays: null,
      noPickCount,
      note: "Unified contract output (home/away/market) + ESPN logos. winProb refers to picked side.",
      warnings: [],
    },
    games,
  };
}

/**
 * ✅ /api/ncaam/predict
 */
router.get("/ncaam/predict", async (req, res) => {
  const date = normalizeDateParam(req.query.date || req.query["dates[]"]) || todayUTCYYYYMMDD();

  try {
    const payload = await buildNcaamEspnPredictions(date);
    return res.json(payload);
  } catch (e) {
    return res.status(502).json({
      ok: false,
      league: "ncaam",
      date,
      meta: {
        league: "ncaam",
        date,
        model: "NCAAM espn-record-rank-v3-homecourt",
        source: "espn-scoreboard",
        sourceUrl: null,
        windowDays: null,
        noPickCount: null,
        note: "Failed to generate NCAAM predictions from ESPN.",
        warnings: [String(e?.message || e)],
      },
      games: [],
      error: String(e?.message || e),
    });
  }
});

export default router;
