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

// NCAAF (FBS) team abbreviations — Phase 0.75F + NCAAF spread model build.
// Branch only, hidden from public surface, NCAAF still gated via
// MARKET_DISABLED.* and NOT in cron LEAGUES.
//
// Why a full deterministic map (not fuzzy fallback):
//   College football has ~134 FBS teams. The fuzzy fallback (last word,
//   4 chars) generates massive collisions: Ohio State / Oklahoma State /
//   Oregon State all → "stat"; "Miami Hurricanes" / "Miami (OH) RedHawks"
//   both → "ane"/"awks"; "Texas" vs "Texas A&M" vs "Texas State" vs
//   "Texas Tech" all → "exas"/"&m"/"tate"/"tech" inconsistently.
//   The eventual NCAAF backtest harness needs stable, collision-free
//   team identifiers, so we maintain explicit entries for every FBS
//   school plus common alias variants.
//
// Codes are NOT standardized to any one source (CFBR/ESPN/247) because
// none of them are collision-free across the FBS landscape on their own.
// Codes are chosen to be (a) unique within ncaaf, (b) human-readable,
// (c) stable across seasons (don't include conference). Length 3-5.
// Collision-uniqueness is enforced at module load by `assertNoAbbrevCollisions`.
//
// Aliases: a single canonical Odds-API name maps to a code; a sibling
// `NCAAF_TEAM_ALIASES` map handles common short forms ("Ohio St" →
// "Ohio State Buckeyes") so multiple input strings normalize to the
// same code. The Odds API typically returns canonical names already.
export const NCAAF_TEAM_ABBREVS: Record<string, string> = {
  // SEC
  'Alabama Crimson Tide': 'ala',
  'Arkansas Razorbacks': 'ark',
  'Auburn Tigers': 'aub',
  'Florida Gators': 'fla',
  'Georgia Bulldogs': 'uga',
  'Kentucky Wildcats': 'uk',
  'LSU Tigers': 'lsu',
  'Mississippi State Bulldogs': 'msst',
  'Missouri Tigers': 'mizz',
  'Oklahoma Sooners': 'okla',
  'Ole Miss Rebels': 'olem',
  'South Carolina Gamecocks': 'scar',
  'Tennessee Volunteers': 'tenn',
  'Texas Longhorns': 'tex',
  'Texas A&M Aggies': 'tamu',
  'Vanderbilt Commodores': 'vand',
  // Big Ten
  'Illinois Fighting Illini': 'ill',
  'Indiana Hoosiers': 'ind',
  'Iowa Hawkeyes': 'iowa',
  'Maryland Terrapins': 'umd',
  'Michigan Wolverines': 'mich',
  'Michigan State Spartans': 'mist',
  'Minnesota Golden Gophers': 'minn',
  'Nebraska Cornhuskers': 'neb',
  'Northwestern Wildcats': 'nwu',
  'Ohio State Buckeyes': 'ohst',
  'Oregon Ducks': 'ore',
  'Penn State Nittany Lions': 'psu',
  'Purdue Boilermakers': 'pur',
  'Rutgers Scarlet Knights': 'rutg',
  'UCLA Bruins': 'ucla',
  'USC Trojans': 'usc',
  'Washington Huskies': 'wash',
  'Wisconsin Badgers': 'wis',
  // ACC
  'Boston College Eagles': 'bc',
  'California Golden Bears': 'cal',
  'Clemson Tigers': 'clem',
  'Duke Blue Devils': 'duke',
  'Florida State Seminoles': 'fsu',
  'Georgia Tech Yellow Jackets': 'gt',
  'Louisville Cardinals': 'lou',
  'Miami Hurricanes': 'mia',
  'NC State Wolfpack': 'ncst',
  'North Carolina Tar Heels': 'unc',
  'Notre Dame Fighting Irish': 'nd',
  'Pittsburgh Panthers': 'pitt',
  'SMU Mustangs': 'smu',
  'Stanford Cardinal': 'stan',
  'Syracuse Orange': 'syr',
  'Virginia Cavaliers': 'uva',
  'Virginia Tech Hokies': 'vt',
  'Wake Forest Demon Deacons': 'wake',
  // Big 12
  'Arizona Wildcats': 'ariz',
  'Arizona State Sun Devils': 'asu',
  'Baylor Bears': 'bay',
  'BYU Cougars': 'byu',
  'Cincinnati Bearcats': 'cin',
  'Colorado Buffaloes': 'colo',
  'Houston Cougars': 'hou',
  'Iowa State Cyclones': 'isu',
  'Kansas Jayhawks': 'ku',
  'Kansas State Wildcats': 'ksst',
  'Oklahoma State Cowboys': 'okst',
  'TCU Horned Frogs': 'tcu',
  'Texas Tech Red Raiders': 'tt',
  'UCF Knights': 'ucf',
  'Utah Utes': 'utah',
  'West Virginia Mountaineers': 'wvu',
  // Pac-12 (post-realignment remainders)
  'Oregon State Beavers': 'orst',
  'Washington State Cougars': 'wsu',
  // American Athletic (AAC)
  'Army Black Knights': 'army',
  'Charlotte 49ers': 'char',
  'East Carolina Pirates': 'ecu',
  'Florida Atlantic Owls': 'fau',
  'Memphis Tigers': 'mem',
  'Navy Midshipmen': 'navy',
  'North Texas Mean Green': 'unt',
  'Rice Owls': 'rice',
  'South Florida Bulls': 'usf',
  'Temple Owls': 'temp',
  'Tulane Green Wave': 'tul',
  'Tulsa Golden Hurricane': 'tlsa',
  'UAB Blazers': 'uab',
  'UTSA Roadrunners': 'utsa',
  // Conference USA
  'Delaware Fightin Blue Hens': 'del',
  'FIU Panthers': 'fiu',
  'Jacksonville State Gamecocks': 'jvst',
  'Kennesaw State Owls': 'ksu',
  'Liberty Flames': 'lib',
  'Louisiana Tech Bulldogs': 'latc',
  'Middle Tennessee Blue Raiders': 'mtsu',
  'Missouri State Bears': 'most',
  'New Mexico State Aggies': 'nmst',
  'Sam Houston Bearkats': 'sam',
  'UTEP Miners': 'utep',
  'Western Kentucky Hilltoppers': 'wku',
  // MAC
  'Akron Zips': 'akr',
  'Ball State Cardinals': 'bsu',
  'Bowling Green Falcons': 'bgsu',
  'Buffalo Bulls': 'buff',
  'Central Michigan Chippewas': 'cmu',
  'Eastern Michigan Eagles': 'emu',
  'Kent State Golden Flashes': 'kent',
  'Massachusetts Minutemen': 'mass',
  'Miami (OH) RedHawks': 'mioh',
  'Northern Illinois Huskies': 'niu',
  'Ohio Bobcats': 'ohio',
  'Toledo Rockets': 'tol',
  'Western Michigan Broncos': 'wmu',
  // Mountain West
  'Air Force Falcons': 'af',
  'Boise State Broncos': 'bois',
  'Colorado State Rams': 'csu',
  'Fresno State Bulldogs': 'fres',
  'Hawaii Rainbow Warriors': 'haw',
  'Nevada Wolf Pack': 'nev',
  'New Mexico Lobos': 'unm',
  'San Diego State Aztecs': 'sdsu',
  'San Jose State Spartans': 'sjsu',
  'UNLV Rebels': 'unlv',
  'Utah State Aggies': 'usu',
  'Wyoming Cowboys': 'wyo',
  // Sun Belt
  'Appalachian State Mountaineers': 'app',
  'Arkansas State Red Wolves': 'arst',
  'Coastal Carolina Chanticleers': 'ccu',
  'Georgia Southern Eagles': 'gaso',
  'Georgia State Panthers': 'gast',
  'James Madison Dukes': 'jmu',
  'Louisiana Ragin Cajuns': 'ull',
  'Louisiana-Monroe Warhawks': 'ulm',
  'Marshall Thundering Herd': 'mars',
  'Old Dominion Monarchs': 'odu',
  'South Alabama Jaguars': 'usa',
  'Southern Miss Golden Eagles': 'sou',
  'Texas State Bobcats': 'txst',
  'Troy Trojans': 'troy',
  // Independents
  'UConn Huskies': 'uconn',
};

