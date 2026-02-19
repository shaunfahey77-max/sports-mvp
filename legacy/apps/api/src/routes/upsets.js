// legacy/apps/api/src/routes/upsets.js
import express from "express";

const router = express.Router();

/* =========================================================
   PREMIUM UPSET WATCH v11 (NO-IMPORT, WHY OBJECT GUARANTEE)
   - Fixes logo null issue (abbr/id normalization + ESPN fallbacks)
   - Guarantees rows[i].why is ALWAYS an object:
       { headline, bullets, deltas }
   - Guarantees pick.why is ALWAYS either an object or null
   - No dependency on modelMath.js / why.js
   ========================================================= */

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeDate(date) {
  const s = String(date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

/* =============================
   ABBREVIATION RESOLUTION
============================= */

function inferAbbr(raw) {
  const t = raw?.team || raw || {};

  const direct =
    t?.abbr ||
    t?.abbreviation ||
    t?.shortName ||
    t?.displayAbbreviation ||
    t?.code ||
    raw?.abbr ||
    raw?.abbreviation ||
    null;

  if (direct) return String(direct).toUpperCase().trim();

  const name = String(t?.name || t?.displayName || t?.shortDisplayName || raw?.name || "").trim();
  if (/^[A-Z]{2,4}$/.test(name)) return name;

  const idLike = String(t?.id ?? t?.slug ?? raw?.id ?? raw?.slug ?? "").trim();
  if (idLike) {
    const parts = idLike.split("-").filter(Boolean);
    const last = parts[parts.length - 1];
    if (/^[a-z]{2,4}$/i.test(last)) return last.toUpperCase();
  }

  return null;
}

/* =============================
   TEAM ID NORMALIZATION
============================= */

function canonicalTeamId(league, raw, abbr) {
  const t = raw?.team || raw || {};

  const rawId =
    t?.id != null
      ? String(t.id)
      : t?.slug
      ? String(t.slug)
      : raw?.id != null
      ? String(raw.id)
      : raw?.slug
      ? String(raw.slug)
      : "";

  if (rawId) {
    const parts = rawId.split("-").filter(Boolean);
    while (parts.length > 1 && String(parts[0]).toLowerCase() === league) parts.shift();
    return `${league}-${parts.join("-")}`;
  }

  if (abbr) return `${league}-${abbr.toLowerCase()}`;
  return `${league}-team`;
}

/* =============================
   LOGO RESOLUTION
============================= */

function pickLogo(team) {
  return (
    team?.logo ||
    team?.logos?.[0]?.href ||
    team?.team?.logo ||
    team?.team?.logos?.[0]?.href ||
    null
  );
}

function espnLogoByAbbr(league, abbr, size = 80) {
  if (!abbr) return null;
  const a = String(abbr).toLowerCase();

  if (league === "nba") {
    return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/scoreboard/${a}.png&h=${size}&w=${size}`;
  }
  if (league === "nhl") {
    return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nhl/500/scoreboard/${a}.png&h=${size}&w=${size}`;
  }
  if (league === "ncaam") {
    // ESPN college scoreboard logos can work when abbr matches ESPN’s token
    return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/scoreboard/${a}.png&h=${size}&w=${size}`;
  }

  return null;
}

function espnNcaamLogoById(raw) {
  const t = raw?.team || raw || {};
  const id = Number(t?.espnTeamId || t?.id || raw?.id);
  if (!Number.isFinite(id)) return null;
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
}

function normalizeTeam(league, raw) {
  const abbr = inferAbbr(raw);
  const id = canonicalTeamId(league, raw, abbr);

  const name =
    raw?.team?.displayName ||
    raw?.team?.name ||
    raw?.name ||
    abbr ||
    "Team";

  const logo =
    pickLogo(raw) ||
    pickLogo(raw?.team) ||
    (league === "ncaam" ? espnNcaamLogoById(raw) : null) ||
    espnLogoByAbbr(league, abbr);

  return { id, name, abbr, logo };
}

/* =============================
   PICK EXTRACTION
============================= */

function extractPick(g) {
  return {
    pickSide: g?.market?.pick ?? g?.pick?.pickSide ?? g?.pickSide ?? g?.pick ?? null,
    winProb: g?.market?.winProb ?? g?.pick?.winProb ?? g?.winProb ?? null,
    edge: g?.market?.edge ?? g?.pick?.edge ?? g?.edge ?? null,
    why: g?.market?.why ?? g?.pick?.why ?? g?.why ?? null, // may be object or string
  };
}

/* =============================
   WHY NORMALIZATION (OBJECT ONLY)
============================= */

function makeWhyObjectFromString(s) {
  const text = String(s || "").trim();
  if (!text) return null;
  // keep headline short-ish so UI looks premium
  const headline = text.length > 80 ? `${text.slice(0, 77)}…` : text;
  return { headline, bullets: [text], deltas: [] };
}

function buildFallbackWhy({ matchup, pickSide, winProb, underdogWin, edge }) {
  const p = pickSide ? String(pickSide).toUpperCase() : "—";
  const wp = winProb != null ? `${(Number(winProb) * 100).toFixed(1)}%` : "—";
  const uw = underdogWin != null ? `${(Number(underdogWin) * 100).toFixed(1)}%` : "—";
  const ed = edge != null && Number.isFinite(Number(edge)) ? Number(edge).toFixed(3) : "—";

  return {
    headline: "Upset candidate",
    bullets: [
      `Matchup: ${matchup}`,
      `Model pick: ${p} (win ${wp})`,
      `Underdog win estimate: ${uw}`,
      `Edge: ${ed}`,
    ],
    deltas: [],
  };
}

function normalizeWhyObject(upstreamWhy, fallbackArgs) {
  if (upstreamWhy && typeof upstreamWhy === "object") {
    // already shaped — just ensure minimal fields
    return {
      headline: upstreamWhy.headline || "Model rationale",
      bullets: safeArr(upstreamWhy.bullets),
      deltas: safeArr(upstreamWhy.deltas),
    };
  }
  if (typeof upstreamWhy === "string") {
    const o = makeWhyObjectFromString(upstreamWhy);
    if (o) return o;
  }
  return buildFallbackWhy(fallbackArgs);
}

/* =============================
   ROUTE
============================= */

router.get("/", async (req, res) => {
  const t0 = Date.now();

  const league = String(req.query.league || "nba").toLowerCase();
  const date = normalizeDate(req.query.date);
  const minWin = Math.max(0, Math.min(0.99, Number(req.query.minWin ?? 0.2)));
  const limit = Math.max(1, Math.min(50, Number(req.query.limit ?? 20)));

  try {
    const base = `http://127.0.0.1:${process.env.PORT || 3001}`;
    const r = await fetch(`${base}/api/predictions?league=${league}&date=${date}`);
    const payload = await r.json();

    const games = safeArr(payload?.games);
    const source = payload?.meta?.source || "predictions";

    const rows = [];

    for (const g of games) {
      const home = normalizeTeam(league, g.home || g.homeTeam);
      const away = normalizeTeam(league, g.away || g.awayTeam);

      const matchup = g?.matchup || `${away.abbr || away.name} @ ${home.abbr || home.name}`;

      const { pickSide, winProb, edge, why: upstreamWhy } = extractPick(g);
      if (!pickSide || winProb == null) continue;

      const underdogWin = 1 - Number(winProb);
      if (underdogWin < minWin) continue;

      const whyObj = normalizeWhyObject(upstreamWhy, {
        matchup,
        pickSide,
        winProb,
        underdogWin,
        edge,
      });

      rows.push({
        id: g.gameId || `${league}-${date}-${matchup}`,
        league,
        date,
        matchup,
        home,
        away,
        winProb: Number(underdogWin.toFixed(4)),
        pick: {
          pickSide,
          winProb: Number(winProb),
          edge: edge != null ? Number(edge) : null,
          // keep pick.why object if upstream provided object; if it was a string, wrap it
          why: upstreamWhy
            ? (typeof upstreamWhy === "object"
                ? {
                    headline: upstreamWhy.headline || "Model rationale",
                    bullets: safeArr(upstreamWhy.bullets),
                    deltas: safeArr(upstreamWhy.deltas),
                  }
                : makeWhyObjectFromString(upstreamWhy))
            : null,
        },
        why: whyObj, // ✅ ALWAYS OBJECT
        signals: {
          usedModelWinProb: true,
          source,
        },
      });
    }

    rows.sort((a, b) => (b.winProb || 0) - (a.winProb || 0));

    return res.json({
      ok: true,
      count: rows.length,
      rows: rows.slice(0, limit),
      meta: {
        source,
        slateGames: games.length,
        minWinUsed: minWin,
        limitUsed: limit,
        elapsedMs: Date.now() - t0,
        version: "upsets-v11-why-object-no-import",
      },
      error: null,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      count: 0,
      rows: [],
      meta: {
        source: null,
        slateGames: 0,
        minWinUsed: minWin,
        limitUsed: limit,
        elapsedMs: Date.now() - t0,
        version: "upsets-v11-why-object-no-import",
      },
      error: String(e?.message || e),
    });
  }
});

export default router;
