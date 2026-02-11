// apps/web/src/lib/teamLogos.js

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

export function nbaLogoFromAbbr(abbr) {
  const a = String(abbr || "").toUpperCase().trim();
  const id = NBA_ID_BY_ABBR[a];
  if (!id) return null;
  return `https://cdn.nba.com/logos/nba/${id}/global/L/logo.svg`;
}

export function getTeamLogo(league, team) {
  const l = String(league || "").toLowerCase();
  if (team?.logo) return team.logo;

  if (l === "nba") {
    const abbr =
      team?.abbr ||
      (team?.id && String(team.id).startsWith("nba-")
        ? String(team.id).slice(4).toUpperCase()
        : team?.name);

    return nbaLogoFromAbbr(abbr);
  }

  return null;
}
