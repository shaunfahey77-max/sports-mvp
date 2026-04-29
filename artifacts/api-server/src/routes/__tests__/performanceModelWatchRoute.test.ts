import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import performanceRouter from "../performance";

// Route-level test for the new GET /performance/model-watch endpoint.
// Express delivers query parameters as strings (e.g. `?window=30` →
// `req.query.window === "30"`), but the generated Zod params schema uses
// numeric literals. Without explicit coercion the safeParse fails and the
// endpoint returns 400 for every valid client request — exactly the
// regression Code Review #32 caught.
//
// These tests pin the contract by spinning up a real Express app, mounting
// the same router production uses, and asserting:
//   - omitted `window` → 200 + windowDays === 30 (schema default)
//   - `?window=14|30|45` (strings, as Express produces) → 200 + matching
//     `windowDays` echoed back
//   - `?window=99` (string, valid number, invalid literal) → 400
//   - `?window=foo` (non-numeric) → 400
//
// We do NOT seed the DB here; the assertions only check status code +
// `windowDays` echo, which never depend on row data. The summary numbers
// themselves are covered by the dedicated summarizeModelWatchRows tests.

let baseUrl = "";
let server: Server | undefined;

before(async () => {
  const app = express();
  app.use(performanceRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const port = (server!.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  // Without explicit close + DB pool shutdown the test process keeps the
  // event loop alive (HTTP server + drizzle PG pool both hold sockets),
  // and the suite hangs after the last assertion. Mirror what the prod
  // server's shutdown path does: stop accepting connections, then end the
  // shared pool.
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
  });
  try {
    const dbModule = await import("@workspace/db");
    const pool = (dbModule as { pool?: { end?: () => Promise<void> } }).pool;
    if (pool && typeof pool.end === "function") {
      await pool.end();
    }
  } catch {
    // best-effort: if the workspace exports a different shutdown shape,
    // node will still exit at process tick end since this is a test run.
  }
});

async function fetchJson(
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

test("GET /performance/model-watch with no window → 200, windowDays defaults to 30", async () => {
  const { status, body } = await fetchJson("/performance/model-watch");
  assert.equal(status, 200);
  assert.equal(
    (body as { windowDays: number }).windowDays,
    30,
    "schema default should be 30",
  );
});

test("GET /performance/model-watch?window=14|30|45 (string query, as Express delivers) → 200 with matching windowDays echo", async () => {
  for (const w of [14, 30, 45]) {
    const { status, body } = await fetchJson(
      `/performance/model-watch?window=${w}`,
    );
    assert.equal(
      status,
      200,
      `expected 200 for ?window=${w}, got ${status}: ${JSON.stringify(body)}`,
    );
    assert.equal(
      (body as { windowDays: number }).windowDays,
      w,
      `expected windowDays=${w} echo`,
    );
  }
});

test("GET /performance/model-watch?window=99 (valid number, invalid literal) → 400", async () => {
  const { status } = await fetchJson("/performance/model-watch?window=99");
  assert.equal(status, 400);
});

test("GET /performance/model-watch?window=foo (non-numeric) → 400", async () => {
  const { status } = await fetchJson("/performance/model-watch?window=foo");
  assert.equal(status, 400);
});

test("GET /performance/model-watch response shape: exactly the documented keys (no leak)", async () => {
  const { status, body } = await fetchJson("/performance/model-watch?window=14");
  assert.equal(status, 200);
  const expected = new Set([
    "windowDays",
    "leansGraded",
    "winRate",
    "meanClv",
    "clvSampleSize",
    "activeMarkets",
    "totalRegistryMarkets",
  ]);
  const actual = new Set(Object.keys(body as Record<string, unknown>));
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    "response key set must be EXACTLY the documented set — no roi/units/avgEdge leak",
  );
});
