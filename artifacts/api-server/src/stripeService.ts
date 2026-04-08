import { storage } from './storage';
import { getUncachableStripeClient, getStripePublishableKey } from './stripeClient';

export class StripeService {
  async getOrCreateCustomer(clerkUserId: string, email?: string) {
    const user = await storage.getUser(clerkUserId);
    if (user?.stripeCustomerId) return user.stripeCustomerId;

    const stripe = await getUncachableStripeClient();
    const customer = await stripe.customers.create({
      email,
      metadata: { clerkUserId },
    });

    await storage.updateUserStripe(clerkUserId, { stripeCustomerId: customer.id });
    return customer.id;
  }

  async createCheckoutSession(clerkUserId: string, email: string | undefined, priceId: string, baseUrl: string) {
    const stripe = await getUncachableStripeClient();
    const customerId = await this.getOrCreateCustomer(clerkUserId, email);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      subscription_data: {
        metadata: {
          clerkUserId,
        },
      },
      success_url: `${baseUrl}/account?checkout=success`,
      cancel_url: `${baseUrl}/subscribe`,
    });

    return session.url;
  }

  async createPortalSession(clerkUserId: string, baseUrl: string) {
    const stripe = await getUncachableStripeClient();
    const user = await storage.getUser(clerkUserId);
    if (!user?.stripeCustomerId) throw new Error('No Stripe customer found');

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${baseUrl}/account`,
    });

    return session.url;
  }

  async getPublishableKey() {
    return getStripePublishableKey();
  }

  /**
   * Syncs the user's tier from Stripe by querying active subscriptions directly.
   * Reads the product metadata.tier field to determine tier.
   */
  async syncSubscriptionTier(clerkUserId: string): Promise<'free' | 'mvp' | 'mvp_pro'> {
    const user = await storage.getUser(clerkUserId);
    // If no Stripe customer, trust the DB tier (may have been manually set)
    if (!user?.stripeCustomerId) return (user?.tier ?? 'free') as 'free' | 'mvp' | 'mvp_pro';

    try {
      const stripe = await getUncachableStripeClient();
      const subs = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: 'active',
        limit: 1,
        expand: ['data.items.data.price.product'],
      });

      const activeSub = subs.data[0];
      if (!activeSub) {
        // Also check trialing
        const trialSubs = await stripe.subscriptions.list({
          customer: user.stripeCustomerId,
          status: 'trialing',
          limit: 1,
          expand: ['data.items.data.price.product'],
        });
        const trialSub = trialSubs.data[0];
        if (!trialSub) {
          // No active subscription — trust DB tier rather than forcing downgrade
          return (user.tier ?? 'free') as 'free' | 'mvp' | 'mvp_pro';
        }
        return this._extractTierFromSub(clerkUserId, trialSub);
      }

      return this._extractTierFromSub(clerkUserId, activeSub);
    } catch {
      return user.tier ?? 'free';
    }
  }

  private async _extractTierFromSub(clerkUserId: string, sub: any): Promise<'free' | 'mvp' | 'mvp_pro'> {
    const product = sub.items?.data?.[0]?.price?.product;
    const tierMeta = (product?.metadata?.tier ?? sub.metadata?.tier) as string | undefined;
    const tier = (tierMeta === 'mvp_pro' ? 'mvp_pro' : tierMeta === 'mvp' ? 'mvp' : 'free') as 'free' | 'mvp' | 'mvp_pro';
    await storage.updateUserStripe(clerkUserId, { tier, stripeSubscriptionId: sub.id });
    return tier;
  }
}

export const stripeService = new StripeService();
