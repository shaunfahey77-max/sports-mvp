/**
 * Regression guard: MLB Phase 0.75D foundation must remain hidden from
 * the Official-pick public surface. The `/picks`, `/performance`, and
 * `/performance/history` endpoints must continue to default to NBA +
 * NHL only.
 *
 * Task #8 carve-out: `/picks/candidates` opens an allowlist for
 * Model-Watch-only markets (mlb_moneyline) so they appear on the Model
 * Watch slot but never enter scored_picks / Performance / History.
 * The DEFAULT_PRODUCTION_LEAGUES constant must still exclude mlb.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

function readFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

test("routes/picks: DEFAULT_PRODUCTION_LEAGUES is exactly nba + nhl", () => {
  const src = readFile("routes/picks.ts");
  const match = src.match(
    /const\s+DEFAULT_PRODUCTION_LEAGUES\s*=\s*\[([^\]]+)\]\s*as\s+const/
  );
  assert.ok(match, "DEFAULT_PRODUCTION_LEAGUES declaration not found");
  const list = match![1].replace(/\s+/g, "");
  assert.equal(list, '"nba","nhl"', "production leagues must remain nba + nhl only");
});

test("routes/picks: any mlb reference is confined to the Model-Watch carve-out", () => {
  // Task #8 allows mlb_moneyline to surface on /picks/candidates as a
  // Model-Watch-only market. The only acceptable mlb reference in
  // routes/picks.ts is inside MODEL_WATCH_ONLY_CANDIDATE_PAIRS (or a
  // comment about it). Anything else risks promoting MLB into Official
  // picks and must be reviewed.
  const src = readFile("routes/picks.ts");
  const lines = src.split("\n");
  for (const [i, line] of lines.entries()) {
    if (!line.includes('"mlb"') && !line.includes("'mlb'")) continue;
    const ok =
      line.includes("MODEL_WATCH_ONLY_CANDIDATE_PAIRS") ||
      line.includes("model-watch") ||
      line.includes("Model-Watch") ||
      line.includes("model_watch_only") ||
      line.trim().startsWith("//") ||
      line.trim().startsWith("*");
    // Look back a few lines for the const declaration / comment context.
    const window = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
    const inWatchBlock = window.includes("MODEL_WATCH_ONLY_CANDIDATE_PAIRS");
    assert.ok(
      ok || inWatchBlock,
      `routes/picks.ts line ${i + 1} references mlb outside the Model-Watch carve-out: ${line}`
    );
  }
});

test("routes/performance: DEFAULT_PRODUCTION_LEAGUES is exactly nba + nhl", () => {
  const src = readFile("routes/performance.ts");
  const match = src.match(
    /const\s+DEFAULT_PRODUCTION_LEAGUES\s*=\s*\[([^\]]+)\]\s*as\s+const/
  );
  assert.ok(match, "DEFAULT_PRODUCTION_LEAGUES declaration not found");
  const list = match![1].replace(/\s+/g, "");
  assert.equal(list, '"nba","nhl"', "performance leagues must remain nba + nhl only");
  assert.ok(!src.includes('"mlb"'), "routes/performance.ts must not reference mlb in defaults");
});
