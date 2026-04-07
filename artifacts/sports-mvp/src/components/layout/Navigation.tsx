import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

export function Navigation() {
  const [location] = useLocation();

  const links = [
    { href: "/picks", label: "Today's Picks" },
    { href: "/parlay", label: "Parlay Builder" },
    { href: "/performance", label: "Performance" },
    { href: "/history", label: "History" },
  ];

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
        <Link
          href="/"
          className="text-xs text-foreground/40 hover:text-foreground/60 transition-colors hidden md:block"
        >
          Home
        </Link>
      </div>
    </nav>
  );
}
