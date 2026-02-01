import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// --- simple stub data (we'll replace with real feeds later) ---
const nbaTeams = [
  { id: "nba-bos", name: "Boston Celtics", city: "Boston", abbr: "BOS" },
  { id: "nba-lal", name: "Los Angeles Lakers", city: "Los Angeles", abbr: "LAL" },
  { id: "nba-gsw", name: "Golden State Warriors", city: "San Francisco", abbr: "GSW" },
  { id: "nba-nyk", name: "New York Knicks", city: "New York", abbr: "NYK" },
];

const nhlTeams = [
  { id: "nhl-bos", name: "Boston Bruins", city: "Boston", abbr: "BOS" },
  { id: "nhl-nyr", name: "New York Rangers", city: "New York", abbr: "NYR" },
  { id: "nhl-tor", name: "Toronto Maple Leafs", city: "Toronto", abbr: "TOR" },
  { id: "nhl-mtl", name: "Montreal Canadiens", city: "Montreal", abbr: "MTL" },
];

const nbaGames = [
  { id: "nba-001", date: "2026-02-01", homeTeamId: "nba-bos", awayTeamId: "nba-lal" },
  { id: "nba-002", date: "2026-02-01", homeTeamId: "nba-gsw", awayTeamId: "nba-nyk" },
  { id: "nba-003", date: "2026-02-02", homeTeamId: "nba-lal", awayTeamId: "nba-gsw" },
];

const nhlGames = [
  { id: "nhl-001", date: "2026-02-01", homeTeamId: "nhl-bos", awayTeamId: "nhl-nyr" },
  { id: "nhl-002", date: "2026-02-01", homeTeamId: "nhl-tor", awayTeamId: "nhl-mtl" },
  { id: "nhl-003", date: "2026-02-02", homeTeamId: "nhl-nyr", awayTeamId: "nhl-tor" },
];

// --- lookup maps for "expand=teams"
const nbaTeamById = Object.fromEntries(nbaTeams.map((t) => [t.id, t]));
const nhlTeamById = Object.fromEntries(nhlTeams.map((t) => [t.id, t]));

// --- routes ---
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "sports-mvp-api",
    time: new Date().toISOString(),
  });
});

app.get("/api/nba/teams", (_req, res) => res.json(nbaTeams));
app.get("/api/nhl/teams", (_req, res) => res.json(nhlTeams));

app.get("/api/nba/games", (req, res) => {
  const { date, expand } = req.query;

  let games = date ? nbaGames.filter((g) => g.date === date) : nbaGames;

  if (expand === "teams") {
    games = games.map((g) => ({
      ...g,
      homeTeam: nbaTeamById[g.homeTeamId] ?? null,
      awayTeam: nbaTeamById[g.awayTeamId] ?? null,
    }));
  }

  res.json(games);
});

app.get("/api/nhl/games", (req, res) => {
  const { date, expand } = req.query;

  let games = date ? nhlGames.filter((g) => g.date === date) : nhlGames;

  if (expand === "teams") {
    games = games.map((g) => ({
      ...g,
      homeTeam: nhlTeamById[g.homeTeamId] ?? null,
      awayTeam: nhlTeamById[g.awayTeamId] ?? null,
    }));
  }

  res.json(games);
});

app.listen(PORT, () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});
