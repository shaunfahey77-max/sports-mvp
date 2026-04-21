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

export const MLB_TEAM_ABBREVS: Record<string, string> = {
  'Arizona Diamondbacks': 'ari',
  'Atlanta Braves': 'atl',
  'Baltimore Orioles': 'bal',
  'Boston Red Sox': 'bos',
  'Chicago Cubs': 'chc',
  'Chicago White Sox': 'cws',
  'Cincinnati Reds': 'cin',
  'Cleveland Guardians': 'cle',
  'Colorado Rockies': 'col',
  'Detroit Tigers': 'det',
  'Houston Astros': 'hou',
  'Kansas City Royals': 'kc',
  'Los Angeles Angels': 'laa',
  'Los Angeles Dodgers': 'lad',
  'Miami Marlins': 'mia',
  'Milwaukee Brewers': 'mil',
  'Minnesota Twins': 'min',
  'New York Mets': 'nym',
  'New York Yankees': 'nyy',
  'Athletics': 'ath',
  'Oakland Athletics': 'oak',
  'Philadelphia Phillies': 'phi',
  'Pittsburgh Pirates': 'pit',
  'San Diego Padres': 'sd',
  'San Francisco Giants': 'sf',
  'Seattle Mariners': 'sea',
  'St. Louis Cardinals': 'stl',
  'Tampa Bay Rays': 'tb',
  'Texas Rangers': 'tex',
  'Toronto Blue Jays': 'tor',
  'Washington Nationals': 'wsh',
};

// NFL team abbreviations — Phase 0.75E foundation (branch only, no live ingest yet,
// hidden from public surface). All 32 franchises with current locations.
export const NFL_TEAM_ABBREVS: Record<string, string> = {
  'Buffalo Bills': 'buf',
  'Miami Dolphins': 'mia',
  'New England Patriots': 'ne',
  'New York Jets': 'nyj',
  'Baltimore Ravens': 'bal',
  'Cincinnati Bengals': 'cin',
  'Cleveland Browns': 'cle',
  'Pittsburgh Steelers': 'pit',
  'Houston Texans': 'hou',
  'Indianapolis Colts': 'ind',
  'Jacksonville Jaguars': 'jax',
  'Tennessee Titans': 'ten',
  'Denver Broncos': 'den',
  'Kansas City Chiefs': 'kc',
  'Las Vegas Raiders': 'lv',
  'Los Angeles Chargers': 'lac',
  'Dallas Cowboys': 'dal',
  'New York Giants': 'nyg',
  'Philadelphia Eagles': 'phi',
  'Washington Commanders': 'was',
  'Chicago Bears': 'chi',
  'Detroit Lions': 'det',
  'Green Bay Packers': 'gb',
  'Minnesota Vikings': 'min',
  'Atlanta Falcons': 'atl',
  'Carolina Panthers': 'car',
  'New Orleans Saints': 'no',
  'Tampa Bay Buccaneers': 'tb',
  'Arizona Cardinals': 'ari',
  'Los Angeles Rams': 'lar',
  'San Francisco 49ers': 'sf',
  'Seattle Seahawks': 'sea',
};

const ABBREV_LOOKUP: Record<string, Record<string, string>> = {
  nba: NBA_TEAM_ABBREVS,
  nhl: NHL_TEAM_ABBREVS,
  mlb: MLB_TEAM_ABBREVS,
  nfl: NFL_TEAM_ABBREVS,
};

export function getTeamAbbrev(teamName: string, league: string): string {
  const map = ABBREV_LOOKUP[league] ?? NBA_TEAM_ABBREVS;
  const found = map[teamName];
  if (found) return found;
  // Fuzzy: first word, lowercased, max 4 chars
  const word = teamName.split(' ').pop() ?? teamName;
  return word.toLowerCase().slice(0, 4);
}

// Full team lists for synthetic data generation
export const NBA_TEAMS: TeamInfo[] = Object.entries(NBA_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
export const NHL_TEAMS: TeamInfo[] = Object.entries(NHL_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
export const MLB_TEAMS: TeamInfo[] = Object.entries(MLB_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
export const NFL_TEAMS: TeamInfo[] = Object.entries(NFL_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
