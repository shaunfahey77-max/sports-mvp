import { ReactNode } from "react";
import { Navigation, PreviewGateSignOut } from "./Navigation";

const SERIF = "'Playfair Display', serif";

interface PageLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  tagline?: string;
}

export function PageLayout({ children, title, subtitle, tagline }: PageLayoutProps) {
  return (
    <div className="brand-shell min-h-[100dvh] flex flex-col bg-[#060D1F] text-white">
      <Navigation />

      {title && (
        <div className="relative overflow-hidden border-b border-white/10 bg-gradient-to-b from-[#0D1B3E] via-[#09132B] to-[#060D1F]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#F5B700]/70 to-transparent" />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 18% 0%, rgba(245,183,0,0.9) 0%, transparent 34%), radial-gradient(circle at 82% 8%, rgba(20,40,80,0.9) 0%, transparent 28%)",
            }}
          />
          <div className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "72px 72px" }} />
          <div className="relative container mx-auto px-6 py-18 text-center">
            {tagline && (
              <div className="brand-kicker mb-4">
                {tagline}
              </div>
            )}
            <h1
              className="text-4xl md:text-5xl font-bold text-white mb-3 leading-tight"
              style={{ fontFamily: SERIF }}
            >
              {title}
            </h1>
            {subtitle && (
              <p className="brand-copy text-base md:text-lg max-w-2xl mx-auto font-light">
                {subtitle}
              </p>
            )}
          </div>
        </div>
      )}

      <main className="relative flex-1 bg-transparent">
        <div className="container mx-auto px-6 py-12">{children}</div>
      </main>

      <footer className="border-t border-white/10 bg-[#060D1F]/90 py-10 backdrop-blur-sm">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-3">
            <img src="/logo-nav.png" alt="SportsMVP" className="h-8 object-contain opacity-70" />
            <span className="text-white/40 font-light italic" style={{ fontFamily: SERIF }}>
              Math, not mystique.
            </span>
          </div>
          <div className="text-white/30 text-xs uppercase tracking-widest">
            Bet like an MVP — sharp betting analytics powered by math.
          </div>
          <PreviewGateSignOut className="sm:hidden inline-flex" />
        </div>
      </footer>
    </div>
  );
}
