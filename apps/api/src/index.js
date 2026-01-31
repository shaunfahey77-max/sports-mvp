import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
app.get("/api/teams", (req, res) => {
  res.json([
    { id: 1, name: "Boston Celtics", city: "Boston" },
    { id: 2, name: "Los Angeles Lakers", city: "Los Angeles" },
    { id: 3, name: "Golden State Warriors", city: "San Francisco" },
  ]);
});
