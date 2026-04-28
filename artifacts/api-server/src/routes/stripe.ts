import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { storage } from '../storage';
import { stripeService } from '../stripeService';
import { getUncachableStripeClient } from '../stripeClient';

const router = Router();

/**
 * Tiers that may not be acquired by new checkouts. Backend continues to
 * recognize these tiers on existing subscriptions (account display, webhook
 * sync, etc.) but they are removed from the public price list and rejected
 * by the checkout endpoint. As of the launch-polish pass, mvp_pro ($39.99
 * "Inner Circle") is the only blocked tier — sales of it are retired.
 */
const BLOCKED_TIERS_FOR_NEW_CHECKOUT = new Set(['mvp_pro']);

function getBaseUrl(req: any): string {
  const domain = process.env.REPLIT_DOMAINS?.split(',')[0];
  if (domain) return `https://${domain}/sports-mvp`;
  return `${req.protocol}://${req.get('host')}/sports-mvp`;
}

router.get('/stripe/prices', async (_req, res) => {
  try {
    const stripe = await getUncachableStripeClient();

    const [productsRes, pricesRes] = await Promise.all([
      stripe.products.list({ active: true, limit: 20 }),
      stripe.prices.list({ active: true, limit: 50, expand: ['data.product'] }),
    ]);

    // Only include SportsMVP products (they have a tier metadata field)
    // and exclude any tier retired from new acquisition.
    const sportProducts = productsRes.data.filter(
      p => p.metadata?.tier && !BLOCKED_TIERS_FOR_NEW_CHECKOUT.has(p.metadata.tier)
    );

    const productMap = new Map<string, any>();
    for (const p of sportProducts) {
      productMap.set(p.id, {
        id: p.id,
        name: p.name,
        description: p.description,
        metadata: p.metadata,
        prices: [],
      });
    }

    for (const price of pricesRes.data) {
      const productId = typeof price.product === 'string' ? price.product : price.product?.id;
      if (!productId || !productMap.has(productId)) continue;
      productMap.get(productId)!.prices.push({
        id: price.id,
        unitAmount: price.unit_amount,
        currency: price.currency,
        recurring: price.recurring,
      });
    }

    // Sort prices: monthly before yearly
    for (const product of productMap.values()) {
      product.prices.sort((a: any, b: any) => (a.unitAmount ?? 0) - (b.unitAmount ?? 0));
    }

    return res.json({ products: Array.from(productMap.values()) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/stripe/checkout', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { priceId } = req.body as { priceId: string };
  if (!priceId) return res.status(400).json({ error: 'priceId required' });

  try {
    // Reject any priceId whose product belongs to a tier retired from new
    // acquisition. This is the server-side gate that backstops the public
    // price list filter — a client posting a known-but-blocked priceId
    // (e.g. a saved bookmark for the old mvp_pro plan) cannot create a
    // checkout session for it.
    const stripe = await getUncachableStripeClient();
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    const product = typeof price.product === 'object' && price.product && !('deleted' in price.product)
      ? price.product
      : null;
    const tier = product?.metadata?.tier;
    if (tier && BLOCKED_TIERS_FOR_NEW_CHECKOUT.has(tier)) {
      return res.status(410).json({ error: 'This plan is no longer available for new subscriptions.' });
    }

    const user = await storage.getUser(userId);
    const url = await stripeService.createCheckoutSession(userId, user?.email ?? undefined, priceId, getBaseUrl(req));
    return res.json({ url });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/stripe/portal', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const url = await stripeService.createPortalSession(userId, getBaseUrl(req));
    return res.json({ url });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
