import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Open-beta waitlist captures. Populated by `POST /api/waitlist` from
 * the Subscribe / Landing waitlist surfaces while the platform is in
 * open beta. Drained into the Stripe checkout funnel on day 1 of paid
 * launch — see `beta-mode-runbook.md` (project root, mirror at
 * `.local/beta-mode-runbook.md`).
 *
 * Email is normalized to lowercase before insert and unique-indexed so
 * repeat submissions are idempotent. `clerkUserId` is captured when the
 * submitter happens to already be signed in (useful for attribution and
 * for sending the launch announcement through the in-app notification
 * surface) but is not required — the form accepts anonymous submissions
 * to keep the friction surface minimal during beta.
 *
 * `source` is a free-form attribution token (e.g. 'landing_membership',
 * 'subscribe_page', 'dashboard_banner') so the team can see which
 * surface drove signups when the waitlist is later analyzed. Optional.
 */
export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    clerkUserId: text("clerk_user_id"),
    source: text("source"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex("waitlist_signups_email_idx").on(table.email),
  }),
);
