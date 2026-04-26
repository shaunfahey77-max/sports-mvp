/**
 * Public-site preview gate (Express surface).
 *
 * Activated only when both SITE_BASIC_AUTH_USER and SITE_BASIC_AUTH_PASS are
 * set. When either env var is empty/unset the middleware is a no-op, so the
 * gate is fully reversible by clearing the secrets.
 *
 * The gate's behavior — cookie signing/verification, branded HTML login page,
 * login + logout handling, Basic-Auth fallback for CLI clients, Set-Cookie
 * attribute strings, the "session expired" UX — lives in the shared
 * `@workspace/preview-gate` package so both this Express middleware and the
 * Vite plugin (`artifacts/sports-mvp/vite.config.ts`) stay in lockstep. This
 * file only owns the Express-specific glue: which paths are carve-outs on
 * the API surface, and how to translate `req` into the adapter context the
 * shared handler expects.
 *
 * Carve-outs (always bypass the gate so internal jobs / webhooks / health
 * checks keep working):
 *   - Clerk proxy path (so tester accounts can complete sign-in through the
 *     gate)
 *   - /api/admin/*       (still gated by the existing SESSION_SECRET check)
 *   - /api/snapshots/*   (internal-only, secret-gated elsewhere)
 *   - /api/stripe/webhook (must be authenticated only by Stripe signature)
 *   - /api/health, /api/healthz (uptime / health checks)
 */

import type { RequestHandler } from "express";
import {
  PREVIEW_LOGIN_PATH,
  PREVIEW_LOGOUT_PATH,
  handlePreviewGate,
  type PreviewGateAdapterContext,
} from "@workspace/preview-gate";
import { CLERK_PROXY_PATH } from "./clerkProxyMiddleware";

// Re-export the gate's public symbols that other parts of the api-server
// (notably `app.ts` and any future tests) historically imported from this
// file. Keeping the surface stable means the refactor to the shared package
// is a pure internal move.
export {
  PREVIEW_LOGIN_PATH,
  PREVIEW_LOGOUT_PATH,
  makePreviewCookieValue,
  inspectPreviewCookie,
  verifyPreviewCookie,
  renderPreviewLoginPage,
  type PreviewCookieStatus,
} from "@workspace/preview-gate";

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

function isCarveOut(path: string): boolean {
  if (SKIP_EXACT.has(path)) return true;
  for (const prefix of SKIP_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + "/")) return true;
  }
  return false;
}

export function basicAuthMiddleware(): RequestHandler {
  return (req, res, next) => {
    // Capture the Express-typed `req` in the closure so the adapter can
    // read `originalUrl` (only Express adds it) without leaving the typed
    // world. The adapter parameter is the raw `IncomingMessage` the shared
    // handler passes back, but it's the same object — we just prefer the
    // already-typed reference.
    const adapter = (_rawReq: unknown, path: string): PreviewGateAdapterContext => {
      const isLoginPath = path === PREVIEW_LOGIN_PATH;
      const isLogoutPath = path === PREVIEW_LOGOUT_PATH;
      // The API surface has no proxy-prefix sniffing — the login/logout
      // endpoints live at fixed paths and the default redirect is the site
      // root. The silent-bounce target reuses Express's `originalUrl` so
      // mounted sub-apps still bounce back to the right place.
      const silentBounceTarget =
        req.method === "GET" ? req.originalUrl || req.url || "/" : "/";
      return {
        isCarveOut:
          !isLoginPath && !isLogoutPath && isCarveOut(path),
        isLoginPath,
        isLogoutPath,
        loginFormPath: PREVIEW_LOGIN_PATH,
        defaultRedirect: "/",
        silentBounceTarget,
      };
    };
    handlePreviewGate(req, res, next, adapter).catch(next);
  };
}
