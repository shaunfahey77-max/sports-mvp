import { Link, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Crown, Star, Shield } from "lucide-react";

const TIER_ICONS: Record<string, typeof Star> = { free: Shield, mvp: Star, mvp_pro: Crown };
const TIER_COLORS: Record<string, string> = {
  free: "text-muted-foreground",
  mvp: "text-[#4488FF]",
  mvp_pro: "text-[#FFC107]",
};
const TIER_LABELS: Record<string, string> = { free: "Free", mvp: "MVP", mvp_pro: "MVP Pro" };

export function Navigation() {
  const [location] = useLocation();
  const { isSignedIn, isLoaded } = useAuth();
  const { tier } = useCurrentUser();

  const links = [
    { href: "/picks", label: "Today's Picks" },
    { href: "/parlay", label: "Parlay Builder" },
    { href: "/tracker", label: "Bet Tracker" },
    { href: "/performance", label: "Performance" },
    { href: "/history", label: "History" },
  ];

  const TierIcon = TIER_ICONS[tier] ?? Shield;

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 mr-8">
          <img src="/logo-nav.png" alt="SportsMVP" className="h-12 object-contain" />
        </Link>

        <div className="flex gap-6 md:gap-10 flex-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm font-medium transition-colors hover:text-foreground/80",
                location === link.href ? "text-foreground" : "text-foreground/60"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {isLoaded && (
            isSignedIn ? (
              <>
                {tier === "free" && (
                  <Link
                    href="/subscribe"
                    className="hidden md:flex items-center gap-1 text-xs font-bold text-[#FFC107] hover:text-[#e6b000] transition-colors border border-[#FFC107]/30 rounded px-2.5 py-1"
                  >
                    <Crown size={11} />
                    Upgrade
                  </Link>
                )}
                <Link
                  href="/account"
                  className={cn("flex items-center gap-1.5 text-xs font-bold transition-colors", TIER_COLORS[tier])}
                >
                  <TierIcon size={13} />
                  <span className="hidden md:inline">{TIER_LABELS[tier]}</span>
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="text-sm font-medium text-foreground/60 hover:text-foreground transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  href="/sign-up"
                  className="text-xs font-bold bg-[#0033A0] hover:bg-[#0041cc] text-white px-3 py-1.5 rounded transition-colors"
                >
                  Start Free
                </Link>
              </>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
