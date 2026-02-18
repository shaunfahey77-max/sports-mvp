// legacy/apps/api/src/routes/ncaamPredict.js
import express from "express";

const router = express.Router();

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

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

function clamp(x, lo, hi) {
  const n = Number(x);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// Convert a “rating” delta into probability (simple logistic-ish)
function probFromDelta(delta) {
  // delta ~ (-50..50) typical after scaling
  const z = clamp(delta / 12, -6, 6);
  const p = 1 / (1 + Math.exp(-z));
  // keep this conservative
  return clamp(p, 0.30, 0.70);
}

function tierFromEdgeAbs(e) {
  const x = Math.abs(Number(e) || 0);
  if (x >= 0.14) return "A";
  if (x >= 0.09) return "B";
  if (x >= 0.05) return "C";
  return "D";
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getTeamFields(teamObj, fallbackAbbr) {
  const abbr = teamObj?.abbreviation || fallbackAbbr || null;
  return {
    name: teamObj?.displayName || teamObj?.shortDisplayName || abbr || "Team",
    abbr,
    espnTeamId: teamObj?.id ? String(teamObj.id) : null,
    // ESPN provides rank in some responses. If missing, we treat it as neutral.
    rank: safeNum(teamObj?.rank) ?? safeNum(teamObj?.curatedRank?.current) ?? null,
    // record is often in teamObj.recordSummary like "18-7"
    recordSummary: teamObj?.recordSummary || null,
  };
}

function parseWinsLosses(recordSummary) {
  // "18-7" => 18,7
  const s = String(recordSummary || "").trim();
  const m = s.match(/^(\d+)\s*-\s*(\d+)/);
  if (!m) return { w: null, l: null };
  return { w: Number(m[1]), l: Number(m[2]) };
}

function winPctFromRecord(recordSummary) {
  const { w, l } = parseWinsLosses(recordSummary);
  if (!Number.isFinite(w) || !Number.isFinite(l)) return null;
  const d = w + l;
  if (d <= 0) return null;
  return w / d;
}

function matchupLabel(away, home) {
  return `${away?.abbr || away?.name || "AWAY"} @ ${home?.abbr || home?.name || "HOME"}`;
}

/**
 * Option B scoring:
 * - Uses rank (if available) and record win% (if available)
 * - Conservative weights so it doesn't go “all home team”
 */
function computeHomeWinProb({ home, away, neutralSite = false, tournamentMode = false }) {
  const homeWinPct = winPctFromRecord(home.recordSummary);
  const awayWinPct = winPctFromRecord(away.recordSummary);

  // Rank: lower is better. Convert to “strength”.
  // If rank missing, treat as 0 signal.
  const homeRank = home.rank;
  const awayRank = away.rank;

  const rankSignal =
    Number.isFinite(homeRank) && Number.isFinite(awayRank)
      ? (awayRank - homeRank) // if away rank is worse (bigger), favors home
      : 0;

  const recordSignal =
    homeWinPct != null && awayWinPct != null ? (homeWinPct - awayWinPct) * 100 : 0;

  // Home court: reduce in tournament/neutral
  const homeAdj = neutralSite || tournamentMode ? 0.00 : 2.0;

  // Combine into a single delta
  // rankSignal tends to be smallish (like 5..30), recordSignal (like -30..30)
  const delta = (0.55 * rankSignal) + (0.65 * recordSignal) + homeAdj;

  return probFromDelta(delta);
}

router.get("/ncaam/predict", async (req, res) => {
  const date = normalizeDateParam(req.query.date || req.query["dates[]"]) || todayUTCYYYYMMDD();
  const tournamentMode = String(req.query.tournament || "0") === "1";

  try {
    const espnDate = ymdToEspnDate(date);
    const sourceUrl = `${ESPN_SCOREBOARD}?dates=${encodeURIComponent(espnDate)}`;

    const json = await fetchJson(sourceUrl);
    const events = safeArr(json?.events);

    const games = events
      .map((ev) => {
        const comp = safeArr(ev?.competitions)[0] || null;
        const competitors = safeArr(comp?.competitors);

        const homeC = competitors.find((c) => c?.homeAway === "home") || null;
        const awayC = competitors.find((c) => c?.homeAway === "away") || null;

        const homeT = homeC?.team || {};
        const awayT = awayC?.team || {};

        const eventId = ev?.id ? String(ev.id) : null;
        const gameId = eventId ? `ncaam-${eventId}` : null;

        const home = getTeamFields(homeT, homeT?.abbreviation);
        const away = getTeamFields(awayT, awayT?.abbreviation);

        const neutralSite = Boolean(comp?.neutralSite);

        if (!gameId) {
          return {
            gameId: null,
            matchup: matchupLabel(away, home),
            pickSide: null,
            winProb: null,
            edge: null,
            tier: null,
            confidence: null,
          };
        }

        const homeWinProb = computeHomeWinProb({ home, away, neutralSite, tournamentMode });

        const pickSide = homeWinProb >= 0.5 ? "home" : "away";
        const winProb = pickSide === "home" ? homeWinProb : (1 - homeWinProb);

        // edge vs 50/50 baseline
        const edge = winProb - 0.5;
        const tier = tierFromEdgeAbs(edge);

        // confidence = how far from 50/50 (0..1)
        const confidence = clamp(Math.abs(winProb - 0.5) * 2, 0, 1);

        return {
          gameId,
          matchup: matchupLabel(away, home),
          pickSide,
          winProb: Number(winProb.toFixed(4)),
          edge: Number(edge.toFixed(4)),
          tier,
          confidence: Number(confidence.toFixed(4)),
          // keep signals minimal but useful
          signals: {
            neutralSite,
            tournamentMode,
            home: { rank: home.rank, record: home.recordSummary },
            away: { rank: away.rank, record: away.recordSummary },
          },
        };
      })
      .filter(Boolean);

    const noPickCount = games.filter((g) => !g?.pickSide).length;

    return res.json({
      ok: true,
      meta: {
        league: "ncaam",
        date,
        model: "NCAAM espn-record-rank-v1",
        source: "espn-scoreboard",
        sourceUrl,
        windowDays: null,
        noPickCount,
        note: "Option B: ESPN scoreboard only (record + rank). No CBBD quota. Fast + stable.",
        warnings: [],
      },
      games,
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      meta: {
        league: "ncaam",
        date,
        model: "NCAAM espn-record-rank-v1",
        source: "espn-scoreboard",
        error: String(e?.message || e),
      },
      games: [],
    });
  }
});

export default router;
