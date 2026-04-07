import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { storage } from '../storage';
import { stripeService } from '../stripeService';
import { getUncachableStripeClient } from '../stripeClient';

const router = Router();

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
    const sportProducts = productsRes.data.filter(p => p.metadata?.tier);

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
