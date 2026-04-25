import { test } from "node:test";
import assert from "node:assert/strict";
import { computeClvWritebackValues } from "../clvWriteback";
import { computeClvLineDelta, computeClvImpliedDelta } from "../expectedValue";

/**
 * Tests for the spread/total CLV writeback (Plan 1 fix). Before this fix the
 * cron writeback hard-gated on `pick.market === "moneyline"` and never wrote
 * close_odds, close_line, clv_implied_delta, or clv_line_delta for spread/total.
 *
 * These tests cover all six (market, side) combinations and the null-safety
 * behaviour required by the historical backfill (snapshots with partial close
 * data must still produce a usable partial writeback rather than throwing).
 */

const EMPTY_SNAP = {
  homeCloseMl: null,
  awayCloseMl: null,
  closeSpread: null,
  closeSpreadLine: null,
  closeAwaySpreadLine: null,
  closeTotal: null,
  closeOverLine: null,
  closeUnderLine: null,
};

test("computeClvLineDelta: spread home — line moved toward us → positive CLV", () => {
  // Bought home -1.5, closed at -1.0 → home now lays only 1 point → we got the better number.
  assert.equal(computeClvLineDelta(-1.5, -1.0, "home"), 0.5);
});

test("computeClvLineDelta: spread home — line moved against us → negative CLV", () => {
  assert.equal(computeClvLineDelta(-1.5, -2.0, "home"), -0.5);
});

test("computeClvLineDelta: spread away — line moved toward us → positive CLV", () => {
  // Bought away +1.5, closed at +1.0 → we got more points than close → positive CLV.
  assert.equal(computeClvLineDelta(1.5, 1.0, "away"), 0.5);
});

test("computeClvLineDelta: total over — line moved up (close higher) is bad for over", () => {
  // Bought OVER 220.5, closed at 222 → close threshold higher → our 220.5 is easier → positive.
  assert.equal(computeClvLineDelta(220.5, 222, "over"), 1.5);
});

test("computeClvLineDelta: total under — line moved up (close higher) hurts under", () => {
  assert.equal(computeClvLineDelta(220.5, 222, "under"), -1.5);
});

test("computeClvLineDelta returns null when either line is null", () => {
  assert.equal(computeClvLineDelta(null, 1.5, "home"), null);
  assert.equal(computeClvLineDelta(1.5, null, "away"), null);
});

test("computeClvImpliedDelta: positive when close odds are shorter than publish (market moved toward us)", () => {
  // Bought HOME at +120 (underdog price). Close -110 → market now sees HOME as favorite
  // → sharps moved the line in our direction → we got the better price → positive CLV.
  // publishImplied = 100/220 ≈ 0.4545; closeImplied = 110/210 ≈ 0.5238; delta ≈ +0.069.
  const v = computeClvImpliedDelta(120, -110)!;
  assert.ok(v > 0, `expected positive, got ${v}`);
});

test("computeClvImpliedDelta: negative when close odds are longer than publish (market moved away)", () => {
  // Bought HOME -110 (favorite). Close +120 → market revised away from HOME → bad publish price.
  const v = computeClvImpliedDelta(-110, 120)!;
  assert.ok(v < 0, `expected negative, got ${v}`);
});

test("computeClvImpliedDelta returns null when closeOdds is null", () => {
  assert.equal(computeClvImpliedDelta(-110, null), null);
});

test("ML home: close_odds = homeCloseMl, no line", () => {
  const out = computeClvWritebackValues(
    { market: "moneyline", pick: "home", publishOdds: "-110", publishLine: null },
    { ...EMPTY_SNAP, homeCloseMl: "-120" },
  );
  assert.equal(out.closeOdds, "-120");
  assert.equal(out.closeLine, undefined);
  assert.ok(out.clvImpliedDelta != null);
  assert.equal(out.clvLineDelta, undefined);
});

test("ML away: close_odds = awayCloseMl, no line", () => {
  const out = computeClvWritebackValues(
    { market: "moneyline", pick: "away", publishOdds: "+150", publishLine: null },
    { ...EMPTY_SNAP, awayCloseMl: "+140" },
  );
  assert.equal(out.closeOdds, "140");
  assert.equal(out.closeLine, undefined);
  assert.ok(out.clvImpliedDelta != null);
  assert.equal(out.clvLineDelta, undefined);
});

test("Spread home: close_odds=closeSpreadLine, close_line=closeSpread, both CLV fields populated", () => {
  const out = computeClvWritebackValues(
    { market: "spread", pick: "home", publishOdds: "-110", publishLine: "-1.5" },
    {
      ...EMPTY_SNAP,
      closeSpread: "-1.0",
      closeSpreadLine: "-115",
      closeAwaySpreadLine: "-105",
    },
  );
  assert.equal(out.closeOdds, "-115");
  assert.equal(out.closeLine, "-1");
  assert.ok(out.clvImpliedDelta != null);
  // Bought -1.5, closed -1.0 → got the better number → positive line CLV.
  assert.equal(out.clvLineDelta, "0.5");
});

