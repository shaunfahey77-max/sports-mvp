-- Migration 0004: Open-beta waitlist captures (Task #46 — convert June 1
-- launch to Open Beta). Populated by `POST /api/waitlist` from the
-- Subscribe page + Landing membership card while the platform is in
-- open beta. Drained into the Stripe checkout funnel on day 1 of paid
-- launch — see `.local/beta-mode-runbook.md`.
--
-- Email is normalized to lowercase before insert and protected by a
-- unique index so repeat submissions are idempotent (the storage layer
-- uses ON CONFLICT DO UPDATE to refresh attribution fields without
-- creating duplicate rows). `clerk_user_id` is captured when the
-- submitter happens to already be signed in but is not required —
-- anonymous submissions are accepted to keep the friction surface
-- minimal during beta. `source` is a free-form attribution token
-- (e.g. 'subscribe_page', 'landing_membership') so the team can see
-- which surface drove signups when the waitlist is later analyzed.
--
-- Safe to re-run on a database that already has the objects:
-- IF NOT EXISTS on every statement.

CREATE TABLE IF NOT EXISTS "waitlist_signups" (
        "id" serial PRIMARY KEY NOT NULL,
        "email" text NOT NULL,
        "clerk_user_id" text,
        "source" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_signups_email_idx"
        ON "waitlist_signups" USING btree ("email");
