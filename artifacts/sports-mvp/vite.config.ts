import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import {
  PREVIEW_LOGIN_PATH,
  PREVIEW_LOGOUT_PATH,
  handlePreviewGate,
  type PreviewGateAdapterContext,
} from "@workspace/preview-gate";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/**
 * Public-site preview gate for the SPA shell and static assets (Vite
 * surface). Activated only when both SITE_BASIC_AUTH_USER and
 * SITE_BASIC_AUTH_PASS are present in the environment. When either is unset
 * the middleware is a no-op, so the gate is fully reversible by clearing
 * the secrets.
 *
 * The gate's behavior — cookie signing/verification, branded HTML login
 * page, login + logout handling, Basic-Auth fallback, the "session expired"
 * UX — lives in the shared `@workspace/preview-gate` package so this Vite
 * plugin and the api-server middleware (`artifacts/api-server/src/middlewares/
 * basicAuthMiddleware.ts`) stay in lockstep. This file only owns the
 * Vite-specific glue: there are no carve-outs (the SPA surface only serves
 * the shell), and the proxy may inject a path prefix (e.g. `/sports-mvp/...`)
 * that we sniff so the form `action` and `redirect` targets stay consistent
 * with however the user reached the page.
 */
function siteBasicAuthPlugin(): Plugin {
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

  function logoutPathInfo(reqPath: string): {
    isLogout: boolean;
    prefix: string;
    loginPath: string;
  } {
    let prefix = "";
    let isLogout = false;
    if (reqPath === PREVIEW_LOGOUT_PATH) {
      isLogout = true;
    } else if (reqPath.endsWith(PREVIEW_LOGOUT_PATH)) {
      isLogout = true;
      prefix = reqPath.slice(0, reqPath.length - PREVIEW_LOGOUT_PATH.length);
    }
    return {
      isLogout,
      prefix,
      loginPath: `${prefix}${PREVIEW_LOGIN_PATH}`,
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

  function adapter(
    req: IncomingMessage,
    reqPath: string,
  ): PreviewGateAdapterContext {
    const loginInfo = loginPathInfo(reqPath);
    const logoutInfo = logoutPathInfo(reqPath);

    let loginFormPath: string;
    let defaultRedirect: string;
    if (loginInfo.isLogin) {
      loginFormPath = loginInfo.loginPath;
      defaultRedirect = loginInfo.defaultRedirect;
    } else if (logoutInfo.isLogout) {
      loginFormPath = logoutInfo.loginPath;
      defaultRedirect = logoutInfo.prefix ? `${logoutInfo.prefix}/` : "/";
    } else {
      const prefix = inferPrefixFromRequest(reqPath);
      loginFormPath = `${prefix}${PREVIEW_LOGIN_PATH}`;
      defaultRedirect = prefix ? `${prefix}/` : "/";
    }

    const silentBounceTarget =
      req.method === "GET" ? req.url || "/" : defaultRedirect;

    return {
      // The Vite surface has no carve-outs; only the SPA shell is served
      // here, all internal API/webhook carve-outs live on the API side.
      isCarveOut: false,
      isLoginPath: loginInfo.isLogin,
      isLogoutPath: logoutInfo.isLogout,
      loginFormPath,
      defaultRedirect,
      silentBounceTarget,
    };
  }

  function handler(
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> {
    return handlePreviewGate(req, res, next, adapter);
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

// Build-time flag the SPA reads to decide whether to render the preview-gate
// "Sign out" affordance. True only when the gate is actually configured, so
// it disappears automatically the moment the secrets are cleared.
const previewGateEnabled = Boolean(
  process.env.SITE_BASIC_AUTH_USER && process.env.SITE_BASIC_AUTH_PASS,
);

export default defineConfig({
  base: basePath,
  define: {
    __PREVIEW_GATE_ENABLED__: JSON.stringify(previewGateEnabled),
  },
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
