import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const tierEnum = pgEnum("user_tier", ["free", "mvp", "mvp_pro"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  clerkUserId: text("clerk_user_id").unique().notNull(),
  email: text("email"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  tier: tierEnum("tier").default("free").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
