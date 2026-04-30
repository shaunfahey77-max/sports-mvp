import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth, useUser } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLaunchConfig } from "@/hooks/useLaunchConfig";
import { Check, Mail, ShieldCheck } from "lucide-react";

interface Price { id: string; unitAmount: number; currency: string; recurring: { interval: string } | null; }
interface Product { id: string; name: string; description: string; metadata: Record<string, string>; prices: Price[]; }

const TIER_ORDER: Record<string, number> = { free: 0, mvp: 1, mvp_pro: 2 };

function formatPrice(amount: number) {
  return `$${(amount / 100).toFixed(2)}`;
}

function PlanCard({
  name, tierKey, description, features, monthlyPrice, yearlyPrice,
  highlight, currentTier, onSelect, loading, pricesLoading, billingNote,
}: {
  name: string; tierKey: string; description: string; features: string[];
  monthlyPrice?: Price; yearlyPrice?: Price;
  highlight?: boolean; currentTier: string; onSelect: (priceId: string) => void; loading: string | null;
  pricesLoading?: boolean;
  billingNote?: string;
}) {
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const price = interval === 'month' ? monthlyPrice : yearlyPrice;
  const isCurrent = currentTier === tierKey;
  const isDowngrade = TIER_ORDER[currentTier] > TIER_ORDER[tierKey];

  return (
    <Card className={`relative flex flex-col p-6 gap-4 border ${highlight ? 'border-[#FFC107] bg-gradient-to-b from-[#112454] to-[#0D1B3E] shadow-[0_0_40px_rgba(255,193,7,0.15)]' : 'border-[#1A3066] bg-[#0D1B3E]'}`}>
      {highlight && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#FFC107] text-[#060D1F] text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">
          Most Popular
        </div>
      )}
      <div>
        <h3 className="text-lg font-black font-display text-white mb-2">{name}</h3>
        {billingNote && (
          <div className="inline-flex items-center gap-1.5 mb-3 px-2.5 py-1 rounded-sm border border-[#FFC107]/40 bg-[#FFC107]/5">
            <span className="w-1 h-1 rounded-full bg-[#FFC107]" />
            <span className="text-[11px] text-[#FFC107] font-mono tracking-wide whitespace-nowrap">
              {billingNote} on your card
            </span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {pricesLoading && !price ? (
        <div className="h-10 w-28 rounded bg-[#1A3066] animate-pulse" />
      ) : price ? (
        <>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-black font-display text-white">{formatPrice(price.unitAmount)}</span>
            <span className="text-muted-foreground text-sm">/{interval}</span>
          </div>
          {monthlyPrice && yearlyPrice && (
            <div className="flex gap-2">
              {(['month', 'year'] as const).map(i => (
                <button
                  key={i}
                  onClick={() => setInterval(i)}
                  className={`flex-1 py-1 rounded text-xs font-bold transition-colors ${interval === i ? 'bg-[#0033A0] text-white' : 'bg-[#1A3066] text-muted-foreground hover:text-white'}`}
                >
                  {i === 'month' ? 'Monthly' : `Yearly (save ${Math.round(100 - (yearlyPrice.unitAmount / 12 / monthlyPrice.unitAmount * 100))}%)`}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-3xl font-black font-display text-white">Free</div>
      )}

      <ul className="space-y-2 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check size={12} className="text-[#388E3C] mt-0.5 shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      {isCurrent ? (
        <div className="w-full py-2.5 rounded bg-[#1A3066] text-white/40 text-xs font-bold text-center uppercase tracking-wider">
          Current Plan
        </div>
      ) : isDowngrade ? (
        <div className="w-full py-2.5 rounded bg-[#1A3066] text-white/40 text-xs font-bold text-center uppercase tracking-wider">
          Downgrade via Portal
        </div>
      ) : price ? (
        <button
          onClick={() => onSelect(price.id)}
          disabled={!!loading}
          className={`w-full py-2.5 rounded text-xs font-black uppercase tracking-wider transition-colors ${highlight ? 'bg-[#FFC107] text-[#060D1F] hover:bg-[#e6b000]' : 'bg-[#0033A0] text-white hover:bg-[#0041cc]'} disabled:opacity-50`}
        >
          {loading === price.id ? 'Redirecting...' : `Get ${name}`}
        </button>
      ) : null}
    </Card>
  );
}

/* ---------------- WAITLIST CARD (beta mode) ---------------- */
function WaitlistCard({ promotionTrigger, source }: { promotionTrigger: string; source: string }) {
  const { user: clerkUser } = useUser();
  const defaultEmail = clerkUser?.emailAddresses?.[0]?.emailAddress ?? "";
  const [email, setEmail] = useState(defaultEmail);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Keep prefilled email in sync once Clerk loads after first paint.
  if (defaultEmail && email === "" && status === "idle") {
    setEmail(defaultEmail);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    setErrorMsg(null);
    try {
      await axios.post("/waitlist", { email: email.trim(), source });
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      const msg = err?.response?.data?.error;
      setErrorMsg(typeof msg === "string" ? msg : "Could not save your spot. Please try again.");
    }
  }

  return (
    <Card className="relative flex flex-col p-6 gap-4 border border-[#FFC107] bg-gradient-to-b from-[#112454] to-[#0D1B3E] shadow-[0_0_40px_rgba(255,193,7,0.15)]">
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#FFC107] text-[#060D1F] text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">
        Coming Soon
      </div>
      <div>
        <h3 className="text-lg font-black font-display text-white mb-2">Members</h3>
        <div className="inline-flex items-center gap-1.5 mb-3 px-2.5 py-1 rounded-sm border border-[#FFC107]/40 bg-[#FFC107]/5">
          <span className="w-1 h-1 rounded-full bg-[#FFC107]" />
          <span className="text-[11px] text-[#FFC107] font-mono tracking-wide whitespace-nowrap">
            Open Beta — paid not yet available
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {promotionTrigger} Join the waitlist and we&rsquo;ll email you the moment paid opens.
        </p>
      </div>

      <ul className="space-y-2 flex-1">
        {[
          "Every Official Tier A / B / C pick, every day",
          "Full Model Watch lane while markets earn promotion",
          "Full edge, EV, model & market probability",
          "CLV tracked on every pick",
          "Best line across all sportsbooks",
          "Parlay Builder + Bet Tracker (Kelly)",
        ].map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check size={12} className="text-[#FFC107] mt-0.5 shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      {status === "success" ? (
        <div className="rounded-sm border border-[#388E3C]/40 bg-[#388E3C]/10 px-3 py-3 text-xs text-[#86EFAC] flex items-start gap-2">
          <ShieldCheck size={14} className="text-[#86EFAC] mt-0.5 shrink-0" />
          <div>
            <div className="font-bold mb-0.5">You&rsquo;re on the list.</div>
            <div className="text-[#86EFAC]/80">
              We&rsquo;ll email <span className="font-mono">{email}</span> the moment paid Membership opens.
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          <label className="block">
            <span className="sr-only">Email</span>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (status === "error") setStatus("idle"); }}
                className="w-full pl-9 pr-3 py-2.5 rounded-sm bg-[#060D1F] border border-[#1A3066] text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#FFC107]/60 transition-colors"
              />
            </div>
          </label>
          <button
            type="submit"
            disabled={status === "submitting" || email.trim() === ""}
            className="w-full py-2.5 rounded text-xs font-black uppercase tracking-wider transition-colors bg-[#FFC107] text-[#060D1F] hover:bg-[#e6b000] disabled:opacity-50"
          >
            {status === "submitting" ? "Joining…" : "Join the Waitlist"}
          </button>
          {status === "error" && errorMsg && (
            <p className="text-[11px] text-red-400 mt-1">{errorMsg}</p>
          )}
          <p className="text-[10px] text-white/40 leading-relaxed">
            One email at launch. No spam, no marketing.
          </p>
        </form>
      )}
    </Card>
  );
}

export function Subscribe() {
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const { tier } = useCurrentUser();
  const { betaMode, promotionTrigger } = useLaunchConfig();
  const [loading, setLoading] = useState<string | null>(null);

  // Prices are only fetched when we will actually render the paid funnel.
  // During open beta the `/stripe/prices` endpoint already filters out
  // `mvp` server-side, so the request would return an empty product list
  // — but skipping it altogether avoids an unused round-trip.
  const { data, isLoading: pricesLoading } = useQuery<{ products: Product[] }>({
    queryKey: ['stripe-prices'],
    queryFn: async () => (await axios.get('/stripe/prices')).data,
    staleTime: 5 * 60 * 1000,
    enabled: !betaMode,
  });

  const products = data?.products ?? [];
  const mvp = products.find(p => p.metadata?.tier === 'mvp' || (p.name?.toLowerCase().includes('mvp') && !p.name?.toLowerCase().includes('pro')));

  function getPrice(product: Product | undefined, interval: string) {
    return product?.prices.find(p => p.recurring?.interval === interval);
  }

  async function handleSelect(priceId: string) {
    if (!isSignedIn) { setLocation('/sign-in'); return; }
    setLoading(priceId);
    try {
      const { data } = await axios.post('/stripe/checkout', { priceId });
      if (data.url) window.location.href = data.url;
    } catch {
      setLoading(null);
    }
  }

  if (betaMode) {
    return (
      <PageLayout
        title="We&rsquo;re in Open Beta."
        subtitle="Free Guest Pass is live now. Paid Membership opens when the model earns it."
        tagline="OPEN BETA · NO PAYMENT YET"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <PlanCard
            name="Guest Pass"
            tierKey="free"
            description="Free during beta. See today's top Tier-A pick (delayed) once a market clears the launch threshold."
            features={[
              "Today's #1 Tier-A pick (delayed) once available",
              "Public tier badge + final result",
              "Full performance history",
            ]}
            currentTier={tier}
            onSelect={handleSelect}
            loading={loading}
          />
          <WaitlistCard promotionTrigger={promotionTrigger} source="subscribe_page" />
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Choose your level of access." subtitle="Start free. Upgrade when the picks prove themselves. Cancel any time." tagline="MATH, NOT MYSTIQUE.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        <PlanCard
          name="Guest Pass"
          tierKey="free"
          description="Verify the model before you commit."
          features={[
            "Today's #1 Tier-A pick (delayed)",
            "Public tier badge + final result",
            "Full performance history",
          ]}
          currentTier={tier}
          onSelect={handleSelect}
          loading={loading}
        />
        <PlanCard
          name="Members"
          tierKey="mvp"
          billingNote="Billed as MVP"
          description="Full daily slate plus the math behind every pick."
          features={[
            "Every Official Tier A / B / C pick, every day",
            "Full Model Watch lane while markets earn promotion",
            "Full edge, EV, model & market probability",
            "CLV tracked on every pick",
            "Best line across all sportsbooks",
            "Parlay Builder + Bet Tracker (Kelly)",
            "Re-scored every 10 minutes",
          ]}
          monthlyPrice={getPrice(mvp, 'month')}
          yearlyPrice={getPrice(mvp, 'year')}
          highlight
          currentTier={tier}
          onSelect={handleSelect}
          loading={loading}
          pricesLoading={pricesLoading}
        />
      </div>
    </PageLayout>
  );
}
