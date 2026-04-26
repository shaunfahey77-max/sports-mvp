import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeBrierScore,
  computeBrierSkillScore,
} from "../brierScore";

test("Brier: empty input → null", () => {
  assert.equal(computeBrierScore([]), null);
});

test("Brier: perfect forecast → 0", () => {
  const score = computeBrierScore([
    { prob: 1, outcome: 1 },
    { prob: 0, outcome: 0 },
    { prob: 1, outcome: 1 },
  ]);
  assert.equal(score, 0);
});

test("Brier: worst-case forecast → 1", () => {
  const score = computeBrierScore([
    { prob: 0, outcome: 1 },
    { prob: 1, outcome: 0 },
  ]);
  assert.equal(score, 1);
});

test("Brier: 50/50 forecast on any binary outcomes → 0.25", () => {
  const score = computeBrierScore([
    { prob: 0.5, outcome: 1 },
    { prob: 0.5, outcome: 0 },
    { prob: 0.5, outcome: 1 },
    { prob: 0.5, outcome: 0 },
  ]);
  assert.equal(score, 0.25);
});

test("Brier: average of per-row squared errors", () => {
  // (0.7 - 1)^2 = 0.09 ; (0.4 - 0)^2 = 0.16 ; mean = 0.125
  const score = computeBrierScore([
    { prob: 0.7, outcome: 1 },
    { prob: 0.4, outcome: 0 },
  ]);
  assert.ok(score !== null);
  assert.ok(Math.abs(score - 0.125) < 1e-12);
});

test("Brier: silently skips out-of-range probabilities", () => {
  const score = computeBrierScore([
    { prob: 0.7, outcome: 1 },
    { prob: 1.5, outcome: 0 }, // skipped
    { prob: -0.1, outcome: 1 }, // skipped
    { prob: Number.NaN, outcome: 1 }, // skipped
    { prob: 0.4, outcome: 0 },
  ]);
  // Only first and last counted: mean of 0.09 and 0.16 = 0.125
  assert.ok(score !== null);
  assert.ok(Math.abs(score - 0.125) < 1e-12);
});

test("Brier: silently skips invalid outcomes", () => {
  const score = computeBrierScore([
    { prob: 0.5, outcome: 1 },
    // @ts-expect-error - intentionally testing runtime guard
    { prob: 0.5, outcome: 0.5 },
    // @ts-expect-error - intentionally testing runtime guard
    { prob: 0.5, outcome: "win" },
  ]);
  // Only first counted: (0.5 - 1)^2 = 0.25
  assert.equal(score, 0.25);
});

test("Brier: all-skipped input → null (not 0)", () => {
  const score = computeBrierScore([
    { prob: Number.NaN, outcome: 1 },
    { prob: -1, outcome: 0 },
  ]);
  assert.equal(score, null);
});

test("BrierSkillScore: model better than reference → positive", () => {
  // model brier 0.10, reference 0.20 → BSS = 1 - 0.5 = 0.5
  const bss = computeBrierSkillScore(0.1, 0.2);
  assert.ok(bss !== null);
  assert.ok(Math.abs(bss - 0.5) < 1e-12);
});

test("BrierSkillScore: model worse than reference → negative", () => {
  // model 0.30, reference 0.20 → BSS = 1 - 1.5 = -0.5
  const bss = computeBrierSkillScore(0.3, 0.2);
  assert.ok(bss !== null);
  assert.ok(Math.abs(bss - -0.5) < 1e-12);
});

test("BrierSkillScore: identical model and reference → 0", () => {
  const bss = computeBrierSkillScore(0.2, 0.2);
  assert.equal(bss, 0);
});

test("BrierSkillScore: returns null when either Brier is null", () => {
  assert.equal(computeBrierSkillScore(null, 0.2), null);
  assert.equal(computeBrierSkillScore(0.2, null), null);
  assert.equal(computeBrierSkillScore(null, null), null);
});

test("BrierSkillScore: returns null when reference Brier is exactly 0", () => {
  // Avoid division by zero — undefined improvement ratio.
  assert.equal(computeBrierSkillScore(0.1, 0), null);
});
