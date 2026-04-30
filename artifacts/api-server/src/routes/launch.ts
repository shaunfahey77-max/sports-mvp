import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '@clerk/express';
import { storage } from '../storage';
import { getLaunchConfigPayload } from '../config/launchConfig';

const router = Router();

/**
 * Public launch-mode config. Read by the frontend on every page load via
 * `useLaunchConfig()` so the open-beta posture (waitlist UI, swapped
 * upgrade CTAs, "Coming Soon" Members card) flips with one env var
 * (`BETA_MODE`) and no client redeploy.
 *
 * No auth required — the response is the same for everyone and reveals
 * nothing sensitive (it's the same information the homepage already
 * displays). Cached briefly to avoid hammering the endpoint when the
 * frontend re-renders.
 */
router.get('/config/launch', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json(getLaunchConfigPayload());
});

/**
 * Open-beta waitlist signup. No auth required; if the submitter happens
 * to already be signed in, we attach their Clerk user id for attribution
 * (handy when we want to ping signed-in beta users in-app on launch
 * day). Email is the only required field. Source is a free-form
 * attribution token chosen by the calling surface (e.g.
 * 'subscribe_page', 'landing_membership').
 *
 * Idempotent against email — re-submissions return 200 with `existing:
 * true` so the frontend can show "you're already on the list" without a
 * 409 round-trip.
 */
const WaitlistBody = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  source: z.string().trim().min(1).max(64).optional(),
});

router.post('/waitlist', async (req, res) => {
  const parsed = WaitlistBody.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return res.status(400).json({ error: first?.message ?? 'Invalid request.' });
  }

  const { userId } = getAuth(req);

  try {
    const row = await storage.addWaitlistSignup({
      email: parsed.data.email,
      clerkUserId: userId ?? null,
      source: parsed.data.source ?? null,
    });
    return res.json({ ok: true, id: row.id, email: row.email });
  } catch (err: any) {
    req.log?.error({ err }, 'waitlist signup failed');
    return res.status(500).json({ error: 'Could not save waitlist signup. Please try again.' });
  }
});

export default router;
