import { useState } from "react";
import { useGetPerformance, getGetPerformanceQueryKey, GetPerformanceWindow } from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { formatPercentage, formatDecimal } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp, TrendingUp, Activity, Target } from "lucide-react";

const SERIF = "'Playfair Display', serif";

const TIER_COLORS: Record<string, string> = {
  A: "#FFC107", B: "#4488FF", C: "#7E57C2", PASS: "#1A3066",
};
const LEAGUE_COLORS: Record<string, string> = {
  nba: "#C9082A", nhl: "#006BB6", mlb: "#0E5C2E", ncaam: "#CC8800",
};
const MARKET_COLORS: Record<string, string> = {
  moneyline: "#0033A0", spread: "#7E57C2", total: "#00897B",
};

function MethodologyDisclosure({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-sm border border-[#1A3066] bg-[#0D1B3E] overflow-hidden mb-10">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#FFC107]">
          <span className="w-1 h-1 rounded-full bg-[#FFC107]" />
          The Methodology
        </span>
        {open ? <ChevronUp size={14} className="text-white/50" /> : <ChevronDown size={14} className="text-white/50" />}
      </button>
      {open && (
        <div className="px-5 pb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-sm text-white/70 border-t border-[#1A3066] pt-6">
          {[
            {
              n: "01", title: "Probability Estimation",
              body: "Nine separate ML models generate raw win/cover/over probabilities — one per league per market. Each model is trained on historical game data and refreshed regularly.",
            },
            {
              n: "02", title: "Calibration",
              body: "Raw probabilities are calibrated using Platt Scaling (sigmoid) or isotonic regression to correct systematic over/under-confidence. Output matches empirical frequencies.",
            },
            {
              n: "03", title: "Scoring & Edge",
              body: "Fair market probability is extracted by removing vig. Edge = calibrated − fair. EV = p×(decimal−1) − (1−p). Picks ranked by composite score: EV 50%, edge 25%, calibration 15%, market quality 10%.",
            },
            {
              n: "04", title: "Tier Assignment",
              body: "Top-ranked picks above thresholds are tiered. A ≥ 0.65, B ≥ 0.50, C ≥ 0.35. Below 0.35 is PASS. Only A–C are published.",
            },
          ].map((item) => (
            <div key={item.n}>
              <div className="text-[#FFC107]/40 text-2xl font-bold mb-1" style={{ fontFamily: SERIF }}>
                {item.n}
              </div>
              <div className="text-white font-bold mb-2 text-sm" style={{ fontFamily: SERIF }}>
                {item.title}
              </div>
              <p className="leading-relaxed text-white/55">{item.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Performance() {
  const [window, setWindow] = useState<GetPerformanceWindow>(30);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  const { data: metrics, isLoading } = useGetPerformance(
    { window },
    { query: { queryKey: getGetPerformanceQueryKey({ window }) } }
  );

  return (
    <PageLayout>
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-[#1A3066]">
        <div>
          <div className="text-[#FFC107] text-[11px] font-bold tracking-[0.25em] uppercase mb-3">
            Public Track Record
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight" style={{ fontFamily: SERIF }}>
            Performance
          </h1>
          <p className="text-white/55 mt-3 text-base max-w-xl">
            Every pick graded the next morning. No cherry-picking. No hidden losers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-white/40">Window</span>
          <Select value={window.toString()} onValueChange={(v) => setWindow(Number(v) as GetPerformanceWindow)}>
            <SelectTrigger className="w-[180px] bg-[#0D1B3E] border-[#1A3066] text-white">
              <SelectValue placeholder="Time Window" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="14">Last 14 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="45">Last 45 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <MethodologyDisclosure open={howItWorksOpen} onToggle={() => setHowItWorksOpen(v => !v)} />

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-sm bg-[#0D1B3E]" />
          ))}
        </div>
      ) : metrics ? (
        <div className="space-y-12 animate-in fade-in duration-500">
          {/* HEADLINE STATS */}
          <section>
            <SectionLabel icon={<TrendingUp size={12} />} text="Headline" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#1A3066] rounded-sm overflow-hidden border border-[#1A3066]">
              <HeroStat
                label="Win Rate"
                value={formatPercentage(metrics.winRate)}
                trend={metrics.winRate > 0.52 ? "positive" : "neutral"}
                tooltip="Percentage of picks graded as wins, excluding pushes."
              />
              <HeroStat
                label="ROI"
                value={formatPercentage(metrics.roi)}
                trend={metrics.roi > 0 ? "positive" : "negative"}
                tooltip="Return on investment across all picks. (units won / total picks) × 100."
              />
              <HeroStat
                label="Units Won"
                value={`${metrics.unitsWon > 0 ? "+" : ""}${formatDecimal(metrics.unitsWon)}U`}
                trend={metrics.unitsWon > 0 ? "positive" : "negative"}
                tooltip="Net profit in units staked, assuming 1 unit per pick at posted odds."
              />
              <HeroStat
                label="CLV Hit Rate"
                value={metrics.clvSampleSize >= 20 ? formatPercentage(metrics.clvHitRate) : "—"}
                subLabel={metrics.clvSampleSize > 0 ? `${metrics.clvSampleSize} picks with close data` : "No closing line data yet"}
                tooltip="Percentage of picks that beat the closing line. Above 50% confirms genuine edge."
              />
            </div>
          </section>

          {/* SECONDARY STATS */}
          <section>
            <SectionLabel icon={<Activity size={12} />} text="Secondary Metrics" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SecondaryStat
                label="Total Picks"
                value={metrics.totalPicks.toString()}
                tooltip={`Total picks graded over the last ${window} days. Larger sample = more reliable.`}
              />
              <SecondaryStat
                label="Avg EV"
                value={formatPercentage(metrics.avgEv)}
                trend={metrics.avgEv > 0 ? "positive" : "negative"}
                tooltip="Average realized expected value across graded picks. Above 0% means genuine +EV."
              />
              <SecondaryStat
                label="Max Drawdown"
                value={`${formatDecimal(metrics.maxDrawdown)}U`}
                trend="negative"
                tooltip="Largest peak-to-trough loss in units. Measures downside risk."
              />
              <SecondaryStat
                label="Brier Score"
                value={formatDecimal(metrics.brierScore, 3)}
                tooltip="Calibration accuracy. Lower is better — 0 perfect, 0.25 random."
              />
              <SecondaryStat
                label="Avg Edge"
                value={formatPercentage(metrics.avgEdge)}
                trend={metrics.avgEdge > 0 ? "positive" : "neutral"}
                tooltip="Average raw probability advantage before odds conversion."
              />
              <SecondaryStat
                label="Avg CLV"
                value={metrics.clvSampleSize >= 20 ? formatPercentage(metrics.avgClv) : "—"}
                trend={metrics.clvSampleSize >= 20 ? (metrics.avgClv > 0 ? "positive" : "neutral") : undefined}
                subLabel={metrics.clvSampleSize > 0 ? `n=${metrics.clvSampleSize} real close lines` : "Requires closing line data"}
                tooltip="Average closing line value. Positive = market confirms our side after publish."
              />
              <SecondaryStat
                label="Pass Rate"
                value={formatPercentage(metrics.passRate)}
                tooltip="Percentage of candidates filtered out as PASS. Higher = stricter."
              />
              <SecondaryStat
                label="Picks / Day"
                value={formatDecimal(metrics.picksPerDay)}
                tooltip="Average picks published per day. Selectivity is discipline."
              />
            </div>
          </section>

          {/* DISTRIBUTION */}
          <section>
            <SectionLabel icon={<Target size={12} />} text="Distribution" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <DistributionPanel
                title="By Tier"
                breakdown={metrics.tierBreakdown}
                colors={TIER_COLORS}
                renderKey={(k) => `Tier ${k}`}
              />
              <DistributionPanel
                title="By League"
                breakdown={metrics.leagueBreakdown}
                colors={LEAGUE_COLORS}
                renderKey={(k) => k.toUpperCase()}
              />
              <DistributionPanel
                title="By Market"
                breakdown={metrics.marketBreakdown}
                colors={MARKET_COLORS}
                renderKey={(k) => k.charAt(0).toUpperCase() + k.slice(1)}
              />
            </div>
          </section>
        </div>
      ) : (
        <div className="py-24 text-center border border-[#1A3066] rounded-sm bg-[#0D1B3E]/50">
          <p className="text-white/50">Failed to load performance metrics.</p>
        </div>
      )}
    </PageLayout>
  );
}

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 mb-5 text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">
      <span className="text-[#FFC107]">{icon}</span>
      {text}
      <span className="flex-1 h-px bg-[#1A3066] ml-2" />
    </div>
  );
}

function HeroStat({
  label, value, trend, tooltip, subLabel,
}: {
  label: string; value: string; trend?: "positive" | "negative" | "neutral"; tooltip?: string; subLabel?: string;
}) {
  return (
    <div className="bg-[#0D1B3E] p-6 hover:bg-[#112454] transition-colors">
      <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-3 flex items-center">
        {label}
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div
        className={`text-4xl md:text-5xl font-bold leading-none ${
          trend === "positive" ? "text-[#4ADE80]" :
          trend === "negative" ? "text-[#F87171]" :
          "text-white"
        }`}
        style={{ fontFamily: SERIF }}
      >
        {value}
      </div>
      {subLabel && (
        <div className="text-[10px] text-white/40 mt-3">{subLabel}</div>
      )}
    </div>
  );
}

function SecondaryStat({
  label, value, trend, tooltip, subLabel,
}: {
  label: string; value: string; trend?: "positive" | "negative" | "neutral"; tooltip?: string; subLabel?: string;
}) {
  return (
    <div className="bg-[#0D1B3E] border border-[#1A3066] rounded-sm p-5 hover:border-[#FFC107]/30 transition-colors">
      <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2 flex items-center">
        {label}
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div
        className={`text-2xl font-bold leading-none ${
          trend === "positive" ? "text-[#4ADE80]" :
          trend === "negative" ? "text-[#F87171]" :
          "text-white"
        }`}
        style={{ fontFamily: SERIF }}
      >
        {value}
      </div>
      {subLabel && (
        <div className="text-[10px] text-white/40 mt-2">{subLabel}</div>
      )}
    </div>
  );
}

function DistributionPanel({
  title, breakdown, colors, renderKey,
}: {
  title: string;
  breakdown: Record<string, number> | undefined;
  colors: Record<string, string>;
  renderKey: (k: string) => string;
}) {
  const entries = Object.entries(breakdown || {});
  const total = entries.reduce((sum, [, count]) => sum + (count as number), 0);

  return (
    <div className="bg-[#0D1B3E] border border-[#1A3066] rounded-sm p-6">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#FFC107] mb-5">
        {title}
      </h3>
      {entries.length === 0 ? (
        <div className="text-white/40 text-sm py-2">No data in window.</div>
      ) : (
        <div className="space-y-3">
          {entries.map(([k, count]) => {
            const pct = total > 0 ? (count as number) / total : 0;
            return (
              <div key={k}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="flex items-center gap-2 text-white/85">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: colors[k] || "#1A3066" }}
                    />
                    <span className="font-medium">{renderKey(k)}</span>
                  </span>
                  <span className="text-white/50 font-mono text-xs">
                    {count} <span className="text-white/30">({Math.round(pct * 100)}%)</span>
                  </span>
                </div>
                <div className="h-1 bg-[#060D1F] rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${pct * 100}%`,
                      backgroundColor: colors[k] || "#1A3066",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