// Common short / alternate forms encountered in feeds and historical
// datasets. Each entry maps the alias to the canonical key in
// `NCAAF_TEAM_ABBREVS`. Keep canonical-only entries above; aliases
// here so the canonical map stays the source of truth for what FBS
// schools exist.
export const NCAAF_TEAM_ALIASES: Record<string, string> = {
  // SEC
  'Alabama': 'Alabama Crimson Tide',
  'Arkansas': 'Arkansas Razorbacks',
  'Auburn': 'Auburn Tigers',
  'Florida': 'Florida Gators',
  'Georgia': 'Georgia Bulldogs',
  'Kentucky': 'Kentucky Wildcats',
  'LSU': 'LSU Tigers',
  'Mississippi State': 'Mississippi State Bulldogs',
  'Miss State': 'Mississippi State Bulldogs',
  'Miss St': 'Mississippi State Bulldogs',
  'Missouri': 'Missouri Tigers',
  'Mizzou': 'Missouri Tigers',
  'Oklahoma': 'Oklahoma Sooners',
  'Ole Miss': 'Ole Miss Rebels',
  'Mississippi': 'Ole Miss Rebels',
  'South Carolina': 'South Carolina Gamecocks',
  'Tennessee': 'Tennessee Volunteers',
  'Texas': 'Texas Longhorns',
  'Texas A&M': 'Texas A&M Aggies',
  'Vanderbilt': 'Vanderbilt Commodores',
  // Big Ten
  'Illinois': 'Illinois Fighting Illini',
  'Indiana': 'Indiana Hoosiers',
  'Iowa': 'Iowa Hawkeyes',
  'Maryland': 'Maryland Terrapins',
  'Michigan': 'Michigan Wolverines',
  'Michigan State': 'Michigan State Spartans',
  'Mich State': 'Michigan State Spartans',
  'Mich St': 'Michigan State Spartans',
  'Minnesota': 'Minnesota Golden Gophers',
  'Nebraska': 'Nebraska Cornhuskers',
  'Northwestern': 'Northwestern Wildcats',
  'Ohio State': 'Ohio State Buckeyes',
  'Ohio St': 'Ohio State Buckeyes',
  'Oregon': 'Oregon Ducks',
  'Penn State': 'Penn State Nittany Lions',
  'Penn St': 'Penn State Nittany Lions',
  'Purdue': 'Purdue Boilermakers',
  'Rutgers': 'Rutgers Scarlet Knights',
  'UCLA': 'UCLA Bruins',
  'USC': 'USC Trojans',
  'Washington': 'Washington Huskies',
  'Wisconsin': 'Wisconsin Badgers',
  // ACC
  'Boston College': 'Boston College Eagles',
  'BC': 'Boston College Eagles',
  'California': 'California Golden Bears',
  'Cal': 'California Golden Bears',
  'Clemson': 'Clemson Tigers',
  'Duke': 'Duke Blue Devils',
  'Florida State': 'Florida State Seminoles',
  'Florida St': 'Florida State Seminoles',
  'FSU': 'Florida State Seminoles',
  'Georgia Tech': 'Georgia Tech Yellow Jackets',
  'Louisville': 'Louisville Cardinals',
  'Miami': 'Miami Hurricanes',
  'Miami (FL)': 'Miami Hurricanes',
  'Miami FL': 'Miami Hurricanes',
  'NC State': 'NC State Wolfpack',
  'North Carolina State': 'NC State Wolfpack',
  'North Carolina': 'North Carolina Tar Heels',
  'UNC': 'North Carolina Tar Heels',
  'Notre Dame': 'Notre Dame Fighting Irish',
  'Pittsburgh': 'Pittsburgh Panthers',
  'Pitt': 'Pittsburgh Panthers',
  'SMU': 'SMU Mustangs',
  'Stanford': 'Stanford Cardinal',
  'Syracuse': 'Syracuse Orange',
  'Virginia': 'Virginia Cavaliers',
  'Virginia Tech': 'Virginia Tech Hokies',
  'Wake Forest': 'Wake Forest Demon Deacons',
  // Big 12
  'Arizona': 'Arizona Wildcats',
  'Arizona State': 'Arizona State Sun Devils',
  'Arizona St': 'Arizona State Sun Devils',
  'ASU': 'Arizona State Sun Devils',
  'Baylor': 'Baylor Bears',
  'BYU': 'BYU Cougars',
  'Cincinnati': 'Cincinnati Bearcats',
  'Colorado': 'Colorado Buffaloes',
  'Houston': 'Houston Cougars',
  'Iowa State': 'Iowa State Cyclones',
  'Iowa St': 'Iowa State Cyclones',
  'Kansas': 'Kansas Jayhawks',
  'Kansas State': 'Kansas State Wildcats',
  'Kansas St': 'Kansas State Wildcats',
  'K-State': 'Kansas State Wildcats',
  'Oklahoma State': 'Oklahoma State Cowboys',
  'Oklahoma St': 'Oklahoma State Cowboys',
  'TCU': 'TCU Horned Frogs',
  'Texas Tech': 'Texas Tech Red Raiders',
  'UCF': 'UCF Knights',
  'Central Florida': 'UCF Knights',
  'Utah': 'Utah Utes',
  'West Virginia': 'West Virginia Mountaineers',
  'WVU': 'West Virginia Mountaineers',
  // Pac-12 remnants
  'Oregon State': 'Oregon State Beavers',
  'Oregon St': 'Oregon State Beavers',
  'Washington State': 'Washington State Cougars',
  'Washington St': 'Washington State Cougars',
  'WSU': 'Washington State Cougars',
  // AAC
  'Army': 'Army Black Knights',
  'Charlotte': 'Charlotte 49ers',
  'East Carolina': 'East Carolina Pirates',
  'ECU': 'East Carolina Pirates',
  'Florida Atlantic': 'Florida Atlantic Owls',
  'FAU': 'Florida Atlantic Owls',
  'Memphis': 'Memphis Tigers',
  'Navy': 'Navy Midshipmen',
  'North Texas': 'North Texas Mean Green',
  'Rice': 'Rice Owls',
  'South Florida': 'South Florida Bulls',
  'USF': 'South Florida Bulls',
  'Temple': 'Temple Owls',
  'Tulane': 'Tulane Green Wave',
  'Tulsa': 'Tulsa Golden Hurricane',
  'UAB': 'UAB Blazers',
  'Alabama-Birmingham': 'UAB Blazers',
  'UTSA': 'UTSA Roadrunners',
  // C-USA
  'Delaware': 'Delaware Fightin Blue Hens',
  'FIU': 'FIU Panthers',
  'Florida International': 'FIU Panthers',
  'Jacksonville State': 'Jacksonville State Gamecocks',
  'Jacksonville St': 'Jacksonville State Gamecocks',
  'Kennesaw State': 'Kennesaw State Owls',
  'Kennesaw St': 'Kennesaw State Owls',
  'Liberty': 'Liberty Flames',
  'Louisiana Tech': 'Louisiana Tech Bulldogs',
  'LA Tech': 'Louisiana Tech Bulldogs',
  'Middle Tennessee': 'Middle Tennessee Blue Raiders',
  'Middle Tennessee State': 'Middle Tennessee Blue Raiders',
  'MTSU': 'Middle Tennessee Blue Raiders',
  'Missouri State': 'Missouri State Bears',
  'New Mexico State': 'New Mexico State Aggies',
  'New Mexico St': 'New Mexico State Aggies',
  'Sam Houston': 'Sam Houston Bearkats',
  'Sam Houston State': 'Sam Houston Bearkats',
  'UTEP': 'UTEP Miners',
  'Texas-El Paso': 'UTEP Miners',
  'Western Kentucky': 'Western Kentucky Hilltoppers',
  'WKU': 'Western Kentucky Hilltoppers',
  // MAC
  'Akron': 'Akron Zips',
  'Ball State': 'Ball State Cardinals',
  'Ball St': 'Ball State Cardinals',
  'Bowling Green': 'Bowling Green Falcons',
  'Buffalo': 'Buffalo Bulls',
  'Central Michigan': 'Central Michigan Chippewas',
  'Cent Michigan': 'Central Michigan Chippewas',
  'Eastern Michigan': 'Eastern Michigan Eagles',
  'East Michigan': 'Eastern Michigan Eagles',
  'Kent State': 'Kent State Golden Flashes',
  'Kent St': 'Kent State Golden Flashes',
  'Massachusetts': 'Massachusetts Minutemen',
  'UMass': 'Massachusetts Minutemen',
  'Miami (OH)': 'Miami (OH) RedHawks',
  'Miami OH': 'Miami (OH) RedHawks',
  'Miami Ohio': 'Miami (OH) RedHawks',
  'Northern Illinois': 'Northern Illinois Huskies',
  'NIU': 'Northern Illinois Huskies',
  'Ohio': 'Ohio Bobcats',
  'Toledo': 'Toledo Rockets',
  'Western Michigan': 'Western Michigan Broncos',
  'West Michigan': 'Western Michigan Broncos',
  // Mountain West
  'Air Force': 'Air Force Falcons',
  'Boise State': 'Boise State Broncos',
  'Boise St': 'Boise State Broncos',
  'Colorado State': 'Colorado State Rams',
  'Colorado St': 'Colorado State Rams',
  'Fresno State': 'Fresno State Bulldogs',
  'Fresno St': 'Fresno State Bulldogs',
  'Hawaii': 'Hawaii Rainbow Warriors',
  "Hawai'i": 'Hawaii Rainbow Warriors',
  'Nevada': 'Nevada Wolf Pack',
  'New Mexico': 'New Mexico Lobos',
  'San Diego State': 'San Diego State Aztecs',
  'San Diego St': 'San Diego State Aztecs',
  'SDSU': 'San Diego State Aztecs',
  'San Jose State': 'San Jose State Spartans',
  'San Jose St': 'San Jose State Spartans',
  'SJSU': 'San Jose State Spartans',
  'UNLV': 'UNLV Rebels',
  'Utah State': 'Utah State Aggies',
  'Utah St': 'Utah State Aggies',
  'Wyoming': 'Wyoming Cowboys',
  // Sun Belt
  'Appalachian State': 'Appalachian State Mountaineers',
  'App State': 'Appalachian State Mountaineers',
  'Appalachian St': 'Appalachian State Mountaineers',
  'Arkansas State': 'Arkansas State Red Wolves',
  'Arkansas St': 'Arkansas State Red Wolves',
  'Coastal Carolina': 'Coastal Carolina Chanticleers',
  'Georgia Southern': 'Georgia Southern Eagles',
  'Georgia State': 'Georgia State Panthers',
  'Georgia St': 'Georgia State Panthers',
  'James Madison': 'James Madison Dukes',
  'JMU': 'James Madison Dukes',
  'Louisiana': 'Louisiana Ragin Cajuns',
  'Louisiana-Lafayette': 'Louisiana Ragin Cajuns',
  'UL Lafayette': 'Louisiana Ragin Cajuns',
  'Louisiana-Monroe': 'Louisiana-Monroe Warhawks',
  'UL Monroe': 'Louisiana-Monroe Warhawks',
  'ULM': 'Louisiana-Monroe Warhawks',
  'Marshall': 'Marshall Thundering Herd',
  'Old Dominion': 'Old Dominion Monarchs',
  'ODU': 'Old Dominion Monarchs',
  'South Alabama': 'South Alabama Jaguars',
  'Southern Miss': 'Southern Miss Golden Eagles',
  'Southern Mississippi': 'Southern Miss Golden Eagles',
  'Texas State': 'Texas State Bobcats',
  'Texas St': 'Texas State Bobcats',
  'Troy': 'Troy Trojans',
  // Independents
  'Connecticut': 'UConn Huskies',
  'UConn': 'UConn Huskies',

  // -----------------------------------------------------------------------
  // Feed-form aliases (Phase A normalization, 2026-04-21).
  //
  // Several FBS programs are stored under one canonical key in the abbrev
  // map (e.g. "Massachusetts Minutemen", "Louisiana-Monroe Warhawks") but
  // arrive from upstream feeds in a different full-form spelling
  // ("UMass Minutemen", "UL Monroe Warhawks"). Existing aliases above
  // cover the school-only short form ("UMass", "UL Monroe") but not the
  // school+nickname form, so the school+nickname strings fell through to
  // the fuzzy fallback in the 2025 NCAAF backtest. The entries below are
  // the exact strings observed in `.local/backtest-reports/ncaaf-2025.txt`
  // that map to FBS programs.
  //
  // Per the football redesign plan this is FBS-coverage repair only. We
  // explicitly do NOT add aliases for FCS opponents here — those games
  // are intended to be filtered out of the candidate set instead.
  'UMass Minutemen': 'Massachusetts Minutemen',
  'UL Monroe Warhawks': 'Louisiana-Monroe Warhawks',
  'Florida International Panthers': 'FIU Panthers',
  'Southern Mississippi Golden Eagles': 'Southern Miss Golden Eagles',
  'Delaware Blue Hens': 'Delaware Fightin Blue Hens',
  'Sam Houston State Bearkats': 'Sam Houston Bearkats',
};

