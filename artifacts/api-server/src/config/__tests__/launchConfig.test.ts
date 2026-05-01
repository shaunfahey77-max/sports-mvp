import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isBetaMode,
  getBlockedTiersForNewCheckout,
  getLaunchConfigPayload,
  LAUNCH_PROMOTION_TRIGGER,
} from "../launchConfig";

/**
 * Unit tests for the single source of truth that gates the entire
 * Open-Beta posture (Task #46 → Task #49 test coverage).
 *
 * If any of these tests start failing because someone changed the
 * accepted truthy values or the blocked-tier set, that's the alarm
 * we want — paid checkout silently re-opening (or staying open after
 * an attempted flip-off) is the worst-case regression for this
 * subsystem and shipped quickly without these tests.
 *
 * The launchConfig module reads `process.env.BETA_MODE` per call
 * (no caching), so stubbing the env var per test is sufficient — no
 * module reload needed.
 */

const ORIGINAL_BETA_MODE = process.env.BETA_MODE;

beforeEach(() => {
  delete process.env.BETA_MODE;
});

afterEach(() => {
  if (ORIGINAL_BETA_MODE === undefined) {
    delete process.env.BETA_MODE;
  } else {
    process.env.BETA_MODE = ORIGINAL_BETA_MODE;
  }
});

// ─── isBetaMode() ──────────────────────────────────────────────────

test("isBetaMode: defaults to TRUE when BETA_MODE is unset (we launch INTO open beta)", () => {
  delete process.env.BETA_MODE;
  assert.equal(isBetaMode(), true);
});

test("isBetaMode: TRUE for canonical truthy values", () => {
  for (const v of ["true", "1", "on", "yes"]) {
    process.env.BETA_MODE = v;
    assert.equal(isBetaMode(), true, `expected true for "${v}"`);
  }
});

test("isBetaMode: TRUE for case-insensitive truthy values (TRUE, ON, Yes, etc.)", () => {
  for (const v of ["TRUE", "True", "ON", "On", "YES", "Yes"]) {
    process.env.BETA_MODE = v;
    assert.equal(isBetaMode(), true, `expected true for "${v}"`);
  }
});

test("isBetaMode: TRUE when value has surrounding whitespace ('  true  ')", () => {
  process.env.BETA_MODE = "  true  ";
  assert.equal(isBetaMode(), true);
});

test("isBetaMode: FALSE when explicitly set to 'false' (the canonical flip-off value)", () => {
  process.env.BETA_MODE = "false";
  assert.equal(isBetaMode(), false);
});

test("isBetaMode: FALSE for other falsy / unrecognized values ('0', 'off', 'no', 'random')", () => {
  for (const v of ["0", "off", "no", "random", "FALSE", "Off"]) {
    process.env.BETA_MODE = v;
    assert.equal(isBetaMode(), false, `expected false for "${v}"`);
  }
});

test("isBetaMode: FALSE when value is empty string (treats blank as 'not opted in')", () => {
  process.env.BETA_MODE = "";
  assert.equal(isBetaMode(), false);
});

// ─── getBlockedTiersForNewCheckout() ───────────────────────────────

test("getBlockedTiersForNewCheckout: in beta mode, BOTH 'mvp' and 'mvp_pro' are blocked", () => {
  process.env.BETA_MODE = "true";
  const blocked = getBlockedTiersForNewCheckout();
  assert.equal(blocked.has("mvp"), true, "mvp must be blocked in beta mode");
  assert.equal(blocked.has("mvp_pro"), true, "mvp_pro must always be blocked");
  assert.equal(
    blocked.size,
    2,
    "no other tiers should be blocked — only the documented two",
  );
});

test("getBlockedTiersForNewCheckout: in beta mode (default / unset env), 'mvp' is blocked", () => {
  delete process.env.BETA_MODE;
  const blocked = getBlockedTiersForNewCheckout();
  assert.equal(
    blocked.has("mvp"),
    true,
    "default posture is open-beta → mvp must be blocked even when env is unset",
  );
});

test("getBlockedTiersForNewCheckout: with BETA_MODE=false, ONLY the static 'mvp_pro' block remains", () => {
  process.env.BETA_MODE = "false";
  const blocked = getBlockedTiersForNewCheckout();
  assert.equal(
    blocked.has("mvp"),
    false,
    "mvp must be unblocked once paid acquisition resumes",
  );
  assert.equal(
    blocked.has("mvp_pro"),
    true,
    "mvp_pro is the retired Inner Circle — must stay statically blocked even after beta flips off",
  );
  assert.equal(
    blocked.size,
    1,
    "exactly one tier (mvp_pro) blocked when beta is off",
  );
});

test("getBlockedTiersForNewCheckout: returns a fresh Set per call (callers may not mutate cached state)", () => {
  process.env.BETA_MODE = "false";
  const a = getBlockedTiersForNewCheckout();
  a.delete("mvp_pro");
  const b = getBlockedTiersForNewCheckout();
  assert.equal(
    b.has("mvp_pro"),
    true,
    "mutating the returned Set must not poison the next call",
  );
});

// ─── getLaunchConfigPayload() / LAUNCH_PROMOTION_TRIGGER ───────────

test("getLaunchConfigPayload: surfaces the live betaMode bit and the canonical promotion trigger sentence", () => {
  process.env.BETA_MODE = "true";
  const onPayload = getLaunchConfigPayload();
  assert.equal(onPayload.betaMode, true);
  assert.equal(onPayload.promotionTrigger, LAUNCH_PROMOTION_TRIGGER);

  process.env.BETA_MODE = "false";
  const offPayload = getLaunchConfigPayload();
  assert.equal(offPayload.betaMode, false);
  assert.equal(
    offPayload.promotionTrigger,
    LAUNCH_PROMOTION_TRIGGER,
    "promotion trigger copy is fixed — does not vary with betaMode",
  );
});

test("LAUNCH_PROMOTION_TRIGGER: mentions the two key concepts shown to waitlist visitors", () => {
  // Soft contract: the customer-visible sentence must explain what
  // event will end the beta. We pin the two anchor concepts here so a
  // future copy edit cannot silently drop the explicit promotion
  // condition that the launch memo committed to.
  assert.match(LAUNCH_PROMOTION_TRIGGER, /Official/);
  assert.match(LAUNCH_PROMOTION_TRIGGER, /30 days/);
});
