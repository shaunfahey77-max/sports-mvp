import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db } from "@workspace/db";
import { waitlistSignups } from "@workspace/db";

/**
 * End-to-end route test for the Open-Beta waitlist endpoint
 * (Task #46 → Task #49 test coverage).
 *
 * What we pin here:
 *   - 200 OK returning {ok, id, email} for a fresh, valid email
 *   - Idempotency: posting the same email twice returns 200 BOTH
 *     times AND returns the same row id (storage upsert via
 *     ON CONFLICT DO UPDATE on the unique email index)
 *   - Email normalization to lowercase before persistence
 *   - 400 on malformed bodies (missing email, empty email,
 *     malformed email string, missing body, source > 64 chars)
 *
 * Why route-level rather than unit: the validation lives in the
 * router (zod safeParse) and the upsert lives in storage. The
 * thing we care about is the contract between them — that
 * `POST /waitlist` keeps returning 200 + idempotent rows even if
 * someone refactors either side. A unit test of zod or of storage
 * alone would not catch a regression where the route stops
 * forwarding `email` to storage, etc.
 *
 * We use the real DB (same pattern as performanceModelWatchRoute
 * test) and isolate via an email prefix that is unique per test
 * run, so concurrent CI runs do not collide.
 */

let baseUrl = "";
let server: Server | undefined;
const testEmailPrefix = `task49-${Date.now()}-${Math.floor(
  Math.random() * 1_000_000,
)}`;
const insertedEmails: string[] = [];

function mkEmail(suffix: string): string {
  const e = `${testEmailPrefix}-${suffix}@example.com`;
  insertedEmails.push(e.toLowerCase());
  return e;
}

before(async () => {
  // The waitlist route calls `getAuth(req)` from @clerk/express to
  // attach a clerkUserId to the row when the submitter happens to
  // already be signed in. In production that resolves through the
  // clerkMiddleware mounted in the main server bootstrap, but our
  // test app does not (and should not) wire up Clerk just to test
  // anonymous waitlist signups. Stub the module so getAuth returns a
  // benign anonymous shape.
  mock.module("@clerk/express", {
    namedExports: {
      getAuth: (_req: unknown) => ({ userId: null }),
    },
  });
  // Dynamic import after the mock so the router's static import of
  // @clerk/express resolves through the stub.
  const waitlistRouter = (await import("../launch")).default;

  const app = express();
  app.use(express.json());
  app.use(waitlistRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const port = (server!.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  // Clean up every row we inserted so the table does not accumulate
  // test rows across runs (the unique email index would otherwise
  // make repeat runs of the same prefix collide harmlessly, but
  // leftover test rows are still noise we should not leave behind).
  if (insertedEmails.length > 0) {
    try {
      await db
        .delete(waitlistSignups)
        .where(inArray(waitlistSignups.email, insertedEmails));
    } catch {
      // best-effort cleanup
    }
  }

  // Restore the @clerk/express mock so it cannot leak into another
  // test file if Node's worker isolation policy ever changes.
  mock.reset();
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
    // best-effort: Node will exit at process tick end since this is
    // a one-shot test run.
  }
});

async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

// ─── happy path ────────────────────────────────────────────────────

test("POST /waitlist with valid email → 200 with {ok:true, id:number, email}", async () => {
  const email = mkEmail("happy");
  const { status, body } = await postJson("/waitlist", { email });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.id, "number");
  assert.equal(
    body.email,
    email.toLowerCase(),
    "stored email must be lowercased before return",
  );
});

test("POST /waitlist normalizes mixed-case email to lowercase before persisting", async () => {
  const baseEmail = mkEmail("CaseTest");
  const upper = baseEmail.toUpperCase();
  const { status, body } = await postJson("/waitlist", { email: upper });
  assert.equal(status, 200);
  assert.equal(body.email, baseEmail.toLowerCase());

  // Verify in DB directly
  const rows = await db
    .select()
    .from(waitlistSignups)
    .where(eq(waitlistSignups.email, baseEmail.toLowerCase()));
  assert.equal(rows.length, 1, "exactly one row stored under lowercase email");
});