const ABBREV_LOOKUP: Record<string, Record<string, string>> = {
  nba: NBA_TEAM_ABBREVS,
  nhl: NHL_TEAM_ABBREVS,
  mlb: MLB_TEAM_ABBREVS,
  nfl: NFL_TEAM_ABBREVS,
  ncaaf: NCAAF_TEAM_ABBREVS,
};

const ALIAS_LOOKUP: Record<string, Record<string, string>> = {
  ncaaf: NCAAF_TEAM_ALIASES,
};

/**
 * Collision-safety invariant: within a single league's abbreviation map,
 * no two distinct canonical team names may share the same abbrev. The
 * NCAAF map in particular is large enough that an accidental dup would
 * silently corrupt a backtest's per-team aggregations. Run at module load
 * so any regression fails fast.
 */
function assertNoAbbrevCollisions(
  leagueName: string,
  map: Record<string, string>
): void {
  const seen = new Map<string, string>();
  for (const [team, abbrev] of Object.entries(map)) {
    const prior = seen.get(abbrev);
    if (prior !== undefined && prior !== team) {
      throw new Error(
        `[teamAbbreviations] ${leagueName}: abbrev "${abbrev}" is shared by ` +
          `"${prior}" and "${team}". Codes must be unique within a league.`
      );
    }
    seen.set(abbrev, team);
  }
}

