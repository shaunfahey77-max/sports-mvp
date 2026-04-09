import { ReactNode } from "react";
import { Navigation } from "./Navigation";

interface PageLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  tagline?: string;
}

export function PageLayout({ children, title, subtitle, tagline }: PageLayoutProps) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <Navigation />

      {title && (
        <div className="border-b border-[#1A3066] bg-[#0D1B3E]">
          <div className="container mx-auto px-4 py-10 text-center">
            {tagline && (
              <div className="text-[#FFC107] text-[10px] font-black tracking-[0.2em] uppercase mb-3">
                {tagline}
              </div>
            )}
            <h1 className="text-3xl md:text-4xl font-black font-display text-white mb-2">
              {title}
            </h1>
            {subtitle && (
              <p className="text-white/50 text-sm max-w-md mx-auto">{subtitle}</p>
            )}
          </div>
        </div>
      )}

      <main className="flex-1">
        <div className="container mx-auto px-4 py-8">
          {children}
        </div>
      </main>

      <footer className="border-t border-border py-8 mt-auto">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <img src="/logo-nav.png" alt="SportsMVP" className="h-10 object-contain mx-auto mb-4 opacity-50 grayscale" />
          <p>Bet Like an MVP. Sharp betting analytics powered by math.</p>
        </div>
      </footer>
    </div>
  );
}
