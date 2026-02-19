// legacy/apps/web/src/lib/teamLogos.js

// High-quality official NBA SVGs (cdn.nba.com) using stable franchise IDs.
const NBA_ID_BY_ABBR = {
  ATL: "1610612737",
  BOS: "1610612738",
  BKN: "1610612751",
  CHA: "1610612766",
  CHI: "1610612741",
  CLE: "1610612739",
  DAL: "1610612742",
  DEN: "1610612743",
  DET: "1610612765",
  GSW: "1610612744",
  HOU: "1610612745",
  IND: "1610612754",
  LAC: "1610612746",
  LAL: "1610612747",
  MEM: "1610612763",
  MIA: "1610612748",
  MIL: "1610612749",
  MIN: "1610612750",
  NOP: "1610612740",
  NYK: "1610612752",
  OKC: "1610612760",
  ORL: "1610612753",
  PHI: "1610612755",
  PHX: "1610612756",
  POR: "1610612757",
  SAC: "1610612758",
  SAS: "1610612759",
  TOR: "1610612761",
  UTA: "1610612762",
  WAS: "1610612764",
};

function normLeague(league) {
  const l = String(league || "").toLowerCase().trim();
  if (l === "nba") return "nba";
  if (l === "nhl") return "nhl";
  if (l === "ncaam") return "ncaam";
  return l || "nba";
}

function isLikelyAbbr(s) {
  const t = String(s || "").trim();
  return /^[A-Z]{2,4}$/.test(t);
}

function pickLogoFromTeamObj(team) {
  return (
    team?.logo ||
    team?.logos?.[0]?.href ||
    team?.team?.logo ||
    team?.team?.logos?.[0]?.href ||
    null
  );
}

function tailFromId(id) {
  const s = String(id || "").trim();
  if (!s) return null;
  const parts = s.split("-").filter(Boolean);
  const tail = parts.length ? parts[parts.length - 1] : null;
  if (!tail) return null;
  // allow 2-4 letter tails like "mil", "bos", "nyr"
  if (/^[a-z]{2,4}$/i.test(tail)) return tail.toUpperCase();
  return null;
}

function deriveAbbr(team) {
  if (!team) return null;

  const direct =
    team?.abbr ||
    team?.abbreviation ||
    team?.shortName ||
    team?.displayAbbreviation ||
    team?.code ||
    null;

  if (direct) return String(direct).trim().toUpperCase();

  const fromId = tailFromId(team?.id);
  if (fromId) return fromId;

  const name = String(team?.name || team?.displayName || "").trim();
  if (isLikelyAbbr(name)) return name.toUpperCase();

  return null;
}

// last resort: derive from "AWAY @ HOME"
function abbrFromMatchup(matchup, isHome) {
  const m = String(matchup || "").trim();
  if (!m.includes("@")) return null;

  const [awayRaw, homeRaw] = m.split("@").map((x) => String(x || "").trim());
  const token = isHome ? homeRaw : awayRaw;

  const first = token.split(/\s+/)[0]; // "NOP" from "NOP"
  if (isLikelyAbbr(first)) return first.toUpperCase();

  return null;
}

export function nbaLogoFromAbbr(abbr) {
  const a = String(abbr || "").toUpperCase().trim();
  const id = NBA_ID_BY_ABBR[a];
  if (!id) return null;
  return `https://cdn.nba.com/logos/nba/${id}/global/L/logo.svg`;
}

function espnCdnLogoByAbbr(league, abbr, size = 80) {
  const l = normLeague(league);
  const a = String(abbr || "").trim().toLowerCase();
  if (!a) return null;

  // ESPN "scoreboard" logos are consistent for NHL, decent for NBA/NCAAM.
  if (l === "nhl") {
    return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nhl/500/scoreboard/${a}.png&h=${size}&w=${size}`;
  }
  if (l === "nba") {
    return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/scoreboard/${a}.png&h=${size}&w=${size}`;
  }
  if (l === "ncaam") {
    return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/scoreboard/${a}.png&h=${size}&w=${size}`;
  }

  return null;
}

/**
 * getTeamLogo(league, team, opts?)
 *
 * opts:
 *  - matchup: "AWAY @ HOME" (optional; improves abbr derivation)
 *  - isHome: boolean (used with matchup)
 *  - size: number (ESPN combiner output size; default 80)
 */
export function getTeamLogo(league, team, opts = {}) {
  const l = normLeague(league);
  const size = Number(opts?.size || 80);
  const matchup = opts?.matchup || null;
  const isHome = Boolean(opts?.isHome);

  // 1) If backend already gave us a logo, use it.
  const direct = pickLogoFromTeamObj(team);
  if (direct) return direct;

  // 2) Derive abbr from team shape; fallback to matchup parsing.
  const abbr = deriveAbbr(team) || (matchup ? abbrFromMatchup(matchup, isHome) : null);

  // 3) League-specific best source.
  if (l === "nba") {
    // Prefer official NBA SVG when possible
    const nba = nbaLogoFromAbbr(abbr);
    if (nba) return nba;

    // fallback to ESPN if NBA map misses
    return espnCdnLogoByAbbr(l, abbr, size);
  }

  if (l === "nhl") {
    return espnCdnLogoByAbbr(l, abbr, size);
  }

  if (l === "ncaam") {
    return espnCdnLogoByAbbr(l, abbr, size);
  }

  return null;
}

/**
 * Convenience helper for a matchup row:
 * returns { awayLogo, homeLogo, awayAbbr, homeAbbr }
 */
export function getMatchupLogos(league, awayTeam, homeTeam, matchup, opts = {}) {
  const size = Number(opts?.size || 80);

  const awayAbbr = deriveAbbr(awayTeam) || abbrFromMatchup(matchup, false);
  const homeAbbr = deriveAbbr(homeTeam) || abbrFromMatchup(matchup, true);

  return {
    awayAbbr,
    homeAbbr,
    awayLogo: getTeamLogo(league, awayTeam, { matchup, isHome: false, size }),
    homeLogo: getTeamLogo(league, homeTeam, { matchup, isHome: true, size }),
  };
}
