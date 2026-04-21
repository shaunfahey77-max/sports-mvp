/**
 * Regression guard: MLB Phase 0.75D foundation must remain hidden from
 * the public surface. Until post-tuning evidence approves a ship, the
 * `/picks`, `/picks/candidates`, `/performance`, and `/performance/history`
 * endpoints must continue to default to NBA + NHL only.
 *
 * If a future change adds "mlb" to the default production leagues list
 * by mistake, this test fails loudly so the gating is reconsidered
 * intentionally rather than silently regressed.
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
  assert.ok(!src.includes('"mlb"'), "routes/picks.ts must not reference mlb in defaults");
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