test("Spread away: close_odds=closeAwaySpreadLine, close_line=-closeSpread", () => {
  const out = computeClvWritebackValues(
    { market: "spread", pick: "away", publishOdds: "-105", publishLine: "1.5" },
    {
      ...EMPTY_SNAP,
      closeSpread: "-1.0",
      closeSpreadLine: "-115",
      closeAwaySpreadLine: "-105",
    },
  );
  assert.equal(out.closeOdds, "-105");
  // Away line is the negation of the canonical home spread.
  assert.equal(out.closeLine, "1");
  assert.ok(out.clvImpliedDelta != null);
  // Bought +1.5, closed +1.0 → got more points → positive line CLV.
  assert.equal(out.clvLineDelta, "0.5");
});

test("Spread away: missing closeAwaySpreadLine yields null clv_implied_delta but still writes close_line", () => {
  // Models the historical-backfill case where pre-Plan-1 snapshots never
  // captured closeAwaySpreadLine — line CLV is recoverable, price CLV is not.
  const out = computeClvWritebackValues(
    { market: "spread", pick: "away", publishOdds: "-110", publishLine: "1.5" },
    { ...EMPTY_SNAP, closeSpread: "-1.0" },
  );
  assert.equal(out.closeOdds, undefined);
  assert.equal(out.closeLine, "1");
  assert.equal(out.clvImpliedDelta, undefined);
  assert.equal(out.clvLineDelta, "0.5");
});

test("Total over: close_odds=closeOverLine, close_line=closeTotal", () => {
  const out = computeClvWritebackValues(
    { market: "total", pick: "over", publishOdds: "-110", publishLine: "220.5" },
    {
      ...EMPTY_SNAP,
      closeTotal: "222",
      closeOverLine: "-115",
      closeUnderLine: "-105",
    },
  );
  assert.equal(out.closeOdds, "-115");
  assert.equal(out.closeLine, "222");
  assert.equal(out.clvLineDelta, "1.5");
});

test("Total under: close_odds=closeUnderLine, close_line=closeTotal", () => {
  const out = computeClvWritebackValues(
    { market: "total", pick: "under", publishOdds: "-110", publishLine: "220.5" },
    {
      ...EMPTY_SNAP,
      closeTotal: "222",
      closeOverLine: "-115",
      closeUnderLine: "-105",
    },
  );
  assert.equal(out.closeOdds, "-105");
  assert.equal(out.closeLine, "222");
  // Bought UNDER 220.5, closed 222 → close threshold higher → our 220.5 harder → negative.
  assert.equal(out.clvLineDelta, "-1.5");
});

test("Empty snapshot: every field undefined, no throws", () => {
  const out = computeClvWritebackValues(
    { market: "spread", pick: "home", publishOdds: "-110", publishLine: "-1.5" },
    EMPTY_SNAP,
  );
  assert.equal(out.closeOdds, undefined);
  assert.equal(out.closeLine, undefined);
  assert.equal(out.clvImpliedDelta, undefined);
  assert.equal(out.clvLineDelta, undefined);
});

// Malformed-side guard: prevent silent misclassification of bad rows.
test("Malformed: spread pick='over' (wrong-shape side) writes nothing", () => {
  const out = computeClvWritebackValues(
    { market: "spread", pick: "over", publishOdds: "-110", publishLine: "-1.5" },
    {
      ...EMPTY_SNAP,
      closeSpread: "-1",
      closeSpreadLine: "-105",
      closeAwaySpreadLine: "-115",
    },
  );
  assert.equal(out.closeOdds, undefined);
  assert.equal(out.closeLine, undefined);
  assert.equal(out.clvImpliedDelta, undefined);
  assert.equal(out.clvLineDelta, undefined);
});

test("Malformed: total pick='home' (wrong-shape side) writes nothing", () => {
  const out = computeClvWritebackValues(
    { market: "total", pick: "home", publishOdds: "-110", publishLine: "220.5" },
    {
      ...EMPTY_SNAP,
      closeTotal: "222",
      closeOverLine: "-115",
      closeUnderLine: "-105",
    },
  );
  assert.equal(out.closeOdds, undefined);
  assert.equal(out.closeLine, undefined);
  assert.equal(out.clvImpliedDelta, undefined);
  assert.equal(out.clvLineDelta, undefined);
});

test("Malformed: moneyline pick='over' writes nothing", () => {
  const out = computeClvWritebackValues(
    { market: "moneyline", pick: "over", publishOdds: "-110", publishLine: null },
    { ...EMPTY_SNAP, homeCloseMl: "-120", awayCloseMl: "100" },
  );
  assert.equal(out.closeOdds, undefined);
  assert.equal(out.clvImpliedDelta, undefined);
});

test("Malformed: unknown market writes nothing", () => {
  const out = computeClvWritebackValues(
    { market: "props", pick: "home", publishOdds: "-110", publishLine: null },
    { ...EMPTY_SNAP, homeCloseMl: "-120", awayCloseMl: "100" },
  );
  assert.equal(out.closeOdds, undefined);
  assert.equal(out.closeLine, undefined);
  assert.equal(out.clvImpliedDelta, undefined);
  assert.equal(out.clvLineDelta, undefined);
});
