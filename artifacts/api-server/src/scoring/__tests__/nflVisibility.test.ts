/**
 * Regression guard: NFL Phase 0.75E foundation must remain hidden from
 * the public surface AND must not enter the live cron ingest loop until
 * a spread model exists and the project explicitly approves a flip.
 *
 * - DEFAULT_PRODUCTION_LEAGUES on /picks and /performance must stay
 *   nba + nhl only.
 * - cronService LEAGUES must NOT include "nfl" (would burn API credits
 *   hitting empty offseason endpoints and surface no value).
 * - All three NFL markets must remain in MARKET_DISABLED.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "..");

function readFile(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}

test("routes/picks: DEFAULT_PRODUCTION_LEAGUES does not include nfl", () => {
  const src = readFile("routes/picks.ts");
  const match = src.match(
    /const\s+DEFAULT_PRODUCTION_LEAGUES\s*=\s*\[([^\]]+)\]\s*as\s+const/
  );
  assert.ok(match, "DEFAULT_PRODUCTION_LEAGUES declaration not found");
  const list = match![1].replace(/\s+/g, "");
  assert.ok(!list.includes('"nfl"'), "routes/picks.ts must not surface nfl");
});

test("routes/performance: DEFAULT_PRODUCTION_LEAGUES does not include nfl", () => {
  const src = readFile("routes/performance.ts");
  const match = src.match(
    /const\s+DEFAULT_PRODUCTION_LEAGUES\s*=\s*\[([^\]]+)\]\s*as\s+const/
  );
  assert.ok(match, "DEFAULT_PRODUCTION_LEAGUES declaration not found");
  const list = match![1].replace(/\s+/g, "");
  assert.ok(!list.includes('"nfl"'), "routes/performance.ts must not surface nfl");
});

test("cronService LEAGUES does not include nfl yet", () => {
  const src = readFile("services/cronService.ts");
  const match = src.match(/const\s+LEAGUES[^=]*=\s*\[([^\]]+)\]/);
  assert.ok(match, "cronService LEAGUES declaration not found");
  const list = match![1].replace(/\s+/g, "");
  assert.ok(
    !list.includes('"nfl"'),
    "cronService LEAGUES must not include nfl until a model exists and the project approves the flip"
  );
});

test("MARKET_DISABLED keeps all three NFL markets gated", () => {
  const src = readFile("config/scoringModelConfig.ts");
  for (const key of ["nfl_spread", "nfl_moneyline", "nfl_total"]) {
    const re = new RegExp(`${key}\\s*:\\s*true`);
    assert.ok(re.test(src), `${key} must be present and set to true in MARKET_DISABLED`);
  }
});
