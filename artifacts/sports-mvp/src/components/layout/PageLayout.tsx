import { ReactNode } from "react";
import { Navigation } from "./Navigation";

export function PageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <Navigation />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-8">
          {children}
        </div>
      </main>
      <footer className="border-t border-border py-8 mt-auto">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <img src="/logo-nav.png" alt="SportsMVP" className="h-6 object-contain mx-auto mb-4 opacity-50 grayscale" />
          <p>Bet Like an MVP. Sharp betting analytics powered by math.</p>
        </div>
      </footer>
    </div>
  );
}
