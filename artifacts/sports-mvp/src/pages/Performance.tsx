import { useState } from "react";
import { useGetPerformance, getGetPerformanceQueryKey, GetPerformanceWindow } from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { formatPercentage, formatDecimal } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";

const TIER_COLORS: Record<string, string> = {
  A: '#FFC107', B: '#0033A0', C: '#424242', PASS: '#1A3066',
};
const LEAGUE_COLORS: Record<string, string> = {
  nba: '#C9082A', nhl: '#006BB6', ncaam: '#CC8800',
};
const MARKET_COLORS: Record<string, string> = {
  moneyline: '#0033A0', spread: '#5C35CC', total: '#00897B',
};

function HowItWorks({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-lg border border-[#1A3066] bg-[#0D1B3E] overflow-hidden mb-8">
      <button
        className="w-full flex items-center justify-between px-5 py-3 text-left"
        onClick={onToggle}
      >
        <span className="text-xs font-bold font-display uppercase tracking-widest text-muted-foreground">How the Model Works</span>
        {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-muted-foreground border-t border-[#1A3066] pt-4">
          <div>
            <div className="text-white font-bold font-display mb-1 uppercase text-xs tracking-wider">1. Probability Estimation</div>
            <p>Nine separate ML models generate raw win/cover/over probabilities — one per league (NBA, NHL, NCAAM) per market type (moneyline, spread, total). Each model is trained on historical game data and updated regularly.</p>
          </div>
          <div>
            <div className="text-white font-bold font-display mb-1 uppercase text-xs tracking-wider">2. Calibration</div>
            <p>Raw probabilities are calibrated using Platt Scaling (sigmoid) or isotonic regression to correct for systematic over/under-confidence. Calibrated probabilities are closer to the true empirical frequencies.</p>
          </div>
          <div>
            <div className="text-white font-bold font-display mb-1 uppercase text-xs tracking-wider">3. Scoring &amp; Edge</div>
            <p>Fair market probability is extracted by removing the bookmaker's vig. <strong className="text-foreground">Edge = calibrated prob − fair prob</strong>. <strong className="text-foreground">EV = p×(decimal−1) − (1−p)</strong>. Picks are ranked by a composite score weighting EV (50%), edge (25%), calibration confidence (15%), and market quality (10%).</p>
          </div>
          <div>
            <div className="text-white font-bold font-display mb-1 uppercase text-xs tracking-wider">4. Tier Assignment</div>
            <p>The top-ranked picks above minimum thresholds are assigned tiers: <strong className="text-[#FFC107]">A ≥ 0.65</strong>, <strong className="text-[#4488FF]">B ≥ 0.50</strong>, <strong className="text-[#424242]">C ≥ 0.35</strong>. Below 0.35 is a PASS. Only tiers A–C are published.</p>
          </div>
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
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/logo-shield.png" alt="SportsMVP" className="h-12 w-auto drop-shadow-lg" />
          <div>
            <h1 className="text-4xl font-display text-foreground uppercase tracking-tight">Model Performance</h1>
            <p className="text-muted-foreground mt-1">Rolling analytics and verified track record.</p>
          </div>
        </div>
        <Select value={window.toString()} onValueChange={(v) => setWindow(Number(v) as GetPerformanceWindow)}>
          <SelectTrigger className="w-[160px] bg-card border-border">
            <SelectValue placeholder="Time Window" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="14">Last 14 Days</SelectItem>
            <SelectItem value="30">Last 30 Days</SelectItem>
            <SelectItem value="45">Last 45 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <HowItWorks open={howItWorksOpen} onToggle={() => setHowItWorksOpen(v => !v)} />

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl bg-card" />
          ))}
        </div>
      ) : metrics ? (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Win Rate"
              value={formatPercentage(metrics.winRate)}
              trend={metrics.winRate > 0.52 ? "positive" : "neutral"}
              tooltip="Percentage of picks graded as wins, excluding pushes."
            />
            <StatCard
              label="ROI"
              value={formatPercentage(metrics.roi)}
              trend={metrics.roi > 0 ? "positive" : "negative"}
              tooltip="Return on investment across all picks. Calculated as (units won / total picks) × 100."
            />
            <StatCard
              label="Units Won"
              value={`${metrics.unitsWon > 0 ? '+' : ''}${formatDecimal(metrics.unitsWon)}U`}
              trend={metrics.unitsWon > 0 ? "positive" : "negative"}
              tooltip="Net profit in units staked, assuming 1 unit per pick at posted odds."
            />
            <StatCard
              label="CLV Hit Rate"
              value={formatPercentage(metrics.clvHitRate)}
              tooltip="Percentage of picks that beat the closing line. Above 50% confirms the model finds genuine edge before the market corrects."
            />
            <StatCard
              label="Total Picks"
              value={metrics.totalPicks.toString()}
              tooltip={`Total picks graded over the last ${window} days. Larger sample = more reliable statistics.`}
            />
            <StatCard
              label="Avg EV"
              value={formatPercentage(metrics.avgEv)}
              trend={metrics.avgEv > 0 ? "positive" : "negative"}
              tooltip="Average expected value per pick. Above 0% means we are systematically finding +EV bets."
            />
            <StatCard
              label="Max Drawdown"
              value={`${formatDecimal(metrics.maxDrawdown)}U`}
              trend="negative"
              tooltip="The largest peak-to-trough loss in units. A measure of downside risk."
            />
            <StatCard
              label="Brier Score"
              value={formatDecimal(metrics.brierScore, 3)}
              tooltip="Calibration accuracy metric. Lower is better — 0 is perfect, 0.25 is random. Measures how well our probabilities match actual outcomes."
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Avg Edge"
              value={formatPercentage(metrics.avgEdge)}
              trend={metrics.avgEdge > 0 ? "positive" : "neutral"}
              tooltip="Average edge across all picks. This is the raw probability advantage before odds conversion."
            />
            <StatCard
              label="Avg CLV"
              value={formatPercentage(metrics.avgClv)}
              trend={metrics.avgClv > 0 ? "positive" : "neutral"}
              tooltip="Average closing line value. How much the market moves in our favor after publishing — a key indicator of genuine edge."
            />
            <StatCard
              label="Pass Rate"
              value={formatPercentage(metrics.passRate)}
              tooltip="Percentage of candidate bets filtered out as PASS. Higher pass rate = stricter standards."
            />
            <StatCard
              label="Picks / Day"
              value={formatDecimal(metrics.picksPerDay)}
              tooltip="Average number of picks published per day. Staying selective (lower is better) is a sign of discipline."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-6 bg-card border-border">
              <h3 className="text-sm font-bold font-display uppercase mb-4 text-muted-foreground tracking-wider">By Tier</h3>
              <div className="space-y-3">
                {Object.entries(metrics.tierBreakdown || {}).map(([tier, count]) => (
                  <div key={tier} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: TIER_COLORS[tier] || '#424242' }}
                      />
                      <span className="font-medium text-sm">Tier {tier}</span>
                    </div>
                    <span className="text-muted-foreground text-sm">{count} picks</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6 bg-card border-border">
              <h3 className="text-sm font-bold font-display uppercase mb-4 text-muted-foreground tracking-wider">By League</h3>
              <div className="space-y-3">
                {Object.entries(metrics.leagueBreakdown || {}).map(([league, count]) => (
                  <div key={league} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: LEAGUE_COLORS[league] || '#0033A0' }}
                      />
                      <span className="font-medium text-sm uppercase">{league}</span>
                    </div>
                    <span className="text-muted-foreground text-sm">{count} picks</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6 bg-card border-border">
              <h3 className="text-sm font-bold font-display uppercase mb-4 text-muted-foreground tracking-wider">By Market</h3>
              <div className="space-y-3">
                {Object.entries(metrics.marketBreakdown || {}).map(([market, count]) => (
                  <div key={market} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: MARKET_COLORS[market] || '#0033A0' }}
                      />
                      <span className="font-medium text-sm capitalize">{market}</span>
                    </div>
                    <span className="text-muted-foreground text-sm">{count} picks</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="py-20 text-center border border-border rounded-xl bg-card/30">
          <p className="text-muted-foreground">Failed to load performance metrics.</p>
        </div>
      )}
    </PageLayout>
  );
}

function StatCard({
  label, value, trend, tooltip
}: {
  label: string;
  value: string;
  trend?: "positive" | "negative" | "neutral";
  tooltip?: string;
}) {
  return (
    <Card className="p-5 flex flex-col justify-center bg-card hover:bg-[#112454] transition-colors border-border">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center">
        {label}
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className={`text-3xl font-display font-black ${
        trend === 'positive' ? 'text-[#388E3C]' :
        trend === 'negative' ? 'text-[#D32F2F]' :
        'text-foreground'
      }`}>
        {value}
      </div>
    </Card>
  );
}
