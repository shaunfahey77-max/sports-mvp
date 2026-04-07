import { getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';
import { logger } from './lib/logger';

/**
 * Manually processes a Stripe webhook event, updating our users table.
 * Uses Stripe signature verification when STRIPE_WEBHOOK_SECRET is set.
 */
export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const stripe = await getUncachableStripeClient();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: any;
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } else {
      // Dev mode: no signature verification
      event = JSON.parse(payload.toString('utf8'));
      logger.warn('Stripe webhook received without secret verification (dev mode)');
    }

    await WebhookHandlers.handleEvent(event);
  }

  static async handleEvent(event: any): Promise<void> {
    const { type, data } = event;
    logger.info({ type }, 'Stripe webhook event received');

    switch (type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = data.object;
        await WebhookHandlers.syncSubToDb(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = data.object;
        const user = await storage.getUserByStripeCustomerId(sub.customer as string);
        if (user) {
          await storage.updateUserStripe(user.clerkUserId, { tier: 'free', stripeSubscriptionId: undefined });
          logger.info({ clerkUserId: user.clerkUserId }, 'Tier reset to free after subscription deleted');
        }
        break;
      }
      case 'checkout.session.completed': {
        const session = data.object;
        if (session.mode === 'subscription' && session.subscription) {
          // Retrieve full subscription with product metadata
          const stripe = await getUncachableStripeClient();
          const sub = await stripe.subscriptions.retrieve(session.subscription as string, {
            expand: ['items.data.price.product'],
          });
          await WebhookHandlers.syncSubToDb(sub);
        }
        break;
      }
      default:
        // Ignore unhandled events
        break;
    }
  }

  private static async syncSubToDb(sub: any): Promise<void> {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    if (!customerId) return;

    const user = await storage.getUserByStripeCustomerId(customerId);
    if (!user) {
      // Try to find user by clerkUserId in subscription metadata
      const clerkUserId = sub.metadata?.clerkUserId;
      if (!clerkUserId) {
        logger.warn({ customerId }, 'No user found for Stripe customer');
        return;
      }
    }

    const isActive = ['active', 'trialing'].includes(sub.status);
    if (!isActive) {
      if (user) {
        await storage.updateUserStripe(user.clerkUserId, { tier: 'free' });
      }
      return;
    }

    // Determine tier from product metadata
    const item = sub.items?.data?.[0];
    const product = item?.price?.product;
    const tierMeta = (typeof product === 'object' ? product?.metadata?.tier : null) ?? sub.metadata?.tier;
    const tier = (tierMeta === 'mvp_pro' ? 'mvp_pro' : tierMeta === 'mvp' ? 'mvp' : 'free') as 'free' | 'mvp' | 'mvp_pro';

    if (user) {
      await storage.updateUserStripe(user.clerkUserId, { tier, stripeSubscriptionId: sub.id });
      logger.info({ clerkUserId: user.clerkUserId, tier }, 'Tier synced from webhook');
    }
  }
}
