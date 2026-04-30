import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLaunchConfig } from "@/hooks/useLaunchConfig";
import { Crown, Star, Shield, ChevronDown, LogOut, Settings, Lock } from "lucide-react";

const SERIF = "'Playfair Display', serif";

const TIER_ICONS: Record<string, typeof Star> = { free: Shield, mvp: Star, mvp_pro: Crown };
const TIER_COLORS: Record<string, string> = {
  free: "text-white/50",
  mvp: "text-[#C4D0E0]",
  mvp_pro: "text-[#FFC107]",
};
const TIER_LABELS: Record<string, string> = { free: "Free", mvp: "MVP", mvp_pro: "MVP Pro" };

export function Navigation() {
  const [location] = useLocation();
  const { isSignedIn, isLoaded, signOut } = useAuth();
  const { tier } = useCurrentUser();
  const { betaMode } = useLaunchConfig();
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
    <nav className="sticky top-0 z-50 w-full border-b border-[#1A3066] bg-[#060D1F]/95 backdrop-blur supports-[backdrop-filter]:bg-[#060D1F]/80">
      <div className="container mx-auto flex h-16 items-center justify-between px-6">
        <Link href="/" aria-label="SportsMVP home" className="flex items-center gap-3 mr-8 shrink-0">
          <img src="/logo-nav.png" alt="SportsMVP" className="h-9 object-contain" />
          <span
            className="hidden sm:inline text-lg font-bold tracking-wide text-white"
            style={{ fontFamily: SERIF }}
          >
            SportsMVP
          </span>
        </Link>

        <div className="flex gap-5 md:gap-8 flex-1 overflow-x-auto scrollbar-none">
          {links.map((link) => {
            const active = location === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative whitespace-nowrap text-sm font-medium transition-colors py-2",
                  active
                    ? "text-[#FFC107]"
                    : "text-white/60 hover:text-white"
                )}
              >
                {link.label}
                {active && (
                  <span className="absolute -bottom-[17px] left-0 right-0 h-[2px] bg-[#FFC107]" />
                )}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <PreviewGateSignOut className="hidden sm:inline-flex" />
          {!isLoaded ? null : isSignedIn ? (
            <>
              {tier === "free" && (
                <Link
                  href="/subscribe"
                  className="hidden md:flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#060D1F] bg-[#FFC107] hover:bg-[#FFD54F] transition-colors rounded-sm px-3 py-1.5"
                >
                  <Crown size={12} />
                  {betaMode ? "Join Waitlist" : "Upgrade"}
                </Link>
              )}

              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-bold transition-colors px-2.5 py-1.5 rounded-sm border",
                    tier === "mvp_pro"
                      ? "text-[#FFC107] border-[#FFC107]/40 hover:bg-[#FFC107]/10"
                      : tier === "mvp"
                      ? "text-[#C4D0E0] border-[#C4D0E0]/40 hover:bg-[#C4D0E0]/10"
                      : "text-white/60 border-white/15 hover:bg-white/5"
                  )}
                >
                  <TierIcon size={13} />
                  <span className="hidden md:inline">{TIER_LABELS[tier]}</span>
                  <ChevronDown size={11} className={cn("transition-transform", menuOpen && "rotate-180")} />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 rounded-sm border border-[#1A3066] bg-[#0D1B3E] shadow-2xl py-1 z-50">
                    <div className="px-3 py-2.5 border-b border-[#1A3066] mb-1">
                      <div className={cn("flex items-center gap-1.5 text-xs font-bold", TIER_COLORS[tier])}>
                        <TierIcon size={12} />
                        {TIER_LABELS[tier]} Plan
                      </div>
                    </div>
                    <Link
                      href="/account"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:text-white hover:bg-white/5 transition-colors"
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
                        {betaMode ? "Join the Waitlist" : "Upgrade to MVP"}
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
                className="text-sm font-medium text-white/60 hover:text-white transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                className="text-[11px] font-bold uppercase tracking-widest bg-[#FFC107] hover:bg-[#FFD54F] text-[#060D1F] px-3 py-1.5 rounded-sm transition-colors"
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

/**
 * Tiny "Sign out of preview" affordance for the public-site preview gate
 * (separate from the Clerk user session). Submits a POST to
 * `/__preview/logout` which clears the signed `preview_auth` cookie and
 * 303-redirects back to the branded login page.
 *
 * Renders only when the build was produced with the preview gate active
 * (controlled by the SITE_BASIC_AUTH_USER / SITE_BASIC_AUTH_PASS env vars
 * via the `__PREVIEW_GATE_ENABLED__` build-time constant). The form action
 * is computed from `import.meta.env.BASE_URL` so it stays correct under any
 * proxy path prefix the site is served behind.
 */
export function PreviewGateSignOut({ className }: { className?: string }) {
  if (!__PREVIEW_GATE_ENABLED__) return null;
  // BASE_URL is guaranteed to end with a "/" by Vite, so this stitches to
  // e.g. "/__preview/logout" or "/sports-mvp/__preview/logout".
  const action = `${import.meta.env.BASE_URL}__preview/logout`;
  return (
    <form
      method="POST"
      action={action}
      className={className}
      aria-label="Sign out of the SportsMVP preview"
    >
      <button
        type="submit"
        title="Sign out of the SportsMVP preview"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/40 hover:text-white/80 transition-colors px-2 py-1.5 rounded-sm border border-transparent hover:border-white/15"
      >
        <Lock size={11} />
        <span>Exit preview</span>
      </button>
    </form>
  );
}
