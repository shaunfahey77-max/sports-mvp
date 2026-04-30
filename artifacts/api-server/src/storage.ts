import { eq, sql } from 'drizzle-orm';
import { db } from '@workspace/db';
import { users, waitlistSignups } from '@workspace/db';

export class Storage {
  async getUser(clerkUserId: string) {
    const [user] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId));
    return user ?? null;
  }

  async upsertUser(data: { clerkUserId: string; email?: string }) {
    const [user] = await db
      .insert(users)
      .values({ id: data.clerkUserId, clerkUserId: data.clerkUserId, email: data.email })
      .onConflictDoUpdate({
        target: users.clerkUserId,
        set: { email: data.email, updatedAt: new Date() },
      })
      .returning();
    return user;
  }

  async updateUserStripe(clerkUserId: string, patch: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    tier?: 'free' | 'mvp' | 'mvp_pro';
  }) {
    const [user] = await db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.clerkUserId, clerkUserId))
      .returning();
    return user;
  }

  async getUserByStripeCustomerId(customerId: string) {
    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
    return user ?? null;
  }

  async getUserByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user ?? null;
  }

  async updateUserTierByEmail(email: string, tier: 'free' | 'mvp' | 'mvp_pro') {
    const [user] = await db
      .update(users)
      .set({ tier, updatedAt: new Date() })
      .where(eq(users.email, email))
      .returning();
    return user ?? null;
  }

  /**
   * Idempotent waitlist insert. Email is normalized to lowercase before
   * upsert and de-duped against the unique index. Repeated signups update
   * the optional attribution fields (clerkUserId, source) so we keep the
   * most-recent context, but never create duplicate rows. Returns the
   * persisted row regardless of insert vs update.
   */
  async addWaitlistSignup(input: {
    email: string;
    clerkUserId?: string | null;
    source?: string | null;
  }) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const [row] = await db
      .insert(waitlistSignups)
      .values({
        email: normalizedEmail,
        clerkUserId: input.clerkUserId ?? null,
        source: input.source ?? null,
      })
      .onConflictDoUpdate({
        target: waitlistSignups.email,
        set: {
          // Refresh attribution if we have a stronger signal this time
          // (e.g. an anonymous signup later happens while signed in).
          clerkUserId: sql`COALESCE(${waitlistSignups.clerkUserId}, EXCLUDED.clerk_user_id)`,
          source: sql`COALESCE(EXCLUDED.source, ${waitlistSignups.source})`,
        },
      })
      .returning();
    return row;
  }
}

export const storage = new Storage();
