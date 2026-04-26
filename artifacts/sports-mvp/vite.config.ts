import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/**
 * HTTP Basic Auth gate for the SPA shell and static assets. Activated only
 * when both SITE_BASIC_AUTH_USER and SITE_BASIC_AUTH_PASS are present in
 * the environment. When either is unset the middleware is a no-op, so the
 * gate is fully reversible by clearing the secrets.
 *
 * Mirrors the api-server middleware (artifacts/api-server/src/middlewares/
 * basicAuthMiddleware.ts) so a single shared credential gates both
 * surfaces. The Vite layer has no carve-outs because it only serves the
 * SPA shell — internal API/webhook carve-outs live on the API side.
 */
function siteBasicAuthPlugin(): Plugin {
  const REALM = "Restricted";

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

  function handler(
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): void {
    const expectedUser = process.env.SITE_BASIC_AUTH_USER;
    const expectedPass = process.env.SITE_BASIC_AUTH_PASS;

    if (!expectedUser || !expectedPass) {
      next();
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
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
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
