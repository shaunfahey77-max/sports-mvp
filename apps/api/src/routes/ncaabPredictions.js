import express from "express";
const router = express.Router();

router.get("/", async (req, res) => {
  const { date } = req.query;

  // 1. Fetch games for date
  // 2. Attach prediction object to each game
  // 3. Return enriched games list

  res.json({
    date,
    games: []
  });
});

export default router;
