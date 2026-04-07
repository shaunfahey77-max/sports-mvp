import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth, useUser } from "@clerk/react";
import axios from "axios";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Crown, Shield, Star } from "lucide-react";

const TIER_LABELS: Record<string, string> = { free: "Free", mvp: "MVP", mvp_pro: "MVP Pro" };
const TIER_COLORS: Record<string, string> = {
  free: "text-muted-foreground",
  mvp: "text-[#4488FF]",
  mvp_pro: "text-[#FFC107]",
};
const TIER_ICONS: Record<string, typeof Star> = { free: Shield, mvp: Star, mvp_pro: Crown };

export function Account() {
  const { signOut } = useAuth();
  const { user: clerkUser } = useUser();
  const { user, tier, refetch } = useCurrentUser();
  const [, setLocation] = useLocation();
  const [portalLoading, setPortalLoading] = useState(false);

  const TierIcon = TIER_ICONS[tier];

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const { data } = await axios.post('/stripe/portal');
      if (data.url) window.location.href = data.url;
    } catch {
      setPortalLoading(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    setLocation('/');
  }

  return (
    <PageLayout title="My Account" subtitle={clerkUser?.emailAddresses?.[0]?.emailAddress ?? ''} tagline="BET LIKE AN MVP.">
      <div className="max-w-lg mx-auto space-y-4">
        <Card className="border-[#1A3066] bg-[#0D1B3E] p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-12 w-12 rounded-full bg-[#0033A0] flex items-center justify-center text-white font-black font-display text-lg">
              {clerkUser?.firstName?.[0] ?? clerkUser?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <div className="font-bold text-white">{clerkUser?.firstName ? `${clerkUser.firstName} ${clerkUser.lastName ?? ''}`.trim() : 'Account'}</div>
              <div className="text-xs text-muted-foreground">{clerkUser?.emailAddresses?.[0]?.emailAddress}</div>
            </div>
          </div>

          <div className="border border-[#1A3066] rounded-lg p-4 mb-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Current Plan</div>
            <div className={`flex items-center gap-2 text-xl font-black font-display ${TIER_COLORS[tier]}`}>
              <TierIcon size={20} />
              {TIER_LABELS[tier]}
            </div>
          </div>

          {tier === 'free' ? (
            <button
              onClick={() => setLocation('/subscribe')}
              className="w-full py-2.5 rounded bg-[#FFC107] text-[#060D1F] text-xs font-black uppercase tracking-wider hover:bg-[#e6b000] transition-colors mb-3"
            >
              Upgrade to MVP
            </button>
          ) : (
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="w-full py-2.5 rounded bg-[#0033A0] text-white text-xs font-black uppercase tracking-wider hover:bg-[#0041cc] transition-colors disabled:opacity-50 mb-3"
            >
              {portalLoading ? 'Opening portal...' : 'Manage Subscription'}
            </button>
          )}

          <button
            onClick={handleSignOut}
            className="w-full py-2 text-xs text-muted-foreground hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </Card>
      </div>
    </PageLayout>
  );
}
