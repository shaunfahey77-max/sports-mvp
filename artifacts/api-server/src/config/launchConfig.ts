/**
 * Single-source-of-truth for the open-beta launch posture.
 *
 * The June 1 launch was converted from a paid public launch to an Open
 * Beta (see `.local/launch-readiness-memo-2026-04-30.md` and Task #46).
 * Every beta-aware code path — server checkout block, public price list
 * filter, frontend waitlist UI — gates on a single environment flag so
 * the entire posture flips with one env var change and no code edits.
 *
 * Flag: `BETA_MODE`
 *   - "true" / "1" / "on" / "yes" (case-insensitive)  → beta mode ON
 *   - any other value (or unset)                       → beta mode OFF
 *
 * Default: ON. The flag intentionally defaults to ON because we are
 * launching INTO open beta. To restore the prior paid experience after
 * a market clears Official + 30 days, set `BETA_MODE=false` in the
 * deployment environment and redeploy. See `.local/beta-mode-runbook.md`
 * for the flip-off checklist.
 *
 * Existing legacy MVP / MVP Pro subscribers are deliberately untouched
 * by this flag — webhook sync, Stripe portal access, tier display, and
 * pick gating all behave exactly as before. The flag only affects (a)
 * which tiers may be acquired by NEW checkouts, and (b) the
 * acquisition-funnel UI surfaces.
 */

const TRUTHY = new Set(['true', '1', 'on', 'yes']);

export function isBetaMode(): boolean {
  const raw = process.env.BETA_MODE;
  if (raw === undefined) return true; // default: open-beta posture
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Tiers that may not be acquired by NEW checkouts. The static block
 * is `mvp_pro` (the retired $39.99 "Inner Circle" tier). When beta
 * mode is on, `mvp` is added — paid acquisition is fully paused for
 * the duration of the open beta.
 *
 * Existing subscriptions on either tier continue to work normally:
 * webhook sync still recognizes them, the Stripe portal still serves
 * them, and the dashboard/pick-gating code still treats them as MVP.
 */
const STATIC_BLOCKED_TIERS = ['mvp_pro'] as const;

export function getBlockedTiersForNewCheckout(): Set<string> {
  const blocked = new Set<string>(STATIC_BLOCKED_TIERS);
  if (isBetaMode()) blocked.add('mvp');
  return blocked;
}

/**
 * Public-facing copy for the concrete promotion trigger that ends the
 * open beta. Surfaced on the waitlist UI (Subscribe page + Landing
 * Members card) so visitors understand exactly when paid will open.
 *
 * Sourced from the launch-readiness memo and Task #46 spec; do not
 * paraphrase per-surface — keep one canonical sentence.
 */
export const LAUNCH_PROMOTION_TRIGGER =
  'Paid Membership opens when our first market reaches Official status with 30 days of clean public record.';

/**
 * Shape returned by `GET /api/config/launch`. Exported so the frontend
 * can share the type via a small client-side declaration.
 */
export interface LaunchConfigPayload {
  betaMode: boolean;
  promotionTrigger: string;
}

export function getLaunchConfigPayload(): LaunchConfigPayload {
  return {
    betaMode: isBetaMode(),
    promotionTrigger: LAUNCH_PROMOTION_TRIGGER,
  };
}
