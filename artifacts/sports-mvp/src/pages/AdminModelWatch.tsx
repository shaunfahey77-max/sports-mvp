import { useState } from "react";
import axios from "axios";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPercentage, formatDecimal } from "@/lib/utils";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

const SERIF = "'Playfair Display', serif";

interface BucketStats {
  samples: number;
  resolved: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  winRate: number;
  roi: number;
  unitsWon: number;
  avgEdge: number;
  avgEv: number;
  clvSampleSize: number;
  clvHitRate: number;
  avgClv: number;
}

interface RecentPick {
  date: string;
  gameKey: string;
  tier: string;
  pick: string;
  publishOdds: number;
  result: string;
  clvImpliedDelta: number | null;
}

interface MarketBucket {
  league: string;
  market: string;
  total: BucketStats;
  byTier: Record<"A" | "B" | "C", BucketStats>;
  recent?: RecentPick[];
}

interface BackfillResult {
  graded: number;
  scanned?: number;
  startDate: string;
  endDate: string;
}

interface ModelWatchResponse {
  ok: true;
  generatedAt: string;
  since: string | null;
  registry: string[];
  backfill: BackfillResult | null;
  recentLimit: number | null;
  buckets: MarketBucket[];
}

const RECENT_PICKS_LIMIT = 25;
type TierFilter = "all" | "A" | "B" | "C";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function AdminModelWatch() {
  const [secret, setSecret] = useState("");
  const [since, setSince] = useState<string>("");
  const [data, setData] = useState<ModelWatchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [backfillStart, setBackfillStart] = useState<string>(daysAgoIso(7));
  const [backfillEnd, setBackfillEnd] = useState<string>(todayIso());
  const [backfilling, setBackfilling] = useState(false);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);

  const [copyingMd, setCopyingMd] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function fetchScoreboard(opts: { withBackfill?: boolean } = {}) {
    if (!secret) {
      setError("Enter the admin secret first.");
      return;
    }
    if (since && !ISO_DATE_RE.test(since)) {
      setError("`since` must be YYYY-MM-DD.");
      return;
    }
    setError(null);
    setBackfillError(null);
    if (opts.withBackfill) {
      if (!ISO_DATE_RE.test(backfillStart) || !ISO_DATE_RE.test(backfillEnd)) {
        setBackfillError("Backfill dates must be YYYY-MM-DD.");
        return;
      }
      if (backfillStart > backfillEnd) {
        setBackfillError("Backfill start date must be on or before end date.");
        return;
      }
      setBackfilling(true);
      setBackfillStatus(null);
    } else {
      setLoading(true);
    }
    try {
      const body: Record<string, unknown> = {
        secret,
        includeRecent: true,
        recentLimit: RECENT_PICKS_LIMIT,
      };
      if (since) body.since = since;
      if (opts.withBackfill) {
        body.backfill = { startDate: backfillStart, endDate: backfillEnd };
      }
      const res = await axios.post<ModelWatchResponse>(
        "/admin/model-watch/performance",
        body
      );
      setData(res.data);
      if (opts.withBackfill && res.data.backfill) {
        const b = res.data.backfill;
        setBackfillStatus(
          `Re-graded ${b.graded} row${b.graded === 1 ? "" : "s"} between ${b.startDate} and ${b.endDate}.`
        );
      }
    } catch (e: unknown) {
      const msg =
        axios.isAxiosError(e) && e.response?.data?.error
          ? String(e.response.data.error)
          : axios.isAxiosError(e) && e.response?.status === 401
          ? "Unauthorized — secret rejected."
          : e instanceof Error
          ? e.message
          : "Request failed.";
      if (opts.withBackfill) {
        setBackfillError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      setBackfilling(false);
    }
  }

  async function copyMarkdown() {
    if (!secret) {
      setExportError("Enter the admin secret first.");
      return;
    }
    if (since && !ISO_DATE_RE.test(since)) {
      setExportError("`since` must be YYYY-MM-DD.");
      return;
    }
    setExportError(null);
    setExportStatus(null);
    setCopyingMd(true);
    try {
      const body: Record<string, unknown> = { secret, format: "markdown" };
      if (since) body.since = since;
      const res = await axios.post<string>(
        "/admin/model-watch/performance",
        body,
        { responseType: "text", transformResponse: [(d) => d] }
      );
      const text = typeof res.data === "string" ? res.data : String(res.data);
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable in this browser.");
      }
      await navigator.clipboard.writeText(text);
      setExportStatus(`Copied ${text.length} chars of Markdown to clipboard.`);
    } catch (e: unknown) {
      const msg =
        axios.isAxiosError(e) && e.response?.status === 401
          ? "Unauthorized — secret rejected."
          : axios.isAxiosError(e) && e.response?.data
          ? typeof e.response.data === "string"
            ? e.response.data
            : String(e.response.data?.error ?? "Request failed.")
          : e instanceof Error
          ? e.message
          : "Request failed.";
      setExportError(msg);
    } finally {
      setCopyingMd(false);
    }
  }

  function downloadCsv() {
    if (!data) {
      setExportError("Load the scoreboard first.");
      return;
    }
    setExportError(null);
    setExportStatus(null);
    try {
      const csv = bucketsToCsv(data.buckets);
      const stamp = data.generatedAt.replace(/[:.]/g, "-");
      const filename = `model-watch-${stamp}.csv`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus(
        `Downloaded ${filename} (${data.buckets.length * 4} row${
          data.buckets.length * 4 === 1 ? "" : "s"
        }).`
      );
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : "CSV export failed.");
    }
  }

  const liveBucketKeys = new Set(
    (data?.buckets ?? [])
      .filter((b) => b.total.samples > 0)
      .map((b) => `${b.league}_${b.market}`)
  );

  return (
    <PageLayout>
      <div className="mb-8 pb-6 border-b border-[#1A3066]">
        <div className="text-[#FFC107] text-[11px] font-bold tracking-[0.25em] uppercase mb-3">
          Admin · Internal
        </div>
        <h1
          className="text-4xl md:text-5xl font-bold text-white leading-tight"
          style={{ fontFamily: SERIF }}
        >
          Model-Watch Scoreboard
        </h1>
        <p className="text-white/55 mt-3 text-base max-w-2xl">
          Internal-only grading of markets in <code className="text-white/80">MARKET_MODEL_WATCH_ONLY</code>.
          These rows never enter the public Performance / History numbers; this page is the deciding
          surface for promoting a watched market back to live picks.
        </p>
      </div>

      {/* AUTH + FILTERS */}
      <section className="mb-10 rounded-sm border border-[#1A3066] bg-[#0D1B3E] p-6">
        <div className="flex items-center gap-2 mb-5 text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">
          <ShieldCheck size={12} className="text-[#FFC107]" />
          Authenticate &amp; load
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="adm-secret" className="text-white/60 text-xs uppercase tracking-widest">
              Admin secret
            </Label>
            <Input
              id="adm-secret"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="SESSION_SECRET"
              className="mt-2 bg-[#060D1F] border-[#1A3066] text-white"
              data-testid="input-secret"
            />
          </div>
          <div>
            <Label htmlFor="adm-since" className="text-white/60 text-xs uppercase tracking-widest">
              Since (optional)
            </Label>
            <Input
              id="adm-since"
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              className="mt-2 bg-[#060D1F] border-[#1A3066] text-white"
              data-testid="input-since"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={() => fetchScoreboard()}
              disabled={loading || !secret}
              className="w-full bg-[#FFC107] text-[#060D1F] hover:bg-[#FFD54F] font-bold uppercase tracking-widest text-xs"
              data-testid="button-load"
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin mr-2" />
                  Loading…
                </>
              ) : (
                "Load scoreboard"
              )}
            </Button>
          </div>
        </div>
        {error && (
          <div
            className="mt-4 flex items-start gap-2 text-sm text-[#FCA5A5] bg-[#3D1B1B] border border-[#5C2424] rounded-sm px-3 py-2"
            role="alert"
            data-testid="text-error"
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {data && (
          <div className="mt-4 text-[11px] uppercase tracking-widest text-white/40">
            Generated {new Date(data.generatedAt).toLocaleString()}
            {data.since ? ` · since ${data.since}` : " · all rows"}
          </div>
        )}
      </section>

      {data && (
        <>
          {/* REGISTRY */}
          <section className="mb-10">
            <div className="flex items-center gap-2 mb-5 text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">
              <span className="text-[#FFC107]">Registry</span>
              <span className="flex-1 h-px bg-[#1A3066] ml-2" />
            </div>
            <div className="rounded-sm border border-[#1A3066] bg-[#0D1B3E] p-5">
              <p className="text-white/60 text-sm mb-4">
                Markets currently in <code>MARKET_MODEL_WATCH_ONLY</code>. These are tracked
                internally only — picks for these markets are NOT surfaced to users.
              </p>
              {data.registry.length === 0 ? (
                <div className="text-white/40 text-sm" data-testid="text-registry-empty">
                  No markets in the watch registry. Everything published is live.
                </div>
              ) : (
                <ul className="flex flex-wrap gap-2" data-testid="list-registry">
                  {data.registry.map((key) => (
                    <li
                      key={key}
                      className="px-3 py-1.5 rounded-sm bg-[#060D1F] border border-[#1A3066] text-sm text-white font-mono"
                      data-testid={`registry-${key}`}
                    >
                      <span className="text-[#FFC107] mr-2">●</span>
                      {key}
                      {liveBucketKeys.has(key) ? null : (
                        <span className="ml-2 text-[10px] uppercase tracking-widest text-white/40">
                          no graded rows
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* BUCKETS */}
          <section className="mb-12">
            <div className="flex items-center gap-2 mb-5 text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">
              <span className="text-[#FFC107]">Per-market scoreboard</span>
              <span className="flex-1 h-px bg-[#1A3066] ml-2" />
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={copyMarkdown}
                disabled={copyingMd || !secret}
                variant="outline"
                size="sm"
                className="border-[#1A3066] bg-[#0D1B3E] text-white hover:bg-[#112454] hover:text-white font-bold uppercase tracking-widest text-[11px]"
                data-testid="button-copy-markdown"
              >
                {copyingMd ? (
                  <>
                    <Loader2 size={12} className="animate-spin mr-2" />
                    Copying…
                  </>
                ) : (
                  <>
                    <ClipboardCopy size={12} className="mr-2" />
                    Copy Markdown
                  </>
                )}
              </Button>
              <Button
                type="button"
                onClick={downloadCsv}
                disabled={!data || data.buckets.length === 0}
                variant="outline"
                size="sm"
                className="border-[#1A3066] bg-[#0D1B3E] text-white hover:bg-[#112454] hover:text-white font-bold uppercase tracking-widest text-[11px]"
                data-testid="button-download-csv"
              >
                <Download size={12} className="mr-2" />
                Download CSV
              </Button>
              {exportStatus && (
                <span
                  className="text-xs text-[#4ADE80]"
                  data-testid="text-export-status"
                >
                  {exportStatus}
                </span>
              )}
              {exportError && (
                <span
                  className="text-xs text-[#FCA5A5] flex items-center gap-1"
                  role="alert"
                  data-testid="text-export-error"
                >
                  <AlertCircle size={12} />
                  {exportError}
                </span>
              )}
            </div>
            {data.buckets.length === 0 ? (
              <div className="py-16 text-center border border-[#1A3066] rounded-sm bg-[#0D1B3E]/50 text-white/50">
                No buckets to show.
              </div>
            ) : (
              <div className="space-y-6">
                {data.buckets.map((bucket) => (
                  <BucketCard key={`${bucket.league}_${bucket.market}`} bucket={bucket} />
                ))}
              </div>
            )}
          </section>

          {/* BACKFILL */}
          <section className="mb-12">
            <div className="flex items-center gap-2 mb-5 text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">
              <RefreshCw size={12} className="text-[#FFC107]" />
              Re-grade backfill
              <span className="flex-1 h-px bg-[#1A3066] ml-2" />
            </div>
            <div className="rounded-sm border border-[#1A3066] bg-[#0D1B3E] p-6">
              <p className="text-white/60 text-sm mb-5">
                Re-grades every final snapshot in the date range against current scoring config and
                writes any missing rows to <code>model_watch_results</code>. Idempotent — safe to
                re-run.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label
                    htmlFor="bf-start"
                    className="text-white/60 text-xs uppercase tracking-widest"
                  >
                    Start date
                  </Label>
                  <Input
                    id="bf-start"
                    type="date"
                    value={backfillStart}
                    onChange={(e) => setBackfillStart(e.target.value)}
                    className="mt-2 bg-[#060D1F] border-[#1A3066] text-white"
                    data-testid="input-backfill-start"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="bf-end"
                    className="text-white/60 text-xs uppercase tracking-widest"
                  >
                    End date
                  </Label>
                  <Input
                    id="bf-end"
                    type="date"
                    value={backfillEnd}
                    onChange={(e) => setBackfillEnd(e.target.value)}
                    className="mt-2 bg-[#060D1F] border-[#1A3066] text-white"
                    data-testid="input-backfill-end"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    onClick={() => fetchScoreboard({ withBackfill: true })}
                    disabled={backfilling || !secret}
                    variant="outline"
                    className="w-full border-[#FFC107] text-[#FFC107] hover:bg-[#FFC107] hover:text-[#060D1F] font-bold uppercase tracking-widest text-xs"
                    data-testid="button-backfill"
                  >
                    {backfilling ? (
                      <>
                        <Loader2 size={14} className="animate-spin mr-2" />
                        Re-grading…
                      </>
                    ) : (
                      "Re-grade backfill"
                    )}
                  </Button>
                </div>
              </div>
              {backfillError && (
                <div
                  className="mt-4 flex items-start gap-2 text-sm text-[#FCA5A5] bg-[#3D1B1B] border border-[#5C2424] rounded-sm px-3 py-2"
                  role="alert"
                  data-testid="text-backfill-error"
                >
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{backfillError}</span>
                </div>
              )}
              {backfillStatus && (
                <div
                  className="mt-4 text-sm text-[#4ADE80] bg-[#0F2A1F] border border-[#1F4A33] rounded-sm px-3 py-2"
                  data-testid="text-backfill-status"
                >
                  {backfillStatus}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </PageLayout>
  );
}

function BucketCard({ bucket }: { bucket: MarketBucket }) {
  const key = `${bucket.league}_${bucket.market}`;
  const recent = bucket.recent ?? [];
  const [recentOpen, setRecentOpen] = useState(false);
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const filteredRecent =
    tierFilter === "all"
      ? recent
      : recent.filter((r) => r.tier === tierFilter);
  return (
    <div
      className="rounded-sm border border-[#1A3066] bg-[#0D1B3E] overflow-hidden"
      data-testid={`bucket-${key}`}
    >
      <div className="px-5 py-4 border-b border-[#1A3066] flex items-baseline justify-between gap-4">
        <h3
          className="text-xl text-white font-bold"
          style={{ fontFamily: SERIF }}
        >
          {bucket.league.toUpperCase()} <span className="text-white/60">{bucket.market}</span>
        </h3>
        <div className="text-[10px] uppercase tracking-widest text-white/40">
          {bucket.total.samples} samples · {bucket.total.pending} pending
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-white/40 border-b border-[#1A3066]">
              <th className="px-5 py-3 font-medium">Bucket</th>
              <th className="px-3 py-3 font-medium text-right">Samples</th>
              <th className="px-3 py-3 font-medium text-center">W-L-P</th>
              <th className="px-3 py-3 font-medium text-right">Win%</th>
              <th className="px-3 py-3 font-medium text-right">ROI</th>
              <th className="px-3 py-3 font-medium text-right">Units</th>
              <th className="px-3 py-3 font-medium text-right">Avg edge</th>
              <th className="px-3 py-3 font-medium text-right">CLV+%</th>
              <th className="px-5 py-3 font-medium text-right">Avg CLV (n)</th>
            </tr>
          </thead>
          <tbody>
            <BucketRow label="Overall" stats={bucket.total} emphasized />
            <BucketRow label="Tier A" stats={bucket.byTier.A} />
            <BucketRow label="Tier B" stats={bucket.byTier.B} />
            <BucketRow label="Tier C" stats={bucket.byTier.C} />
          </tbody>
        </table>
      </div>
      <RecentPicksPanel
        bucketKey={key}
        recent={recent}
        filtered={filteredRecent}
        open={recentOpen}
        onToggle={() => setRecentOpen((v) => !v)}
        tierFilter={tierFilter}
        onTierFilterChange={setTierFilter}
      />
    </div>
  );
}

function RecentPicksPanel({
  bucketKey,
  recent,
  filtered,
  open,
  onToggle,
  tierFilter,
  onTierFilterChange,
}: {
  bucketKey: string;
  recent: RecentPick[];
  filtered: RecentPick[];
  open: boolean;
  onToggle: () => void;
  tierFilter: TierFilter;
  onTierFilterChange: (next: TierFilter) => void;
}) {
  const total = recent.length;
  const disabled = total === 0;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="border-t border-[#1A3066]">
      <button
        type="button"
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        aria-expanded={open}
        className={`w-full flex items-center justify-between px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] ${
          disabled
            ? "text-white/30 cursor-not-allowed"
            : "text-white/60 hover:text-white hover:bg-[#112454] cursor-pointer"
        }`}
        data-testid={`button-recent-toggle-${bucketKey}`}
      >
        <span className="flex items-center gap-2">
          <Chevron size={14} />
          Recent picks
          <span className="text-white/40 normal-case tracking-normal text-xs ml-1">
            {disabled ? "(none yet)" : `(${total})`}
          </span>
        </span>
      </button>
      {open && !disabled && (
        <div data-testid={`recent-panel-${bucketKey}`}>
          <div
            className="px-5 py-3 flex flex-wrap items-center gap-2 border-t border-[#1A3066]/50 bg-[#091534]"
            role="group"
            aria-label="Filter recent picks by tier"
          >
            <span className="text-[10px] uppercase tracking-widest text-white/40 mr-1">
              Tier
            </span>
            {(["all", "A", "B", "C"] as const).map((t) => (
              <TierFilterButton
                key={t}
                bucketKey={bucketKey}
                value={t}
                active={tierFilter === t}
                onClick={() => onTierFilterChange(t)}
              />
            ))}
            <span
              className="ml-auto text-[10px] uppercase tracking-widest text-white/40"
              data-testid={`recent-count-${bucketKey}`}
            >
              Showing {filtered.length} of {total}
            </span>
          </div>
          <div className="overflow-x-auto">
            {filtered.length === 0 ? (
              <div
                className="px-5 py-6 text-sm text-white/40 text-center"
                data-testid={`recent-empty-${bucketKey}`}
              >
                No picks for tier {tierFilter} in the recent slice.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-white/40 border-b border-[#1A3066]">
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-3 py-3 font-medium">Game</th>
                    <th className="px-3 py-3 font-medium text-center">Tier</th>
                    <th className="px-3 py-3 font-medium">Side</th>
                    <th className="px-3 py-3 font-medium text-right">Publish odds</th>
                    <th className="px-3 py-3 font-medium text-center">Result</th>
                    <th className="px-5 py-3 font-medium text-right">CLV Δ</th>
                  </tr>
                </thead>
                <tbody data-testid={`recent-table-${bucketKey}`}>
                  {filtered.map((row, idx) => (
                    <RecentPickRow
                      key={`${row.date}-${row.gameKey}-${row.pick}-${idx}`}
                      row={row}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TierFilterButton({
  bucketKey,
  value,
  active,
  onClick,
}: {
  bucketKey: string;
  value: TierFilter;
  active: boolean;
  onClick: () => void;
}) {
  const label = value === "all" ? "All" : value;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 py-1 rounded-sm border text-[11px] font-bold uppercase tracking-widest transition-colors ${
        active
          ? "bg-[#FFC107] text-[#060D1F] border-[#FFC107]"
          : "bg-[#060D1F] text-white/70 border-[#1A3066] hover:text-white hover:border-[#FFC107]"
      }`}
      data-testid={`button-recent-tier-${bucketKey}-${value}`}
    >
      {label}
    </button>
  );
}

function formatAmericanOdds(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function resultClass(result: string): string {
  if (result === "win") return "text-[#4ADE80]";
  if (result === "loss") return "text-[#F87171]";
  if (result === "push") return "text-white/60";
  return "text-white/40";
}

function clvClass(delta: number | null): string {
  if (delta == null) return "text-white/40";
  if (delta > 0) return "text-[#4ADE80]";
  if (delta < 0) return "text-[#F87171]";
  return "text-white/85";
}

function RecentPickRow({ row }: { row: RecentPick }) {
  return (
    <tr
      className="border-t border-[#1A3066]/50"
      data-testid={`recent-row-${row.gameKey}-${row.pick}`}
    >
      <td className="px-5 py-2.5 font-mono text-white/85 whitespace-nowrap">
        {row.date}
      </td>
      <td className="px-3 py-2.5 font-mono text-white/85 truncate max-w-[260px]">
        {row.gameKey || "—"}
      </td>
      <td className="px-3 py-2.5 text-center font-mono text-white/85">
        {row.tier}
      </td>
      <td className="px-3 py-2.5 font-mono text-white/85">
        {row.pick || "—"}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-white/85">
        {formatAmericanOdds(row.publishOdds)}
      </td>
      <td
        className={`px-3 py-2.5 text-center font-bold uppercase tracking-widest text-[10px] ${resultClass(
          row.result
        )}`}
      >
        {row.result}
      </td>
      <td
        className={`px-5 py-2.5 text-right font-mono ${clvClass(
          row.clvImpliedDelta
        )}`}
      >
        {row.clvImpliedDelta == null
          ? "—"
          : formatDecimal(row.clvImpliedDelta, 4)}
      </td>
    </tr>
  );
}

function BucketRow({
  label,
  stats,
  emphasized,
}: {
  label: string;
  stats: BucketStats;
  emphasized?: boolean;
}) {
  const empty = stats.samples === 0;
  const rowClass = emphasized
    ? "bg-[#112454]"
    : "border-t border-[#1A3066]/50";
  const dim = empty ? "text-white/30" : "text-white/85";
  const roiColor = empty
    ? "text-white/30"
    : stats.roi > 0
    ? "text-[#4ADE80]"
    : stats.roi < 0
    ? "text-[#F87171]"
    : "text-white/85";
  const clvColor = empty
    ? "text-white/30"
    : stats.avgClv > 0
    ? "text-[#4ADE80]"
    : stats.avgClv < 0
    ? "text-[#F87171]"
    : "text-white/85";
  return (
    <tr className={rowClass} data-testid={`row-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <td className={`px-5 py-3 font-medium ${emphasized ? "text-[#FFC107]" : dim}`}>{label}</td>
      <td className={`px-3 py-3 text-right font-mono ${dim}`}>{stats.samples}</td>
      <td className={`px-3 py-3 text-center font-mono ${dim}`}>
        {stats.wins}-{stats.losses}-{stats.pushes}
      </td>
      <td className={`px-3 py-3 text-right font-mono ${dim}`}>
        {empty ? "—" : formatPercentage(stats.winRate)}
      </td>
      <td className={`px-3 py-3 text-right font-mono ${roiColor}`}>
        {empty ? "—" : formatPercentage(stats.roi)}
      </td>
      <td className={`px-3 py-3 text-right font-mono ${roiColor}`}>
        {empty
          ? "—"
          : `${stats.unitsWon > 0 ? "+" : ""}${formatDecimal(stats.unitsWon)}U`}
      </td>
      <td className={`px-3 py-3 text-right font-mono ${dim}`}>
        {empty ? "—" : formatDecimal(stats.avgEdge, 4)}
      </td>
      <td className={`px-3 py-3 text-right font-mono ${dim}`}>
        {stats.clvSampleSize === 0 ? "—" : formatPercentage(stats.clvHitRate)}
      </td>
      <td className={`px-5 py-3 text-right font-mono ${clvColor}`}>
        {stats.clvSampleSize === 0
          ? "—"
          : `${formatDecimal(stats.avgClv, 4)} (${stats.clvSampleSize})`}
      </td>
    </tr>
  );
}

const CSV_HEADERS = [
  "league",
  "market",
  "tier",
  "samples",
  "resolved",
  "wins",
  "losses",
  "pushes",
  "pending",
  "win_rate",
  "roi",
  "units_won",
  "avg_edge",
  "avg_ev",
  "clv_sample_size",
  "clv_hit_rate",
  "avg_clv",
] as const;

function csvEscape(value: string | number): string {
  const s = String(value);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function statsRow(
  league: string,
  market: string,
  tier: string,
  stats: BucketStats
): string {
  const cells: Array<string | number> = [
    league,
    market,
    tier,
    stats.samples,
    stats.resolved,
    stats.wins,
    stats.losses,
    stats.pushes,
    stats.pending,
    stats.winRate,
    stats.roi,
    stats.unitsWon,
    stats.avgEdge,
    stats.avgEv,
    stats.clvSampleSize,
    stats.clvHitRate,
    stats.avgClv,
  ];
  return cells.map(csvEscape).join(",");
}

export function bucketsToCsv(buckets: readonly MarketBucket[]): string {
  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const b of buckets) {
    lines.push(statsRow(b.league, b.market, "Overall", b.total));
    lines.push(statsRow(b.league, b.market, "A", b.byTier.A));
    lines.push(statsRow(b.league, b.market, "B", b.byTier.B));
    lines.push(statsRow(b.league, b.market, "C", b.byTier.C));
  }
  return lines.join("\n") + "\n";
}
