import { useQuery } from "@tanstack/react-query";
import axios from "axios";

/**
 * Single-source-of-truth read for the open-beta launch posture. Mirrors
 * the backend `/api/config/launch` response. The backend defaults
 * `betaMode` to true when `BETA_MODE` is unset (we are launching INTO
 * open beta) and the frontend assumes the same posture during the brief
 * window before the network call resolves — that way visitors never see
 * a flash of the paid UI on first paint.
 *
 * When `betaMode` is on:
 *   - Subscribe page renders the waitlist surface (Free Guest Pass +
 *     Coming Soon card with the explicit promotion trigger).
 *   - Landing membership Members card is replaced with the same
 *     waitlist treatment.
 *   - Every "Upgrade to MVP" CTA (Navigation, Dashboard banner,
 *     Account page) is rewritten to "Join the Waitlist" and routes
 *     to the Subscribe page (which is now the waitlist surface).
 *
 * When off, every surface renders the original paid experience
 * unchanged. There is exactly one switch, and it lives on the server.
 */

export interface LaunchConfig {
  betaMode: boolean;
  promotionTrigger: string;
}

const FALLBACK: LaunchConfig = {
  betaMode: true,
  promotionTrigger:
    'Paid Membership opens when our first market reaches Official status with 30 days of clean public record.',
};

async function fetchLaunchConfig(): Promise<LaunchConfig> {
  const res = await axios.get<LaunchConfig>("/config/launch");
  return res.data;
}

export function useLaunchConfig(): LaunchConfig & { isLoaded: boolean } {
  const { data, isSuccess } = useQuery({
    queryKey: ["launchConfig"],
    queryFn: fetchLaunchConfig,
    // We deliberately keep the cached value short-lived so that flipping
    // BETA_MODE on the server reaches running clients within at most one
    // refetch cycle. 60s is short enough to make a sensible flip-off
    // experience yet long enough to avoid spamming the endpoint on
    // every component mount.
    staleTime: 60 * 1000,
    refetchOnMount: "always",
    // `placeholderData` (vs `initialData`) returns the fallback while
    // the real network fetch is still in flight, but does NOT mark the
    // query as having data — so the queryFn always runs on mount and
    // the server's actual posture takes over the moment it arrives.
    // This is what makes the env-var flip propagate to clients without
    // a redeploy: stale clients still show the right CTA within ~60s
    // of `BETA_MODE=false` going live.
    placeholderData: FALLBACK,
  });
  return { ...(data ?? FALLBACK), isLoaded: isSuccess };
}
