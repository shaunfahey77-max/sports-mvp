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
    <div className="min-h-[100dvh] flex flex-col bg-[#060D1F] text-white">
      <Navigation />

      {title && (
        <div className="relative border-b border-[#1A3066] bg-gradient-to-b from-[#0D1B3E] to-[#060D1F] overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 30% 0%, #FFC107 0%, transparent 55%)",
            }}
          />
          <div className="relative container mx-auto px-6 py-16 text-center">
            {tagline && (
              <div className="text-[#FFC107] text-[11px] font-bold tracking-[0.25em] uppercase mb-4">
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
              <p className="text-white/55 text-base md:text-lg max-w-xl mx-auto font-light">
                {subtitle}
              </p>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 bg-[#060D1F]">
        <div className="container mx-auto px-6 py-12">{children}</div>
      </main>

      <footer className="border-t border-[#1A3066] bg-[#060D1F] py-10">
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