/**
 * Aliases must point at canonical names that exist in the abbrev map,
 * otherwise the alias is dead-weight and getTeamAbbrev would silently
 * fall through to fuzzy. Run at module load.
 */
function assertAliasesResolve(
  leagueName: string,
  abbrevMap: Record<string, string>,
  aliasMap: Record<string, string>
): void {
  for (const [alias, canonical] of Object.entries(aliasMap)) {
    if (!(canonical in abbrevMap)) {
      throw new Error(
        `[teamAbbreviations] ${leagueName}: alias "${alias}" points at ` +
          `unknown canonical "${canonical}". Add canonical to abbrev map ` +
          `or fix the alias.`
      );
    }
  }
}

// Collision check is enforced for ncaaf only because that map was built
// fresh with collision-safety as an explicit invariant (every FBS school
// must have a unique code so backtest per-team aggregations can't get
// silently corrupted). The legacy pro-league maps mix canonical entries
// with intentional name-aliases (e.g. "Los Angeles Clippers" and
// "LA Clippers" both → "lac"); enforcing the check there would break
// those aliases. If we ever extract those into a separate alias map
// using the ncaaf pattern, we can extend collision enforcement.
assertNoAbbrevCollisions('ncaaf', NCAAF_TEAM_ABBREVS);
assertAliasesResolve('ncaaf', NCAAF_TEAM_ABBREVS, NCAAF_TEAM_ALIASES);

