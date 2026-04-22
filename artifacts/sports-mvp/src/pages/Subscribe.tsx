import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Check } from "lucide-react";

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
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <h3 className="text-lg font-black font-display text-white">{name}</h3>
          {billingNote && (
            <span className="text-[9px] text-white/40 uppercase tracking-widest font-mono whitespace-nowrap">
              {billingNote}
            </span>
          )}
        </div>
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

export function Subscribe() {
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const { tier } = useCurrentUser();
  const [loading, setLoading] = useState<string | null>(null);

  const { data, isLoading: pricesLoading } = useQuery<{ products: Product[] }>({
    queryKey: ['stripe-prices'],
    queryFn: async () => (await axios.get('/stripe/prices')).data,
    staleTime: 5 * 60 * 1000,
  });

  const products = data?.products ?? [];
  const mvp = products.find(p => p.metadata?.tier === 'mvp' || p.name?.toLowerCase().includes('mvp') && !p.name?.toLowerCase().includes('pro'));
  const mvpPro = products.find(p => p.metadata?.tier === 'mvp_pro' || p.name?.toLowerCase().includes('pro'));

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

  return (
    <PageLayout title="Choose your level of access." subtitle="Start free. Upgrade when the picks prove themselves. Cancel any time." tagline="MATH, NOT MYSTIQUE.">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
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
            "Every Tier A / B / C pick, every day",
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
        <PlanCard
          name="Inner Circle"
          tierKey="mvp_pro"
          billingNote="Billed as MVP Pro"
          description="Programmatic access for serious analysts."
          features={[
            "Everything in Members",
            "Email alerts on every Tier-A surface",
            "Line-movement notifications",
            "Early publish access (before public)",
            "Programmatic API access",
            "Priority support",
          ]}
          monthlyPrice={getPrice(mvpPro, 'month')}
          yearlyPrice={getPrice(mvpPro, 'year')}
          currentTier={tier}
          onSelect={handleSelect}
          loading={loading}
          pricesLoading={pricesLoading}
        />
      </div>
    </PageLayout>
  );
}
