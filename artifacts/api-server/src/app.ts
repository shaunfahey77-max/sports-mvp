import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import { basicAuthMiddleware } from "./middlewares/basicAuthMiddleware";
import { WebhookHandlers } from "./webhookHandlers";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Disable Express ETags — prevents 304 stale caching on API responses
app.set("etag", false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);

// Basic Auth gate — sits above all other public-facing handlers. No-op
// when SITE_BASIC_AUTH_USER/PASS are unset; carves out admin, snapshots,
// stripe webhook, health, and the Clerk proxy so internal jobs and
// webhooks keep working unchanged. See basicAuthMiddleware.ts for details.
app.use(basicAuthMiddleware());

// Clerk proxy — must be before body parsers
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Stripe webhook — must be before express.json() so body stays as Buffer
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res): Promise<void> => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      res.status(400).json({ error: 'Missing stripe-signature' });
      return;
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: unknown) {
      logger.error({ err }, 'Stripe webhook error');
      res.status(400).json({ error: 'Webhook error' });
    }
  }
);

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(clerkMiddleware());

app.use("/api", router);

// SPA shell + static assets.
//
// Why this lives inside the api-server: in production, Replit's autoscale
// would otherwise serve the sports-mvp build from a platform-level static
// layer that sits ABOVE this Node process. That layer never invokes the
// basicAuthMiddleware above, leaving the public site (sportsmvp.net,
// *.replit.app) ungated even when SITE_BASIC_AUTH_USER/PASS are set.
// Serving the shell from Express puts every request — including `/`,
// `/picks`, `/performance`, `/assets/*` — behind the same gate.
//
// All carve-outs (admin, snapshots, health, Stripe webhook, Clerk proxy)
// are still honored because basicAuthMiddleware runs first; clearing
// either secret turns the gate off project-wide with no code change.
//
// Path resolution: this module is bundled to dist/index.mjs at
// artifacts/api-server/dist/index.mjs. The sports-mvp Vite build outputs
// to artifacts/sports-mvp/dist/public/ (see vite.config.ts `outDir`). The
// deploy build (.replit [deployment].build) is responsible for producing
// it. If the directory is absent (e.g. dev runs that only start the API)
// the handlers no-op so the dev workflow stays unaffected.
const __apiServerDir = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(
  __apiServerDir,
  "../../sports-mvp/dist/public",
);
const FRONTEND_INDEX = path.join(FRONTEND_DIST, "index.html");

if (existsSync(FRONTEND_INDEX)) {
  // Hashed assets — safe for long cache.
  app.use(
    "/assets",
    express.static(path.join(FRONTEND_DIST, "assets"), {
      immutable: true,
      maxAge: "1y",
      fallthrough: true,
    }),
  );

  // Other static files at the root (favicon, robots, public/*). The shell
  // itself is served by the SPA fallback below so we can force no-store.
  app.use(
    express.static(FRONTEND_DIST, {
      index: false,
      maxAge: 0,
      setHeaders(res) {
        res.setHeader("Cache-Control", "no-store");
      },
    }),
  );

  // SPA fallback. Never intercept /api/* (already handled above; missing
  // routes should still 404 as JSON, not as the React shell). Only GET/HEAD
  // for HTML navigations — POST/PUT/etc. on a missing path should 404.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api/") || req.path === "/api") return next();
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(FRONTEND_INDEX);
  });

  logger.info({ FRONTEND_DIST }, "Serving SPA shell from api-server");
} else {
  logger.warn(
    { FRONTEND_DIST },
    "SPA build not found — api-server will not serve the frontend (dev mode)",
  );
}

export default app;
