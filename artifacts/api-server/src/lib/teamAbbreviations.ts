export interface TeamInfo {
  abbrev: string;
  name: string;
}

export const NBA_TEAM_ABBREVS: Record<string, string> = {
  'Atlanta Hawks': 'atl',
  'Boston Celtics': 'bos',
  'Brooklyn Nets': 'bkn',
  'Charlotte Hornets': 'cha',
  'Chicago Bulls': 'chi',
  'Cleveland Cavaliers': 'cle',
  'Dallas Mavericks': 'dal',
  'Denver Nuggets': 'den',
  'Detroit Pistons': 'det',
  'Golden State Warriors': 'gsw',
  'Houston Rockets': 'hou',
  'Indiana Pacers': 'ind',
  'Los Angeles Clippers': 'lac',
  'LA Clippers': 'lac',
  'Los Angeles Lakers': 'lal',
  'LA Lakers': 'lal',
  'Memphis Grizzlies': 'mem',
  'Miami Heat': 'mia',
  'Milwaukee Bucks': 'mil',
  'Minnesota Timberwolves': 'min',
  'New Orleans Pelicans': 'nop',
  'New York Knicks': 'nyc',
  'Oklahoma City Thunder': 'okc',
  'Orlando Magic': 'orl',
  'Philadelphia 76ers': 'phi',
  'Phoenix Suns': 'phx',
  'Portland Trail Blazers': 'por',
  'Sacramento Kings': 'sac',
  'San Antonio Spurs': 'sas',
  'Toronto Raptors': 'tor',
  'Utah Jazz': 'uta',
  'Washington Wizards': 'was',
};

export const NHL_TEAM_ABBREVS: Record<string, string> = {
  'Anaheim Ducks': 'ana',
  'Arizona Coyotes': 'ari',
  'Utah Hockey Club': 'uta',
  'Boston Bruins': 'bos',
  'Buffalo Sabres': 'buf',
  'Calgary Flames': 'cgy',
  'Carolina Hurricanes': 'car',
  'Chicago Blackhawks': 'chi',
  'Colorado Avalanche': 'col',
  'Columbus Blue Jackets': 'cbj',
  'Dallas Stars': 'dal',
  'Detroit Red Wings': 'det',
  'Edmonton Oilers': 'edm',
  'Florida Panthers': 'fla',
  'Los Angeles Kings': 'lak',
  'Minnesota Wild': 'min',
  'Montreal Canadiens': 'mtl',
  'Nashville Predators': 'nsh',
  'New Jersey Devils': 'njd',
  'New York Islanders': 'nyi',
  'New York Rangers': 'nyr',
  'Ottawa Senators': 'ott',
  'Philadelphia Flyers': 'phi',
  'Pittsburgh Penguins': 'pit',
  'San Jose Sharks': 'sjs',
  'Seattle Kraken': 'sea',
  'St. Louis Blues': 'stl',
  'Tampa Bay Lightning': 'tbl',
  'Toronto Maple Leafs': 'tor',
  'Vancouver Canucks': 'van',
  'Vegas Golden Knights': 'vgk',
  'Washington Capitals': 'wsh',
  'Winnipeg Jets': 'wpg',
};

export function getTeamAbbrev(teamName: string, league: string): string {
  const map = league === 'nba' ? NBA_TEAM_ABBREVS : NHL_TEAM_ABBREVS;
  const found = map[teamName];
  if (found) return found;
  // Fuzzy: first word, lowercased, max 4 chars
  const word = teamName.split(' ').pop() ?? teamName;
  return word.toLowerCase().slice(0, 4);
}

// Full team lists for synthetic data generation
export const NBA_TEAMS: TeamInfo[] = Object.entries(NBA_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
export const NHL_TEAMS: TeamInfo[] = Object.entries(NHL_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
