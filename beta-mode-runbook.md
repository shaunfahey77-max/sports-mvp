# Beta-Mode Runbook

**Owner:** SportsMVP launch ops
**Created:** 2026-04-30 (Task #46 — Convert June 1 launch to Open Beta)
**Companion docs:**
- `.local/launch-readiness-memo-2026-04-30.md` (decision context)
- `.local/launch-market-state.md` (per-market posture, source of truth)
- `.local/tasks/task-46.md` (implementation spec)

---

## What is "beta mode"?

A single env-var flag — **`BETA_MODE`** — gates the entire open-beta posture
on the SportsMVP API server.

| Value (case-insensitive)       | Posture |
| ------------------------------ | ------- |
| `true`, `1`, `on`, `yes`       | **Open Beta ON** — paid acquisition paused, waitlist surfaces shown |
| anything else, or **unset**    | depends on default |
| **default when unset**         | **ON** (we are launching INTO open beta) |

The flag is read per-request by the server, so flipping it does **not**
require a code change — only a deploy-environment update + restart.

### What flips with the flag

| Surface                                                | OFF (paid live)             | ON (open beta)                                                |
| ------------------------------------------------------ | --------------------------- | ------------------------------------------------------------- |
| `GET  /api/stripe/prices`                              | Returns Members ($19.99)    | Filters out `mvp` (and `mvp_pro`) → empty list                |
| `POST /api/stripe/checkout` for an `mvp` priceId       | 200 → Stripe checkout URL   | **410 `blocked_tier`**                                        |
| `POST /api/stripe/checkout` for `mvp_pro` (any time)   | 410 `blocked_tier`          | 410 `blocked_tier`                                            |
| `POST /api/stripe/portal`                              | 200 → Stripe Billing Portal | **200 → Stripe Billing Portal** (UNCHANGED — existing subs)  |
| Stripe webhook (`/api/stripe/webhook`)                 | normal sync                 | **normal sync** (UNCHANGED)                                   |
| Subscribe page                                         | Free + Members ($19.99)     | Free + **Coming Soon waitlist card**                          |
| Landing membership section                             | "Become a Member" $19.99    | **"Coming Soon — Join the Waitlist"**                         |
| Navigation upgrade button (free user, signed in)       | "Upgrade"                   | **"Join Waitlist"** (still routes to /subscribe)              |
| Account page upgrade button (free user)                | "Upgrade to MVP"            | **"Join the Waitlist"**                                       |
| Dashboard upgrade banner / inline free-tier banner     | "Upgrade to MVP"            | **"Join the Waitlist"** + open-beta framing                   |
| Account page "Manage Subscription" (existing sub)      | Stripe portal               | **Stripe portal** (UNCHANGED)                                 |
| Pick gating (`isMvp ? allPicks : allPicks.slice(0,1)`) | unchanged                   | **unchanged** — existing MVP subscribers see full slate       |

### What does NOT flip with the flag

- Model, calibration, scoring, or per-market gating (`MARKET_DISABLED`,
  `MARKET_MODEL_WATCH_ONLY`). Those live in `scoringModelConfig.ts` and
  are governed by their own promotion process.
- Cron paths, settlement, CLV writeback, `/api/performance`,
  `/api/picks`, `/api/snapshots`, or any data path.
- Tier display, tier color, tier icons. An existing MVP / MVP Pro
  subscriber sees their existing tier badge regardless of beta mode.
- Stripe webhook handlers, tier sync, or Customer creation. New free
  signups still get a Stripe customer record on first `/user/me` read.

---

## Flipping beta OFF (opening paid)

This is what you do on Day 1 of paid launch — i.e. when at least one
market has been Official-promoted and has 30 days of clean public
record (the trigger written on the waitlist surface).

### Pre-flip checklist

1. ☐ Verify the promotion trigger is met:
   - At least one market in `MARKET_MODEL_WATCH_ONLY` has been promoted
     to Official (i.e. removed from both `MARKET_DISABLED` and
     `MARKET_MODEL_WATCH_ONLY` in `scoringModelConfig.ts`).
   - That market has 30 calendar days of `scored_picks` with public
     grading and acceptable performance — confirm via
     `/api/performance?window=30`.
2. ☐ Confirm Stripe products and prices are active:
   - `stripe products list --active=true` shows the SportsMVP product
     with `metadata.tier = "mvp"`.
   - At least one monthly + one yearly recurring price are active.
3. ☐ Decide on waitlist drainage plan (see §"Waitlist drainage" below).

### Flip steps

1. In the deploy environment (Replit Secrets for the API Server
   workflow): set `BETA_MODE=false`.
2. Restart the `artifacts/api-server: API Server` workflow.
3. Smoke-test from an incognito window:
   - `curl https://<host>/api/config/launch` → `{ "betaMode": false, ... }`
   - `curl https://<host>/api/stripe/prices` → product list now includes
     the `mvp` product with monthly + yearly prices.
   - Visit `/subscribe` → renders the original two-card paid layout
     ("Members" with $19.99 + "Get Members" button).
   - Visit `/` → Landing membership section shows "$19.99 / mo" and
     "Become a Member".
4. Sign in as a test free user → Navigation shows "Upgrade", Dashboard
   upgrade banner says "Upgrade to MVP — $19.99/mo".
5. Sign in as an existing MVP test user → Account page still shows
   "Manage Subscription" → Stripe portal works (this should be
   unchanged from before the flip; verify nothing regressed).
6. End-to-end checkout test on a real Stripe test customer:
   - `/subscribe` → click "Get Members" → land on Stripe Checkout
     → complete with 4242 4242 4242 4242 → redirects back → tier
     becomes `mvp` after webhook.

### Rollback

If anything goes wrong after the flip, set `BETA_MODE=true` (or
unset it entirely) and restart the API Server workflow. Existing
checkouts that completed before the rollback remain valid; their
subscriptions are managed via the Stripe portal as normal.

---

## Waitlist drainage

The waitlist lives in the `waitlist_signups` table (PostgreSQL).
Schema:

```sql
waitlist_signups (
  id            serial primary key,
  email         text not null,             -- normalized lowercase, unique
  clerk_user_id text,                      -- nullable; set if signed in
  source        text,                      -- e.g. 'subscribe_page'
  created_at    timestamp not null default now()
)
```

### Day-1 announcement query

```sql
SELECT email, source, created_at
FROM waitlist_signups
ORDER BY created_at ASC;
```

Pipe to your transactional email provider (or a one-off Postmark /
Resend send). One canonical email at launch — no marketing follow-ups
(this is what we promised on the form).

### Recommended day-1 message

> Subject: Paid Membership is open — your invite from SportsMVP
>
> Body: brief recap of which market(s) cleared Official + 30 days,
> link to `/subscribe`, link to `/performance` for the public record.

### Optional: pre-fill checkout for waitlist members

If you want to attribute conversions back to the waitlist:

1. Add a `?from=waitlist` UTM-style query param to the `/subscribe`
   link in the launch email.
2. Read the param on the Subscribe page and pass it through to the
   `/api/stripe/checkout` body as a metadata field on the checkout
   session (Stripe will surface it on the resulting subscription).

This is **not** required for the basic flip-off; it's a follow-up
optimization.

---

## Verifying beta-mode is actually ON

Quick browser check while in dev or production:

```sh
curl -s "https://<host>/api/config/launch" | jq .
# expect: {"betaMode":true,"promotionTrigger":"Paid Membership opens when..."}
```

UI-only check: visit `/subscribe` while signed out — you should see the
"Coming Soon" badge on the Members card and an email input instead of
a Stripe button.

If the API returns `betaMode:true` but the UI shows the paid view, the
client likely has a stale cache — hard-refresh (or clear the
`launchConfig` React Query entry).
