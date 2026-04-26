/**
 * Public-site preview gate.
 *
 * Activated only when both SITE_BASIC_AUTH_USER and SITE_BASIC_AUTH_PASS are
 * set. When either env var is empty/unset the middleware is a no-op, so the
 * gate is fully reversible by clearing the secrets.
 *
 * Authentication paths (checked in order):
 *   1. Signed `preview_auth` cookie (set by the branded HTML login page)
 *   2. HTTP Basic Auth header (kept so curl / CI / scripts keep working)
 *
 * Browser/HTML clients see a branded HTML login page (single password field)
 * rather than the native browser Basic-Auth popup. CLI clients (anything that
 * does not advertise `text/html` in Accept) still get a `WWW-Authenticate`
 * challenge so existing automation continues to work.
 *
 * Cookie format: `<base64url(payload)>.<base64url(hmac)>` where payload is
 * `{ "exp": <unix-seconds> }` and the HMAC is keyed off SITE_BASIC_AUTH_PASS
 * (so rotating the password invalidates all outstanding cookies).
 *
 * Carve-outs (always bypass the gate so internal jobs / webhooks / health
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
import type { IncomingMessage } from "http";
import { createHmac, timingSafeEqual } from "crypto";
import { CLERK_PROXY_PATH } from "./clerkProxyMiddleware";

const REALM = "Restricted";
const COOKIE_NAME = "preview_auth";
const COOKIE_TTL_SECONDS = 8 * 60 * 60; // 8 hours
export const PREVIEW_LOGIN_PATH = "/__preview/login";
export const PREVIEW_LOGOUT_PATH = "/__preview/logout";
const MAX_LOGIN_BODY_BYTES = 4 * 1024; // 4KB; the form is tiny

// One-shot marker cookie used to surface a "your session expired" info
// banner on the next render of the branded login page. Only set when the
// presented `preview_auth` cookie was structurally valid (HMAC matched,
// payload parsed) but past its `exp`. Tampered/garbage cookies never get a
// marker so we don't leak signal to attackers.
const EXPIRED_MARKER_COOKIE = "preview_auth_expired";
const EXPIRED_MARKER_TTL_SECONDS = 60;
const EXPIRED_SESSION_NOTICE =
  "Your preview session expired \u2014 please sign in again.";

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

function deriveCookieKey(password: string): Buffer {
  // Domain-separate so the cookie key cannot collide with any other use of
  // the password. Rotating SITE_BASIC_AUTH_PASS invalidates all cookies.
  return createHmac("sha256", "sportsmvp.preview_auth.v1")
    .update(password, "utf8")
    .digest();
}

function signPayload(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function makePreviewCookieValue(
  password: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const exp = nowSeconds + COOKIE_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ exp }), "utf8").toString(
    "base64url",
  );
  const sig = signPayload(payload, deriveCookieKey(password));
  return `${payload}.${sig}`;
}

export type PreviewCookieStatus = "valid" | "expired" | "invalid";

/**
 * Inspect a `preview_auth` cookie and report whether it is valid, structurally
 * valid but past its `exp` (expired), or unparseable / tampered (invalid).
 *
 * The "expired" status is reserved for cookies whose HMAC matches the current
 * server-side key AND whose payload parses cleanly with a numeric `exp` —
 * i.e. cookies that this server itself once issued. Anything else is
 * collapsed to "invalid" so a tampered/garbage cookie cannot trigger the
 * "session expired" UX (which would leak signal to attackers about whether
 * their guess of the cookie shape is on the right track).
 */
export function inspectPreviewCookie(
  cookieValue: string,
  password: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): PreviewCookieStatus {
  if (!cookieValue) return "invalid";
  const dot = cookieValue.indexOf(".");
  if (dot === -1) return "invalid";
  const payloadB64 = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!payloadB64 || !sig) return "invalid";

  const expectedSig = signPayload(payloadB64, deriveCookieKey(password));
  if (!timingSafeStringEqual(sig, expectedSig)) return "invalid";

  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    );
  } catch {
    return "invalid";
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { exp?: unknown }).exp !== "number"
  ) {
    return "invalid";
  }
  const exp = (payload as { exp: number }).exp;
  return exp > nowSeconds ? "valid" : "expired";
}

