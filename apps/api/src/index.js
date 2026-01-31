app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/teams", (req, res) => {
  res.json([
    { id: 1, name: "Boston Celtics", city: "Boston" },
    { id: 2, name: "Los Angeles Lakers", city: "Los Angeles" },
    { id: 3, name: "Golden State Warriors", city: "San Francisco" },
  ]);
});

app.get("/api/teams/:id", (req, res) => {
  const teams = [
    { id: 1, name: "Boston Celtics", city: "Boston" },
    { id: 2, name: "Los Angeles Lakers", city: "Los Angeles" },
    { id: 3, name: "Golden State Warriors", city: "San Francisco" },
  ];
  const teamId = Number(req.params.id);
  const team = teams.find((t) => t.id === teamId);
  if (!team) return res.status(404).json({ error: "Team not found" });
  res.json(team);
});