/**
 * Resolution source for a team-name lookup. Exposed so that backtests and
 * normalization-coverage tests can assert deterministic resolution
 * (i.e. that no FBS team falls into the `'fuzzy'` bucket).
 *
 *   - 'canonical': exact match against the league's abbrev map.
 *   - 'alias':     resolved via the league's alias map (deterministic).
 *   - 'fuzzy':     last-resort heuristic ("last word, lowercased, max 4
 *                  chars"). Unsafe for NCAAF — collapses Ohio State /
 *                  Oklahoma State / Oregon State all to "stat".
 */
export type AbbrevSource = 'canonical' | 'alias' | 'fuzzy';

export interface ResolvedAbbrev {
  abbrev: string;
  source: AbbrevSource;
}

/**
 * Resolve a team name to an abbrev, returning both the code and the
 * resolution path. Prefer this over `getTeamAbbrev` whenever the caller
 * needs to enforce that fuzzy fallback never fires (e.g. backtest
 * harnesses, NCAAF normalization-coverage tests).
 *
 * The resolution order matches `getTeamAbbrev`'s historical behavior so
 * existing callers get identical abbrevs:
 *   1. Exact canonical match.
 *   2. Trim + canonical match.
 *   3. Alias map (with trim).
 *   4. Fuzzy fallback (warns once for ncaaf).
 */