export function verifyPreviewCookie(
  cookieValue: string,
  password: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  return inspectPreviewCookie(cookieValue, password, nowSeconds) === "valid";
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const raw = part.slice(eq + 1).trim();
    let value = raw;
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawVal = eq === -1 ? "" : pair.slice(eq + 1);
    let key: string;
    let val: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      val = decodeURIComponent(rawVal.replace(/\+/g, " "));
    } catch {
      continue;
    }
    if (key) out[key] = val;
  }
  return out;
}

function readRequestBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer | string) => {
      if (aborted) return;
      const buf =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      total += buf.length;
      if (total > maxBytes) {
        aborted = true;
        reject(new Error("body too large"));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (aborted) return;
      aborted = true;
      reject(err);
    });
  });
}

function wantsHtml(accept: string | undefined): boolean {
  if (!accept) return false;
  // Treat any client that prefers HTML as a browser. `*/*` alone (curl's
  // default) is intentionally NOT treated as HTML so CLI clients still get
  // the WWW-Authenticate fallback.
  return accept.includes("text/html");
}

function safeRedirectTarget(input: string | undefined): string {
  if (!input) return "/";
  // Only allow same-origin absolute paths. Reject protocol-relative ("//foo"),
  // backslash variants ("/\\foo"), and anything that does not start with "/".
  if (!input.startsWith("/")) return "/";
  if (input.startsWith("//") || input.startsWith("/\\")) return "/";
  return input;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPreviewLoginPage(opts: {
  redirect: string;
  error?: string;
  notice?: string;
}): string {
  const redirect = escapeHtml(safeRedirectTarget(opts.redirect));
  const error = opts.error ? escapeHtml(opts.error) : "";
  const notice = opts.notice ? escapeHtml(opts.notice) : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>SportsMVP — Preview Access</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    background: radial-gradient(circle at 20% 0%, #1f2937 0%, #0b1220 60%, #05070d 100%);
    color: #e5e7eb;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 380px;
    background: rgba(17, 24, 39, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 14px;
    padding: 32px 28px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: 0.02em;
    margin-bottom: 24px;
    color: #f1f5f9;
  }
  .logo-mark {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, #22d3ee 0%, #6366f1 100%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 800;
    color: #0b1220;
  }
  h1 {
    font-size: 20px;
    margin: 0 0 6px;
    font-weight: 600;
    color: #f8fafc;
  }
  p.lede {
    margin: 0 0 20px;
    color: #94a3b8;
    font-size: 14px;
    line-height: 1.4;
  }
  label {
    display: block;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #94a3b8;
    margin-bottom: 6px;
  }
  input[type="password"] {
    width: 100%;
    padding: 11px 12px;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(2, 6, 23, 0.6);
    color: #f8fafc;
    font-size: 15px;
    outline: none;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  input[type="password"]:focus {
    border-color: #22d3ee;
    box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.18);
  }
  button {
    margin-top: 16px;
    width: 100%;
    padding: 11px 12px;
    border: 0;
    border-radius: 8px;
    background: linear-gradient(135deg, #22d3ee 0%, #6366f1 100%);
    color: #0b1220;
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
    transition: transform 80ms ease, opacity 120ms ease;
  }
  button:hover { opacity: 0.92; }
  button:active { transform: translateY(1px); }
  .error {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #fecaca;
    font-size: 13px;
  }
  .notice {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(34, 211, 238, 0.10);
    border: 1px solid rgba(34, 211, 238, 0.30);
    color: #a5f3fc;
    font-size: 13px;
  }
  .footer {
    margin-top: 18px;
    font-size: 12px;
    color: #64748b;
    text-align: center;
  }
</style>
</head>
<body>
<main class="card" role="main">
  <div class="logo">
    <span class="logo-mark" aria-hidden="true">S</span>
    <span>SportsMVP</span>
  </div>
  <h1>Preview Access</h1>
  <p class="lede">This is a private preview. Enter the access password to continue.</p>
  ${notice ? `<div class="notice" role="status">${notice}</div>` : ""}
  ${error ? `<div class="error" role="alert">${error}</div>` : ""}
  <form method="POST" action="${escapeHtml(PREVIEW_LOGIN_PATH)}" autocomplete="off">
    <input type="hidden" name="redirect" value="${redirect}" />
    <input type="text" name="username" value="preview" autocomplete="username" hidden aria-hidden="true" tabindex="-1" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autofocus required autocomplete="current-password" />
    <button type="submit">Enter preview</button>
  </form>
  <div class="footer">SportsMVP — Preview Access</div>
</main>
</body>
</html>`;
}

function sendLoginPage(
  res: import("express").Response,
  status: number,
  redirect: string,
  opts: { error?: string; notice?: string; setCookies?: string[] } = {},
): void {
  const html = renderPreviewLoginPage({
    redirect,
    error: opts.error,
    notice: opts.notice,
  });
  if (opts.setCookies && opts.setCookies.length > 0) {
    res.set("Set-Cookie", opts.setCookies);
  }
  res
    .status(status)
    .type("text/html")
    .set("Cache-Control", "no-store")
    .send(html);
}

function buildSetCookieHeader(value: string, isHttps: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_TTL_SECONDS}`,
  ];
  if (isHttps) parts.push("Secure");
  return parts.join("; ");
}

function buildClearCookieHeader(isHttps: boolean): string {
  // Mirror the Set-Cookie attributes used when the cookie was issued so the
  // browser actually overwrites/clears it. Differing only by Max-Age.
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isHttps) parts.push("Secure");
  return parts.join("; ");
}

function buildExpiredMarkerHeader(isHttps: boolean): string {
  // Short-lived, server-only marker. HttpOnly because nothing in the client
  // needs to read it; the server consumes and clears it on the next render
  // of the login page.
  const parts = [
    `${EXPIRED_MARKER_COOKIE}=1`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${EXPIRED_MARKER_TTL_SECONDS}`,
  ];
  if (isHttps) parts.push("Secure");
  return parts.join("; ");
}

function buildClearExpiredMarkerHeader(isHttps: boolean): string {
  const parts = [
    `${EXPIRED_MARKER_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isHttps) parts.push("Secure");
  return parts.join("; ");
}

function isHttpsRequest(req: IncomingMessage): boolean {
  const xfProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(xfProto) ? xfProto[0] : xfProto;
  if (proto && proto.split(",")[0].trim().toLowerCase() === "https") {
    return true;
  }
  // @ts-expect-error - socket.encrypted exists on TLSSocket
  return Boolean((req.socket && req.socket.encrypted) || false);
}

export function basicAuthMiddleware(): RequestHandler {
  return async (req, res, next) => {
    const expectedUser = process.env.SITE_BASIC_AUTH_USER;
    const expectedPass = process.env.SITE_BASIC_AUTH_PASS;

    // No-op when either env var is unset — clearing the secrets removes the
    // gate everywhere with no code change.
    if (!expectedUser || !expectedPass) return next();

    // Logout endpoint: always clears the cookie and bounces to the branded
    // login page, regardless of current cookie state. Sits above the cookie
    // validity / carve-out checks so signed-in visitors can sign out too.
    if (req.method === "POST" && req.path === PREVIEW_LOGOUT_PATH) {
      res.set("Set-Cookie", buildClearCookieHeader(isHttpsRequest(req)));
      res.set("Cache-Control", "no-store");
      res.redirect(303, PREVIEW_LOGIN_PATH);
      return;
    }

    if (isCarveOut(req.path)) return next();

    const cookies = parseCookieHeader(req.headers.cookie);
    const cookieValue = cookies[COOKIE_NAME];
    const cookieStatus: PreviewCookieStatus = cookieValue
      ? inspectPreviewCookie(cookieValue, expectedPass)
      : "invalid";
    if (cookieStatus === "valid") {
      return next();
    }
    const hasExpiredMarker = cookies[EXPIRED_MARKER_COOKIE] === "1";
    const isHttps = isHttpsRequest(req);

    // Branded login form submission.
    if (req.method === "POST" && req.path === PREVIEW_LOGIN_PATH) {
      let body = "";
      try {
        body = await readRequestBody(req, MAX_LOGIN_BODY_BYTES);
      } catch {
        sendLoginPage(res, 413, "/", { error: "Submission too large." });
        return;
      }
      const form = parseFormBody(body);
      const submittedPass = form.password ?? "";
      const redirect = safeRedirectTarget(form.redirect);
      if (constantTimeStringEqual(submittedPass, expectedPass)) {
        const value = makePreviewCookieValue(expectedPass);
        const setCookies = [buildSetCookieHeader(value, isHttps)];
        // Clear any lingering "expired" marker so the next page load doesn't
        // confusingly show the banner after a successful sign-in.
        if (hasExpiredMarker) {
          setCookies.push(buildClearExpiredMarkerHeader(isHttps));
        }
        res.set("Set-Cookie", setCookies);
        res.set("Cache-Control", "no-store");
        res.redirect(303, redirect);
        return;
      }
      // Wrong password takes precedence over the expired notice; clear the
      // marker so we don't double-display.
      const setCookies = hasExpiredMarker
        ? [buildClearExpiredMarkerHeader(isHttps)]
        : undefined;
      sendLoginPage(res, 401, redirect, {
        error: "Incorrect password. Please try again.",
        setCookies,
      });
      return;
    }

    // GET to the login path — show the form. If a one-shot expired marker is
    // present (set by the silent-bounce path below on a previous request),
    // surface the friendly notice and clear the marker.
    if (req.method === "GET" && req.path === PREVIEW_LOGIN_PATH) {
      const showExpiredNotice = hasExpiredMarker || cookieStatus === "expired";
      const setCookies: string[] = [];
      if (cookieStatus === "expired") {
        setCookies.push(buildClearCookieHeader(isHttps));
        setCookies.push(buildExpiredMarkerHeader(isHttps));
      }
      if (hasExpiredMarker) {
        setCookies.push(buildClearExpiredMarkerHeader(isHttps));
      }
      sendLoginPage(res, 200, "/", {
        notice: showExpiredNotice ? EXPIRED_SESSION_NOTICE : undefined,
        setCookies: setCookies.length > 0 ? setCookies : undefined,
      });
      return;
    }

    // Existing Basic Auth header path (kept for CLI / scripted clients).
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

    // Silent-bounce path. Three things to manage on the way out:
    //   1. Clear a stale auth cookie so the browser stops re-sending it.
    //   2. If the auth cookie was structurally valid but past `exp`, drop a
    //      short-lived marker so the next render of the login page can show
    //      a friendly "session expired" banner. Tampered/garbage cookies
    //      fall through silently (no marker, no banner) so we don't leak
    //      signal to attackers.
    //   3. CLI clients (curl/CI) keep the existing WWW-Authenticate flow
    //      with no banner — so the marker is browser-only.
    const isHtml = wantsHtml(req.headers.accept);
    const setCookies: string[] = [];
    if (cookieValue) {
      setCookies.push(buildClearCookieHeader(isHttps));
    }
    if (isHtml && cookieStatus === "expired") {
      setCookies.push(buildExpiredMarkerHeader(isHttps));
    } else if (isHtml && hasExpiredMarker) {
      // Marker is consumed in this same response.
      setCookies.push(buildClearExpiredMarkerHeader(isHttps));
    }

    if (isHtml) {
      // Browsers see the branded HTML page. Crucially we do NOT send a
      // WWW-Authenticate header here, which is what suppresses the native
      // browser Basic-Auth popup.
      const target =
        req.method === "GET" ? req.originalUrl || req.url || "/" : "/";
      const showExpiredNotice =
        cookieStatus === "expired" || hasExpiredMarker;
      sendLoginPage(res, 401, safeRedirectTarget(target), {
        notice: showExpiredNotice ? EXPIRED_SESSION_NOTICE : undefined,
        setCookies: setCookies.length > 0 ? setCookies : undefined,
      });
      return;
    }

    // CLI clients still get the standard Basic challenge so curl/CI keeps
    // working unchanged. No banner, no marker — behavior is identical to
    // before this change.
    if (setCookies.length > 0) {
      res.set("Set-Cookie", setCookies);
    }
    res.set("WWW-Authenticate", `Basic realm="${REALM}", charset="UTF-8"`);
    res.status(401).type("text/plain").send("Authentication required");
  };
}
