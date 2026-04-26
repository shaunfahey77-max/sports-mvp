import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { createHmac, timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/**
 * Public-site preview gate for the SPA shell and static assets. Activated
 * only when both SITE_BASIC_AUTH_USER and SITE_BASIC_AUTH_PASS are present
 * in the environment. When either is unset the middleware is a no-op, so
 * the gate is fully reversible by clearing the secrets.
 *
 * Mirrors the api-server middleware (artifacts/api-server/src/middlewares/
 * basicAuthMiddleware.ts) so a single shared credential gates both
 * surfaces. The Vite layer has no carve-outs because it only serves the
 * SPA shell — internal API/webhook carve-outs live on the API side.
 *
 * Browser/HTML clients see a branded HTML login page; CLI clients fall
 * back to the standard `WWW-Authenticate: Basic` challenge so curl / CI
 * keep working. A signed `preview_auth` cookie skips the prompt on
 * subsequent requests.
 */
function siteBasicAuthPlugin(): Plugin {
  const REALM = "Restricted";
  const COOKIE_NAME = "preview_auth";
  const COOKIE_TTL_SECONDS = 8 * 60 * 60; // 8 hours
  const PREVIEW_LOGIN_PATH = "/__preview/login";
  const MAX_LOGIN_BODY_BYTES = 4 * 1024;

  function constantTimeStringEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    const len = Math.max(aBuf.length, bBuf.length, 1);
    const aPad = Buffer.alloc(len);
    const bPad = Buffer.alloc(len);
    aBuf.copy(aPad);
    bBuf.copy(bPad);
    const equal = timingSafeEqual(aPad, bPad);
    return equal && aBuf.length === bBuf.length;
  }

  function timingSafeStringEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  function deriveCookieKey(password: string): Buffer {
    return createHmac("sha256", "sportsmvp.preview_auth.v1")
      .update(password, "utf8")
      .digest();
  }

  function signPayload(payload: string, key: Buffer): string {
    return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
  }

  function makeCookieValue(password: string): string {
    const exp = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
    const payload = Buffer.from(JSON.stringify({ exp }), "utf8").toString(
      "base64url",
    );
    const sig = signPayload(payload, deriveCookieKey(password));
    return `${payload}.${sig}`;
  }

  function verifyCookie(value: string, password: string): boolean {
    if (!value) return false;
    const dot = value.indexOf(".");
    if (dot === -1) return false;
    const payloadB64 = value.slice(0, dot);
    const sig = value.slice(dot + 1);
    if (!payloadB64 || !sig) return false;
    const expected = signPayload(payloadB64, deriveCookieKey(password));
    if (!timingSafeStringEqual(sig, expected)) return false;
    let payload: unknown;
    try {
      payload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf8"),
      );
    } catch {
      return false;
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as { exp?: unknown }).exp !== "number"
    ) {
      return false;
    }
    return (payload as { exp: number }).exp > Math.floor(Date.now() / 1000);
  }

  function parseCookieHeader(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const name = part.slice(0, eq).trim();
      if (!name) continue;
      let value = part.slice(eq + 1).trim();
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
      try {
        const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
        const val = decodeURIComponent(rawVal.replace(/\+/g, " "));
        if (key) out[key] = val;
      } catch {
        // skip malformed pair
      }
    }
    return out;
  }

  function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
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
    return accept.includes("text/html");
  }

  function safeRedirectTarget(input: string | undefined): string {
    if (!input) return "/";
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

  function renderLoginPage(
    loginPathRaw: string,
    redirectRaw: string,
    error?: string,
  ): string {
    const formAction = escapeHtml(loginPathRaw);
    const redirect = escapeHtml(safeRedirectTarget(redirectRaw));
    const errorHtml = error ? escapeHtml(error) : "";
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
  h1 { font-size: 20px; margin: 0 0 6px; font-weight: 600; color: #f8fafc; }
  p.lede { margin: 0 0 20px; color: #94a3b8; font-size: 14px; line-height: 1.4; }
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
  ${errorHtml ? `<div class="error" role="alert">${errorHtml}</div>` : ""}
  <form method="POST" action="${formAction}" autocomplete="off">
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
    res: ServerResponse,
    status: number,
    loginPath: string,
    redirect: string,
    error?: string,
  ): void {
    const html = renderLoginPage(loginPath, redirect, error);
    res.statusCode = status;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(html);
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

  function buildClearCookieHeader(): string {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  function pathOf(req: IncomingMessage): string {
    const url = req.url || "/";
    const qIdx = url.indexOf("?");
    return qIdx === -1 ? url : url.slice(0, qIdx);
  }

  // The Replit proxy may pass through a path prefix (e.g. `/sports-mvp/...`)
  // that does not match Vite's configured `base`. Detect it from the request
  // URL so the form `action` and `redirect` targets stay consistent with
  // however the user reached the page.
  function loginPathInfo(reqPath: string): {
    isLogin: boolean;
    prefix: string;
    loginPath: string;
    defaultRedirect: string;
  } {
    let prefix = "";
    let isLogin = false;
    if (reqPath === PREVIEW_LOGIN_PATH) {
      isLogin = true;
    } else if (reqPath.endsWith(PREVIEW_LOGIN_PATH)) {
      isLogin = true;
      prefix = reqPath.slice(0, reqPath.length - PREVIEW_LOGIN_PATH.length);
    }
    return {
      isLogin,
      prefix,
      loginPath: `${prefix}${PREVIEW_LOGIN_PATH}`,
      defaultRedirect: prefix ? `${prefix}/` : "/",
    };
  }

  function inferPrefixFromRequest(reqPath: string): string {
    // Use BASE_PATH when meaningful; otherwise sniff a single leading
    // segment from the request URL as the proxy-added prefix. This keeps the
    // form action correct whether the SPA is reached via `/` or `/<slug>/`.
    const basePath = process.env.BASE_PATH || "/";
    if (basePath !== "/" && reqPath.startsWith(basePath)) {
      const trimmed = basePath.endsWith("/")
        ? basePath.slice(0, -1)
        : basePath;
      return trimmed;
    }
    // Heuristic: if the request URL has a single leading segment that looks
    // like a slug (not the SPA's own asset paths), use it as the prefix.
    const m = reqPath.match(/^\/([A-Za-z0-9_\-]+)(\/.*)?$/);
    if (m) {
      const seg = m[1];
      // Exclude paths Vite serves natively at the top level so we don't
      // accidentally double-prefix things like `/src/...` or `/@vite/...`.
      const native = new Set([
        "src",
        "node_modules",
        "@vite",
        "@id",
        "@fs",
        "@react-refresh",
        "__vite_ping",
        "__open-in-editor",
        "__preview",
      ]);
      if (!native.has(seg)) return `/${seg}`;
    }
    return "";
  }

  async function handler(
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> {
    const expectedUser = process.env.SITE_BASIC_AUTH_USER;
    const expectedPass = process.env.SITE_BASIC_AUTH_PASS;

    if (!expectedUser || !expectedPass) {
      next();
      return;
    }

    const cookies = parseCookieHeader(req.headers.cookie);
    const cookieValue = cookies[COOKIE_NAME];
    if (cookieValue && verifyCookie(cookieValue, expectedPass)) {
      next();
      return;
    }

    const reqPath = pathOf(req);
    const loginInfo = loginPathInfo(reqPath);

    if (req.method === "POST" && loginInfo.isLogin) {
      let body = "";
      try {
        body = await readBody(req, MAX_LOGIN_BODY_BYTES);
      } catch {
        sendLoginPage(res, 413, loginInfo.loginPath, loginInfo.defaultRedirect, "Submission too large.");
        return;
      }
      const form = parseFormBody(body);
      const submittedPass = form.password ?? "";
      const redirect = safeRedirectTarget(form.redirect) === "/"
        ? loginInfo.defaultRedirect
        : safeRedirectTarget(form.redirect);
      if (constantTimeStringEqual(submittedPass, expectedPass)) {
        const value = makeCookieValue(expectedPass);
        res.setHeader("Set-Cookie", buildSetCookieHeader(value, isHttpsRequest(req)));
        res.setHeader("Cache-Control", "no-store");
        res.statusCode = 303;
        res.setHeader("Location", redirect);
        res.end();
        return;
      }
      sendLoginPage(res, 401, loginInfo.loginPath, redirect, "Incorrect password. Please try again.");
      return;
    }

    if (req.method === "GET" && loginInfo.isLogin) {
      sendLoginPage(res, 200, loginInfo.loginPath, loginInfo.defaultRedirect);
      return;
    }

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
          next();
          return;
        }
      }
    }

    if (cookieValue) {
      res.setHeader("Set-Cookie", buildClearCookieHeader());
    }

    if (wantsHtml(req.headers.accept)) {
      const prefix = inferPrefixFromRequest(reqPath);
      const formAction = `${prefix}${PREVIEW_LOGIN_PATH}`;
      const target = req.method === "GET" ? req.url || "/" : prefix ? `${prefix}/` : "/";
      sendLoginPage(res, 401, formAction, safeRedirectTarget(target));
      return;
    }

    res.setHeader(
      "WWW-Authenticate",
      `Basic realm="${REALM}", charset="UTF-8"`,
    );
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Authentication required");
  }

  return {
    name: "site-basic-auth",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handler(req, res, next).catch((err) => next(err));
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        handler(req, res, next).catch((err) => next(err));
      });
    },
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    siteBasicAuthPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
