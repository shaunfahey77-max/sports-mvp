import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const file = path.join(process.cwd(), "data", "performance-cache.json");

    if (!fs.existsSync(file)) {
      return res.status(404).json({
        ok: false,
        error: "performance cache not found"
      });
    }

    const json = JSON.parse(fs.readFileSync(file, "utf-8"));

    res.json({
      ok: true,
      generatedAt: json.generatedAt || null,
      windows: json.windows || {}
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: "failed to read performance cache"
    });
  }
});

export default router;