export function resolveTeamAbbrev(
  teamName: string,
  league: string
): ResolvedAbbrev {
  const abbrevMap = ABBREV_LOOKUP[league] ?? NBA_TEAM_ABBREVS;
  const aliasMap = ALIAS_LOOKUP[league];

  // 1. Exact canonical match (the common case for Odds API responses).
  const direct = abbrevMap[teamName];
  if (direct) return { abbrev: direct, source: 'canonical' };

  // 2. Trim + canonical match. Handles whitespace from historical CSVs.
  const trimmed = teamName.trim();
  if (trimmed !== teamName) {
    const trimmedDirect = abbrevMap[trimmed];
    if (trimmedDirect) return { abbrev: trimmedDirect, source: 'canonical' };
  }

  // 3. Alias resolution. Handles "Ohio St" / "OSU" / "Miami (FL)" /
  //    feed-form variants like "UMass Minutemen" → "Massachusetts Minutemen".
  if (aliasMap) {
    const canonical = aliasMap[trimmed] ?? aliasMap[teamName];
    if (canonical) {
      const viaAlias = abbrevMap[canonical];
      if (viaAlias) return { abbrev: viaAlias, source: 'alias' };
    }
  }

  // 4. Last-resort fuzzy fallback. Retained for back-compat with leagues
  //    that don't maintain a full map (e.g. ncaam) and to avoid throwing
  //    on unknown inputs. For ncaaf this should never fire on FBS teams
  //    in production — it's a signal that an alias is missing.
  if (league === 'ncaaf') {
    // eslint-disable-next-line no-console
    console.warn(
      `[teamAbbreviations] ncaaf: no canonical match for "${teamName}", ` +
        `falling back to fuzzy. Add to NCAAF_TEAM_ABBREVS or NCAAF_TEAM_ALIASES.`
    );
  }
  const word = trimmed.split(' ').pop() ?? trimmed;
  return { abbrev: word.toLowerCase().slice(0, 4), source: 'fuzzy' };
}

export function getTeamAbbrev(teamName: string, league: string): string {
  return resolveTeamAbbrev(teamName, league).abbrev;
}

// Full team lists for synthetic data generation
export const NBA_TEAMS: TeamInfo[] = Object.entries(NBA_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
export const NHL_TEAMS: TeamInfo[] = Object.entries(NHL_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
export const MLB_TEAMS: TeamInfo[] = Object.entries(MLB_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
export const NFL_TEAMS: TeamInfo[] = Object.entries(NFL_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
export const NCAAF_TEAMS: TeamInfo[] = Object.entries(NCAAF_TEAM_ABBREVS).map(([name, abbrev]) => ({ name, abbrev }));
