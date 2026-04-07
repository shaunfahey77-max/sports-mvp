import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { storage } from '../storage';
import { stripeService } from '../stripeService';

const router = Router();

router.get('/user/me', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser({ clerkUserId: userId });
    }

    const tier = await stripeService.syncSubscriptionTier(userId);
    const publishableKey = await stripeService.getPublishableKey();

    return res.json({
      id: user.id,
      clerkUserId: user.clerkUserId,
      email: user.email,
      tier,
      stripeCustomerId: user.stripeCustomerId,
      stripePublishableKey: publishableKey,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
