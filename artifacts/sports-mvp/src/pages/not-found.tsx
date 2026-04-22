import { Link } from "wouter";

const SERIF = "'Playfair Display', serif";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#060D1F] px-6">
      <div className="w-full max-w-md text-center">
        <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#FFC107]/80 mb-4">
          Page Not Found
        </div>
        <div
          className="text-6xl font-black text-white mb-4"
          style={{ fontFamily: SERIF }}
        >
          404
        </div>
        <p className="text-sm text-white/60 mb-8 leading-relaxed">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded text-xs font-black uppercase tracking-wider bg-[#FFC107] text-[#060D1F] hover:bg-[#FFD54F] transition-colors"
          >
            Back to Home
          </Link>
          <Link
            href="/picks"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded text-xs font-black uppercase tracking-wider border border-[#FFC107]/40 text-[#FFC107] hover:bg-[#FFC107]/10 transition-colors"
          >
            Today's Picks
          </Link>
        </div>
      </div>
    </div>
  );
}
