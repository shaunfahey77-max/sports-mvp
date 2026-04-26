/**
 * HTTP Basic Auth gate for the public API surface.
 *
 * Activated only when both SITE_BASIC_AUTH_USER and SITE_BASIC_AUTH_PASS are
 * set. When either env var is empty/unset the middleware is a no-op, so the
 * gate is fully reversible by clearing the secrets.
 *
 * Carve-outs (always bypass Basic Auth so internal jobs / webhooks / health
 * checks keep working):
 *   - Clerk proxy path (so tester accounts can complete sign-in through the
 *     gate)
 *   - /api/admin/*       (still gated by the existing SESSION_SECRET check)
 *   - /api/snapshots/*   (internal-only, secret-gated elsewhere)
 *   - /api/stripe/webhook (must be authenticated only by Stripe signature)
 *   - /api/health, /api/healthz (uptime / health checks)
 *
 * Credential comparison uses timingSafeEqual with length normalization so
 * neither the username nor the password leaks length information via timing.
 * Credentials are never logged.
 */

import type { RequestHandler } from "express";
import { timingSafeEqual } from "crypto";
import { CLERK_PROXY_PATH } from "./clerkProxyMiddleware";

const REALM = "Restricted";

const SKIP_PREFIXES: readonly string[] = [
  "/api/admin",
  "/api/snapshots",
  CLERK_PROXY_PATH,
];

const SKIP_EXACT: ReadonlySet<string> = new Set([
  "/api/stripe/webhook",
  "/api/health",
  "/api/healthz",
]);

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  // Length-normalize the comparison so that mismatched-length inputs still
  // burn a comparison cycle and never short-circuit early.
  const len = Math.max(aBuf.length, bBuf.length, 1);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  const equal = timingSafeEqual(aPad, bPad);
  return equal && aBuf.length === bBuf.length;
}

function isCarveOut(path: string): boolean {
  if (SKIP_EXACT.has(path)) return true;
  for (const prefix of SKIP_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + "/")) return true;
  }
  return false;
}

export function basicAuthMiddleware(): RequestHandler {
  return (req, res, next) => {
    const expectedUser = process.env.SITE_BASIC_AUTH_USER;
    const expectedPass = process.env.SITE_BASIC_AUTH_PASS;

    // No-op when either env var is unset — clearing the secrets removes the
    // gate everywhere with no code change.
    if (!expectedUser || !expectedPass) return next();

    if (isCarveOut(req.path)) return next();

    const header = req.headers.authorization;
    if (header && header.startsWith("Basic ")) {
      const encoded = header.slice("Basic ".length).trim();
      let decoded = "";
      try {
        decoded = Buffer.from(encoded, "base64").toString("utf8");
      } catch {
        decoded = "";
      }
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const providedUser = decoded.slice(0, sep);
        const providedPass = decoded.slice(sep + 1);
        if (
          constantTimeStringEqual(providedUser, expectedUser) &&
          constantTimeStringEqual(providedPass, expectedPass)
        ) {
          return next();
        }
      }
    }

    res.set("WWW-Authenticate", `Basic realm="${REALM}", charset="UTF-8"`);
    res.status(401).type("text/plain").send("Authentication required");
  };
}
