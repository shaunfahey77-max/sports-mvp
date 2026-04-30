import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth, useUser } from "@clerk/react";
import axios from "axios";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLaunchConfig } from "@/hooks/useLaunchConfig";
import { Crown, Shield, Star } from "lucide-react";

const SERIF = "'Playfair Display', serif";

const TIER_LABELS: Record<string, string> = { free: "Free", mvp: "MVP", mvp_pro: "MVP Pro" };
const TIER_COLORS: Record<string, string> = {
  free: "text-white/55",
  mvp: "text-[#FFD54F]",
  mvp_pro: "text-[#FFC107]",
};
const TIER_ICONS: Record<string, typeof Star> = { free: Shield, mvp: Star, mvp_pro: Crown };

export function Account() {
  const { signOut } = useAuth();
  const { user: clerkUser } = useUser();
  const { tier } = useCurrentUser();
  const { betaMode } = useLaunchConfig();
  const [, setLocation] = useLocation();
  const [portalLoading, setPortalLoading] = useState(false);

  const TierIcon = TIER_ICONS[tier];
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? '';
  const initial =
    clerkUser?.firstName?.[0] ??
    email?.[0]?.toUpperCase() ??
    '?';
  const displayName = clerkUser?.firstName
    ? `${clerkUser.firstName} ${clerkUser.lastName ?? ''}`.trim()
    : 'Account';

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
    <PageLayout title="My Account" subtitle={email} tagline="MEMBER PROFILE">
      <div className="max-w-xl mx-auto space-y-8">
        {/* Identity */}
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#FFC107] mb-5 flex items-center gap-2.5">
            <span className="w-1 h-1 rounded-full bg-[#FFC107]" />
            Identity
          </h3>
          <Card className="bg-[#0D1B3E] border border-[#1A3066] rounded-sm p-6 hover:border-[#FFC107]/30 transition-colors">
            <div className="flex items-center gap-4">
              <div
                className="h-14 w-14 rounded-full bg-[#FFC107] flex items-center justify-center text-[#060D1F] font-bold text-2xl"
                style={{ fontFamily: SERIF }}
              >
                {initial}
              </div>
              <div className="min-w-0">
                <div className="text-white font-bold text-lg" style={{ fontFamily: SERIF }}>
                  {displayName}
                </div>
                <div className="text-xs text-white/50 truncate">{email}</div>
              </div>
            </div>
          </Card>
        </section>

        {/* Subscription */}
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#FFC107] mb-5 flex items-center gap-2.5">
            <span className="w-1 h-1 rounded-full bg-[#FFC107]" />
            Subscription
          </h3>
          <Card className="bg-[#0D1B3E] border border-[#1A3066] rounded-sm p-6 hover:border-[#FFC107]/30 transition-colors">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/50 mb-2">
                  Current Plan
                </div>
                <div className={`flex items-center gap-2.5 text-2xl font-bold ${TIER_COLORS[tier]}`} style={{ fontFamily: SERIF }}>
                  <TierIcon size={22} />
                  {TIER_LABELS[tier]}
                </div>
              </div>
            </div>

            {tier === 'free' ? (
              <button
                onClick={() => setLocation('/subscribe')}
                className="w-full py-3 rounded-sm bg-[#FFC107] text-[#060D1F] text-xs font-bold uppercase tracking-[0.2em] hover:bg-[#FFD54F] transition-colors"
              >
                {betaMode ? 'Join the Waitlist' : 'Upgrade to MVP'}
              </button>
            ) : (
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                className="w-full py-3 rounded-sm bg-transparent border border-[#FFC107]/50 text-[#FFC107] text-xs font-bold uppercase tracking-[0.2em] hover:bg-[#FFC107]/10 hover:border-[#FFC107] transition-colors disabled:opacity-50"
              >
                {portalLoading ? 'Opening portal…' : 'Manage Subscription'}
              </button>
            )}
          </Card>
        </section>

        {/* Session */}
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#FFC107] mb-5 flex items-center gap-2.5">
            <span className="w-1 h-1 rounded-full bg-[#FFC107]" />
            Session
          </h3>
          <Card className="bg-[#0D1B3E] border border-[#1A3066] rounded-sm p-6 hover:border-[#FFC107]/30 transition-colors">
            <button
              onClick={handleSignOut}
              className="w-full py-2.5 rounded-sm text-xs font-bold uppercase tracking-[0.2em] text-white/55 hover:text-white border border-[#1A3066] hover:border-white/30 transition-colors"
            >
              Sign Out
            </button>
          </Card>
        </section>
      </div>
    </PageLayout>
  );
}