test("POST /waitlist accepts optional source and persists it", async () => {
  const email = mkEmail("source");
  const { status, body } = await postJson("/waitlist", {
    email,
    source: "subscribe_page",
  });
  assert.equal(status, 200);
  const [row] = await db
    .select()
    .from(waitlistSignups)
    .where(eq(waitlistSignups.email, body.email));
  assert.equal(row.source, "subscribe_page");
});

// ─── idempotency contract ──────────────────────────────────────────

test("POST /waitlist twice with same email → 200 both times AND returns the same row id (idempotent upsert)", async () => {
  const email = mkEmail("idempotent");
  const first = await postJson("/waitlist", { email });
  const second = await postJson("/waitlist", { email });

  assert.equal(first.status, 200, "first insert must succeed");
  assert.equal(second.status, 200, "repeat must NOT 409 — contract is 200");
  assert.equal(
    second.body.id,
    first.body.id,
    "repeat submission must return the SAME row id (storage uses ON CONFLICT DO UPDATE on email)",
  );

  // Belt-and-suspenders: only one row should exist for this email.
  const rows = await db
    .select()
    .from(waitlistSignups)
    .where(eq(waitlistSignups.email, email.toLowerCase()));
  assert.equal(rows.length, 1, "DB must contain exactly one row per email");
});

test("POST /waitlist updates source on repeat submission (COALESCE upsert refreshes attribution)", async () => {
  const email = mkEmail("source-refresh");
  // First submission with no source
  await postJson("/waitlist", { email });
  // Second submission with a source — should be applied via COALESCE
  await postJson("/waitlist", { email, source: "landing_membership" });

  const [row] = await db
    .select()
    .from(waitlistSignups)
    .where(eq(waitlistSignups.email, email.toLowerCase()));
  assert.equal(
    row.source,
    "landing_membership",
    "source should be filled in on repeat when the new submission carries one",
  );
});

// ─── 400 contract on malformed bodies ──────────────────────────────

test("POST /waitlist with missing email → 400", async () => {
  const { status } = await postJson("/waitlist", {});
  assert.equal(status, 400);
});

test("POST /waitlist with malformed email string → 400", async () => {
  const { status } = await postJson("/waitlist", { email: "not-an-email" });
  assert.equal(status, 400);
});

test("POST /waitlist with non-string email → 400", async () => {
  const { status } = await postJson("/waitlist", { email: 123 });
  assert.equal(status, 400);
});

test("POST /waitlist with empty email → 400", async () => {
  const { status } = await postJson("/waitlist", { email: "" });
  assert.equal(status, 400);
});

test("POST /waitlist with source longer than 64 chars → 400", async () => {
  const email = mkEmail("oversource");
  const { status } = await postJson("/waitlist", {
    email,
    source: "a".repeat(65),
  });
  assert.equal(status, 400);
});

test("POST /waitlist with completely missing JSON body → 400 (does not crash on undefined req.body)", async () => {
  // No content-type header, no body — express.json() will leave
  // req.body as {}, the zod schema then rejects on missing email.
  // We pin this to ensure the route never throws for a body-less
  // POST (which would otherwise leak as a 500).
  const res = await fetch(`${baseUrl}/waitlist`, { method: "POST" });
  assert.equal(res.status, 400);
});

test("POST /waitlist with malformed JSON body → 400 (express.json error → not a 5xx)", async () => {
  const res = await fetch(`${baseUrl}/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not valid json",
  });
  // express.json() emits a 400 SyntaxError middleware response by
  // default; the contract is just that callers never see a 5xx for
  // malformed input.
  assert.equal(res.status >= 400 && res.status < 500, true,
    `malformed JSON must surface as 4xx, got ${res.status}`);
});
