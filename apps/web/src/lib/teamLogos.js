// apps/web/src/lib/teamLogos.js

/* =========================================================
   Premium Multi-League Logo Resolver (NBA + NCAAM + NHL)

   Goals:
   - Always prefer API-provided team.logo when present.
   - NBA: deterministic CDN mapping by team ID.
   - NCAAM: ESPN logo is typically provided by API (confirmed in your curl).
   - NHL: use NHL assets CDN with correct filename suffix:
       /logos/nhl/svg/{ABBR}_light.svg  (and _dark.svg fallback)
   - Never throw; return null when unknown so UI can show fallback.
   ========================================================= */

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

function cleanAbbr(x) {
  const a = String(x || "").toUpperCase().trim();
  return a || null;
}

export function nbaLogoFromAbbr(abbr) {
  const a = cleanAbbr(abbr);
  if (!a) return null;
  const id = NBA_ID_BY_ABBR[a];
  if (!id) return null;
  return `https://cdn.nba.com/logos/nba/${id}/global/L/logo.svg`;
}

/**
 * NHL logos:
 * - BOS_light.svg is the correct pattern (BOS.svg 404s)
 * - We return the light variant by default; UI can choose dark if needed.
 */
export function nhlLogoFromAbbr(abbr, variant = "light") {
  const a = cleanAbbr(abbr);
  if (!a) return null;

  const v = String(variant || "light").toLowerCase() === "dark" ? "dark" : "light";
  return `https://assets.nhle.com/logos/nhl/svg/${a}_${v}.svg`;
}

/**
 * Extract abbreviation from various shapes.
 * teamish can be:
 * - object: { id, abbr, abbreviation, code, name, shortName, displayName, logo }
 * - string: "nba-cle" / "nhl-bos" / "ncaam-duke" / "CLE" / "BOS" / "DUKE"
 */
function abbrFromAnything(teamish, league) {
  if (!teamish) return null;

  // String inputs
  if (typeof teamish === "string") {
    const s = teamish.trim();
    const lower = s.toLowerCase();

    if (lower.startsWith("nba-")) return cleanAbbr(s.slice(4));
    if (lower.startsWith("nhl-")) return cleanAbbr(s.slice(4));
    if (lower.startsWith("ncaam-")) return cleanAbbr(s.slice(6));

    if (/^[A-Za-z]{2,6}$/.test(s)) return cleanAbbr(s);
    return null;
  }

  // Object inputs
  const idStr = teamish.id != null ? String(teamish.id) : "";
  const idLower = idStr.toLowerCase();

  // Explicit abbr-ish fields
  const direct =
    teamish.abbr ||
    teamish.abbreviation ||
    teamish.code ||
    teamish.triCode || // sometimes used
    null;

  if (direct && /^[A-Za-z]{2,6}$/.test(String(direct).trim())) {
    return cleanAbbr(direct);
  }

  // id-based extraction (league-aware)
  if (league === "nba" && idLower.startsWith("nba-")) return cleanAbbr(idStr.slice(4));
  if (league === "nhl" && idLower.startsWith("nhl-")) return cleanAbbr(idStr.slice(4));
  if (league === "ncaam" && idLower.startsWith("ncaam-")) return cleanAbbr(idStr.slice(6));

  // Sometimes name fields are already abbreviations
  const n =
    teamish.name ||
    teamish.shortName ||
    teamish.displayName ||
    null;

  if (n && /^[A-Za-z]{2,6}$/.test(String(n).trim())) return cleanAbbr(n);

  return null;
}

/**
 * Main UI helper:
 * - Prefer API-provided team.logo always.
 * - NBA => compute from abbr map.
 * - NHL => compute from NHL assets CDN (_light.svg default).
 * - NCAAM => typically uses ESPN team.logo provided by API; if missing, return null.
 *
 * Optional opts:
 * - opts.nhlVariant: "light" | "dark"
 */
export function getTeamLogo(league, team, opts = {}) {
  const l = String(league || "").toLowerCase();

  // Prefer API-provided logo
  if (team && typeof team === "object" && team.logo) return team.logo;

  if (l === "nba") {
    const abbr = abbrFromAnything(team, "nba");
    return nbaLogoFromAbbr(abbr);
  }

  if (l === "nhl") {
    const abbr = abbrFromAnything(team, "nhl");
    // default to light logos (better on dark UI)
    return nhlLogoFromAbbr(abbr, opts.nhlVariant || "light");
  }

  // NCAAM: rely on ESPN-provided logos in API payload
  // (You already confirmed .games[0].home.logo exists)
  return null;
}

/**
 * Optional helper:
 * If your UI wants both NHL variants (for theme switching), you can use this.
 */
export function getNhlLogoVariants(team) {
  const abbr = abbrFromAnything(team, "nhl");
  return {
    light: nhlLogoFromAbbr(abbr, "light"),
    dark: nhlLogoFromAbbr(abbr, "dark"),
  };
}