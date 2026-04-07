import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export type UserTier = "free" | "mvp" | "mvp_pro";

export interface CurrentUser {
  id: string;
  clerkUserId: string;
  email?: string;
  tier: UserTier;
  stripeCustomerId?: string;
  stripePublishableKey?: string;
}

async function fetchMe(): Promise<CurrentUser> {
  const res = await axios.get("/user/me");
  return res.data;
}

export function useCurrentUser() {
  const { isSignedIn, isLoaded } = useAuth();

  const query = useQuery({
    queryKey: ["currentUser"],
    queryFn: fetchMe,
    enabled: isLoaded && !!isSignedIn,
    staleTime: 60_000,
  });

  return {
    user: query.data ?? null,
    tier: (query.data?.tier ?? "free") as UserTier,
    isLoaded: isLoaded && (!isSignedIn || !query.isLoading),
    isSignedIn: !!isSignedIn,
    isPro: query.data?.tier === "mvp_pro",
    isMvp: query.data?.tier === "mvp" || query.data?.tier === "mvp_pro",
    refetch: query.refetch,
  };
}
