import { eq } from 'drizzle-orm';
import { db } from '@workspace/db';
import { users } from '@workspace/db';

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
}

export const storage = new Storage();
