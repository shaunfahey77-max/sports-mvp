import { test, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Route-level contract test for the Open-Beta paid-checkout block
 * (Task #46 → Task #49 test coverage).
 *
 * What we pin here is the most safety-critical assertion in the
 * whole beta gating: posting a blocked tier to /stripe/checkout
 * MUST come back as HTTP 410 with the machine-readable code
 * "blocked_tier", because:
 *   - The 410 status is what the frontend uses to redirect users
 *     to the waitlist instead of an error page.
 *   - The code:"blocked_tier" string is what monitoring uses to
 *     distinguish a deliberate block from a generic Stripe error.
 *   - Silently re-opening paid checkout in beta mode would create
 *     subscriptions we promised launch ops we would not create.
 *
 * Test isolation:
 *   - We stub `@clerk/express` so the auth gate passes deterministically.
 *   - We stub `../../stripeClient` so `prices.retrieve` returns a fake
 *     price whose product carries whatever tier the test wants.
 *   - We stub `../../storage` and `../../stripeService` so the
 *     non-blocked control case does not need a real DB user / real
 *     Stripe checkout session creation.
 *
 * Stubs use Node's `mock.module()` (requires
 * --experimental-test-module-mocks). The router is loaded via
 * dynamic import AFTER the stubs are in place so the import chain
 * resolves to the mocks.
 */

// Per-test knobs — each test sets these before exercising the router.
let nextTier: string | null = "mvp";
let nextUserId: string | null = "test-user-id";

let baseUrl = "";
let server: Server | undefined;
const ORIGINAL_BETA_MODE = process.env.BETA_MODE;

before(async () => {
  // ─── stub @clerk/express ──────────────────────────────────────
  mock.module("@clerk/express", {
    namedExports: {
      getAuth: (_req: unknown) => ({ userId: nextUserId }),
    },
  });

  // ─── stub stripeClient ────────────────────────────────────────
  mock.module("../../stripeClient", {
    namedExports: {
      getUncachableStripeClient: async () => ({
        prices: {
          retrieve: async (_id: string, _opts: unknown) => ({
            id: "price_fake",
            product: {
              id: "prod_fake",
              metadata: nextTier ? { tier: nextTier } : {},
            },
          }),
          list: async () => ({ data: [] }),
        },
        products: {
          list: async () => ({ data: [] }),
        },
      }),
      getStripePublishableKey: async () => "pk_test_fake",
    },
  });

  // ─── stub storage so the non-blocked control case does not
  //      try to read from the real users table ───────────────────
  mock.module("../../storage", {
    namedExports: {
      storage: {
        getUser: async (_id: string) => ({ email: "test@example.com" }),
      },
    },
  });

  // ─── stub stripeService so the non-blocked control case does not
  //      hit real Stripe to create a checkout session ────────────
  mock.module("../../stripeService", {
    namedExports: {
      stripeService: {
        createCheckoutSession: async () => "https://stripe.test/session/fake",
        createPortalSession: async () => "https://stripe.test/portal/fake",
      },
    },
  });

  // Dynamic import AFTER mocks so the router's static imports
  // resolve through them.
  const stripeRouter = (await import("../stripe")).default;

  const app = express();
  app.use(express.json());
  app.use(stripeRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const port = (server!.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (ORIGINAL_BETA_MODE === undefined) {
    delete process.env.BETA_MODE;
  } else {
    process.env.BETA_MODE = ORIGINAL_BETA_MODE;
  }
  // Restore all mock.module() registrations so they can never bleed
  // into another test file if Node's worker isolation policy
  // changes in a future release.
  mock.reset();
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
  });
  // Best-effort: api-server's webhookHandlers.ts may have caused
  // the @workspace/db pool to open (transitively). Drain it.
  try {
    const dbModule = await import("@workspace/db");
    const pool = (dbModule as { pool?: { end?: () => Promise<void> } }).pool;
    if (pool && typeof pool.end === "function") {
      await pool.end();
    }
  } catch {
    // ignore — process exits cleanly anyway
  }
});

beforeEach(() => {
  // Reset per-test mock knobs so a stray earlier setting does not
  // bleed into a later test.
  nextTier = "mvp";
  nextUserId = "test-user-id";
  delete process.env.BETA_MODE;
});

afterEach(() => {
  delete process.env.BETA_MODE;
});

async function postCheckout(
  priceId: string | null,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/stripe/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(priceId === null ? {} : { priceId }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ─── 410 + code:'blocked_tier' contract ────────────────────────────

test("POST /stripe/checkout in beta mode for tier='mvp' → 410 + code:'blocked_tier'", async () => {
  process.env.BETA_MODE = "true";
  nextTier = "mvp";
  const { status, body } = await postCheckout("price_mvp_fake");
  assert.equal(status, 410, "must signal Gone — frontend uses 410 to route to waitlist");
  assert.equal(
    body.code,
    "blocked_tier",
    "machine-readable code is part of the contract — monitoring keys off it",
  );
});

test("POST /stripe/checkout in beta mode (env unset → default ON) for tier='mvp' → 410 + blocked_tier", async () => {
  delete process.env.BETA_MODE;
  nextTier = "mvp";
  const { status, body } = await postCheckout("price_mvp_fake");
  assert.equal(status, 410);
  assert.equal(body.code, "blocked_tier");
});

test("POST /stripe/checkout for tier='mvp_pro' → 410 + blocked_tier in EITHER beta mode", async () => {
  for (const beta of ["true", "false"]) {
    process.env.BETA_MODE = beta;
    nextTier = "mvp_pro";
    const { status, body } = await postCheckout("price_mvp_pro_fake");
    assert.equal(
      status,
      410,
      `mvp_pro must always be blocked (BETA_MODE=${beta})`,
    );
    assert.equal(body.code, "blocked_tier");
  }
});

// ─── Non-blocked control case ──────────────────────────────────────

test("POST /stripe/checkout with BETA_MODE=false for tier='mvp' → 200 + checkout url (paid acquisition resumes)", async () => {
  process.env.BETA_MODE = "false";
  nextTier = "mvp";
  const { status, body } = await postCheckout("price_mvp_fake");
  // Pin the success contract directly: a 500 here would otherwise
  // silently pass a "not 410" assertion while masking a broken
  // paid-open path. With the stripeService stub returning a fake
  // URL, the route should respond 200 + {url}.
  assert.equal(
    status,
    200,
    `mvp must be allowed when paid acquisition is open — expected 200, got ${status}`,
  );
  assert.equal(
    typeof body?.url,
    "string",
    "success path must return a Stripe checkout URL",
  );
  assert.notEqual(
    body?.code,
    "blocked_tier",
    "must not emit blocked_tier code when the tier is open",
  );
});

test("POST /stripe/checkout when product carries no tier metadata → must NOT 410 (only known tiers gate)", async () => {
  process.env.BETA_MODE = "true";
  nextTier = null; // product.metadata = {} → no tier
  const { status, body } = await postCheckout("price_unknown_fake");
  assert.notEqual(
    status,
    410,
    "untiered product (e.g. a one-off SKU) must not be misclassified as a blocked tier",
  );
  assert.notEqual(body?.code, "blocked_tier");
});

// ─── Pre-block guards (auth + body) still fire ─────────────────────

test("POST /stripe/checkout without auth → 401 (auth gate runs BEFORE blocked-tier check)", async () => {
  process.env.BETA_MODE = "true";
  nextTier = "mvp";
  nextUserId = null;
  const { status } = await postCheckout("price_mvp_fake");
  assert.equal(status, 401);
});

test("POST /stripe/checkout without priceId → 400", async () => {
  process.env.BETA_MODE = "true";
  nextTier = "mvp";
  const { status } = await postCheckout(null);
  assert.equal(status, 400);
});
