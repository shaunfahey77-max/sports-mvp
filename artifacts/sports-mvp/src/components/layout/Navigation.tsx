import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Crown, Star, Shield, ChevronDown, User, LogOut, Settings } from "lucide-react";

const TIER_ICONS: Record<string, typeof Star> = { free: Shield, mvp: Star, mvp_pro: Crown };
const TIER_COLORS: Record<string, string> = {
  free: "text-muted-foreground",
  mvp: "text-[#4488FF]",
  mvp_pro: "text-[#FFC107]",
};
const TIER_LABELS: Record<string, string> = { free: "Free", mvp: "MVP", mvp_pro: "MVP Pro" };

export function Navigation() {
  const [location] = useLocation();
  const { isSignedIn, isLoaded, signOut } = useAuth();
  const { tier } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const links = [
    { href: "/picks", label: "Today's Picks" },
    { href: "/parlay", label: "Parlay Builder" },
    { href: "/tracker", label: "Bet Tracker" },
    { href: "/performance", label: "Performance" },
    { href: "/history", label: "History" },
  ];

  const TierIcon = TIER_ICONS[tier] ?? Shield;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
          {!isLoaded ? null : isSignedIn ? (
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

              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-bold transition-colors px-2.5 py-1.5 rounded border",
                    tier === "mvp_pro"
                      ? "text-[#FFC107] border-[#FFC107]/30 hover:bg-[#FFC107]/10"
                      : tier === "mvp"
                      ? "text-[#4488FF] border-[#4488FF]/30 hover:bg-[#4488FF]/10"
                      : "text-muted-foreground border-border hover:bg-muted"
                  )}
                >
                  <TierIcon size={13} />
                  <span className="hidden md:inline">{TIER_LABELS[tier]}</span>
                  <ChevronDown size={11} className={cn("transition-transform", menuOpen && "rotate-180")} />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-44 rounded-lg border border-[#1A3066] bg-[#0D1B3E] shadow-xl py-1 z-50">
                    <div className="px-3 py-2 border-b border-[#1A3066] mb-1">
                      <div className={cn("flex items-center gap-1.5 text-xs font-bold", TIER_COLORS[tier])}>
                        <TierIcon size={11} />
                        {TIER_LABELS[tier]} Plan
                      </div>
                    </div>
                    <Link
                      href="/account"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 text-xs text-foreground/70 hover:text-foreground hover:bg-white/5 transition-colors"
                    >
                      <Settings size={12} />
                      Account
                    </Link>
                    {tier === "free" && (
                      <Link
                        href="/subscribe"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-xs text-[#FFC107] hover:bg-[#FFC107]/10 transition-colors font-bold"
                      >
                        <Crown size={12} />
                        Upgrade to MVP
                      </Link>
                    )}
                    <div className="border-t border-[#1A3066] mt-1 pt-1">
                      <button
                        onClick={() => { setMenuOpen(false); signOut(); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                      >
                        <LogOut size={12} />
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
          )}
        </div>
      </div>
    </nav>
  );
}
