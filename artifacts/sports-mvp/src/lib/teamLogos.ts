const NBA_LOGOS: Record<string, string> = {
  bos: 'bos', atl: 'atl', bkn: 'bkn', cha: 'cha', chi: 'chi',
  cle: 'cle', dal: 'dal', den: 'den', det: 'det', gsw: 'gs',
  gs: 'gs', hou: 'hou', ind: 'ind', lac: 'lac', lal: 'lal',
  mem: 'mem', mia: 'mia', mil: 'mil', min: 'min', nop: 'no',
  no: 'no', nyk: 'ny', nyc: 'ny', ny: 'ny', okc: 'okc',
  orl: 'orl', phi: 'phi', phx: 'phx', por: 'por', sac: 'sac',
  sas: 'sa', sa: 'sa', tor: 'tor', uta: 'utah', utah: 'utah',
  was: 'wsh', wsh: 'wsh',
};

const NHL_LOGOS: Record<string, string> = {
  ana: 'ana', ari: 'ari', phx: 'ari', bos: 'bos', buf: 'buf',
  cgy: 'cgy', car: 'car', chi: 'chi', col: 'col', cbj: 'cbj',
  dal: 'dal', det: 'det', edm: 'edm', fla: 'fla', lak: 'lak',
  la: 'lak', min: 'min', mtl: 'mtl', nsh: 'nsh', njo: 'njd',
  njd: 'njd', nyi: 'nyi', nyr: 'nyr', ny: 'nyr', ott: 'ott',
  phi: 'phi', pit: 'pit', sjs: 'sjs', sj: 'sjs', sea: 'sea',
  stl: 'stl', tbl: 'tb', tb: 'tb', tor: 'tor', van: 'van',
  vgk: 'vgk', lv: 'vgk', wsh: 'wsh', was: 'wsh', wpg: 'wpg',
};

const NCAAM_LOGOS: Record<string, string> = {
  unc: '153', duke: '150', ky: '96', uk: '96', hou: '248',
  ala: '333', gonzaga: '2250', gonz: '2250', pur: '2509',
  kan: '2305', ku: '2305', vil: '222', nova: '222',
  conn: '41', uconn: '41', ark: '8', ind: '84', iu: '84',
  lou: '97', mich: '130', osu: '194', syr: '183',
  vill: '222', mem: '235', tx: '251', texas: '251',
  aub: '2', byu: '252', marq: '269', xavier: '2752',
};

export function getTeamLogoUrl(league: string, abbrev: string): string | null {
  const key = abbrev.toLowerCase();
  const lg = league.toLowerCase();

  if (lg === 'nba') {
    const espn = NBA_LOGOS[key];
    return espn ? `https://a.espncdn.com/i/teamlogos/nba/500/${espn}.png` : null;
  }
  if (lg === 'nhl') {
    const espn = NHL_LOGOS[key];
    return espn ? `https://a.espncdn.com/i/teamlogos/nhl/500/${espn}.png` : null;
  }
  if (lg === 'ncaam') {
    const id = NCAAM_LOGOS[key];
    return id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png` : null;
  }
  return null;
}

export function getLeagueLogoUrl(league: string): string {
  switch (league.toLowerCase()) {
    case 'nba': return 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png';
    case 'nhl': return 'https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png';
    case 'ncaam': return 'https://a.espncdn.com/i/teamlogos/leagues/500/mens-college-basketball.png';
    default: return '';
  }
}

export interface ParsedMatchup {
  awayAbbrev: string;
  homeAbbrev: string;
  awayLogo: string | null;
  homeLogo: string | null;
}

export function parseGameMatchup(gameKey: string, league: string): ParsedMatchup | null {
  const parts = gameKey.split('_');
  if (parts.length < 4) return null;
  const home = parts[parts.length - 1];
  const away = parts[parts.length - 2];
  if (!/^[a-z0-9]{2,7}$/.test(away) || !/^[a-z0-9]{2,7}$/.test(home)) return null;
  if (/^\d+$/.test(away) || /^\d+$/.test(home)) return null;
  return {
    awayAbbrev: away.toUpperCase(),
    homeAbbrev: home.toUpperCase(),
    awayLogo: getTeamLogoUrl(league, away),
    homeLogo: getTeamLogoUrl(league, home),
  };
}
