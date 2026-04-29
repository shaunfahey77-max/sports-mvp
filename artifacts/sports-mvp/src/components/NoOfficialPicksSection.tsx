import { Eye } from "lucide-react";
import type { CandidateBet } from "@workspace/api-client-react";
import type { DashboardFallbackSection } from "@/lib/modelWatchBoard";
import { FallbackCandidateCard } from "@/components/FallbackCandidateCard";

interface NoOfficialPicksSectionProps {
  section: DashboardFallbackSection<CandidateBet>;
  onLogPick: (bet: CandidateBet) => void;
}

export function NoOfficialPicksSection({
  section,
  onLogPick,
}: NoOfficialPicksSectionProps) {
  if (section.kind === "member-board") {
    return (
      <div className="space-y-6" data-testid="model-watch-board-section">
        <div className="bg-[#0B142E]/70 px-4 py-3 rounded-lg border border-dashed border-white/20 flex items-start gap-3">
          <Eye size={14} className="text-white/60 mt-0.5 shrink-0" />
          <div>
            <div
              className="text-sm font-bold text-white/80 mb-0.5"
              data-testid="model-watch-board-title"
            >
              {section.title}
            </div>
            <p
              className="text-xs text-muted-foreground"
              data-testid="model-watch-board-disclaimer"
            >
              {section.disclaimer}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {section.cards.map((bet, i) => (
            <div
              key={bet.id}
              className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <FallbackCandidateCard
                bet={bet}
                rank={i + 1}
                showProbabilities
                onLogPick={() => onLogPick(bet)}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section.kind === "free-fallback") {
    return (
      <div className="space-y-6" data-testid="fallback-section">
        <div className="bg-[#0B142E]/70 px-4 py-3 rounded-lg border border-dashed border-white/20 flex items-start gap-3">
          <Eye size={14} className="text-white/60 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-bold text-white/80 mb-0.5">
              No Official Picks Today — Top Candidate (Model Watch)
            </div>
            <p className="text-xs text-muted-foreground">
              No bets cleared the model's scoring gates. We're surfacing the
              single highest-ranked candidate below for transparency. It is{" "}
              <span className="font-semibold text-white/70">
                not an official pick
              </span>
              , is not counted in performance or CLV reporting, and will not
              appear in History.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <FallbackCandidateCard
            bet={section.candidate}
            onLogPick={() => onLogPick(section.candidate)}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="py-20 text-center border border-border rounded-xl bg-card/30"
      data-testid="no-action-section"
    >
      <img
        src="/logo-shield.png"
        alt=""
        className="h-14 w-auto mx-auto mb-4 opacity-20"
      />
      <h3 className="text-2xl font-display font-bold mb-2">No Action Today</h3>
      <p className="text-muted-foreground">
        The model hasn't found any edges worth betting. Sharp bettors wait for
        the right spots — check back later.
      </p>
    </div>
  );
}
