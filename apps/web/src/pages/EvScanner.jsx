import { useEffect, useMemo, useState } from "react";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function oddsText(v) {
  const n = num(v);
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function pctFromUnit(v, digits = 1) {
  const n = num(v);
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function americanFromProb(prob) {
  const p = num(prob);
  if (p == null || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return Math.round((-100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

function expectedValueFromAmericanOdds(winProb, americanOdds) {
  const p = num(winProb);
  const odds = num(americanOdds);
  if (p == null || odds == null || p <= 0 || p >= 1) return null;

  const profitPerUnit = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  return p * profitPerUnit - (1 - p);
}

function evTier(ev) {
  const n = num(ev);
  if (n == null) return "—";
  if (n >= 0.08) return "ELITE";
  if (n >= 0.05) return "STRONG";
  return "GOOD";
}

function tierStyle(tier) {
  if (tier === "ELITE") {
    return {
      background: "rgba(16,185,129,0.14)",
      border: "1px solid rgba(16,185,129,0.34)",
      color: "#86efac",
    };
  }
  if (tier === "STRONG") {
    return {
      background: "rgba(59,130,246,0.14)",
      border: "1px solid rgba(59,130,246,0.34)",
      color: "#93c5fd",
    };
  }
  return {
    background: "rgba(245,158,11,0.14)",
    border: "1px solid rgba(245,158,11,0.34)",
    color: "#fcd34d",
  };
}

function marketLabel(row) {
  const mt = String(row.marketType || "").toLowerCase();
  const side = String(row.pick || "").toLowerCase();
  const line = num(row.line);

  if (mt === "moneyline") return side ? `${side.toUpperCase()} ML` : "Moneyline";
  if (mt === "spread") return `${side.toUpperCase()} ${line == null ? "" : line > 0 ? `+${line}` : `${line}`}`.trim();
  if (mt === "total") return `${side === "over" ? "Over" : side === "under" ? "Under" : side} ${line == null ? "" : line}`.trim();
  return mt || "—";
}

export default function EvScanner() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [league, setLeague] = useState("all");
  const [market, setMarket] = useState("all");
  const [minEv, setMinEv] = useState("0.02");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [nbaRes, ncaamRes, nhlRes] = await Promise.all([
          fetch("/api/predictions?league=nba"),
          fetch("/api/predictions?league=ncaam"),
          fetch("/api/predictions?league=nhl"),
        ]);

        const [nbaJson, ncaamJson, nhlJson] = await Promise.all([
          nbaRes.json(),
          ncaamRes.json(),
          nhlRes.json(),
        ]);

        const sourceGames = [
          ...(nbaJson?.games || []).map((g) => ({ league: "NBA", game: g })),
          ...(ncaamJson?.games || []).map((g) => ({ league: "NCAAM", game: g })),
          ...(nhlJson?.games || []).map((g) => ({ league: "NHL", game: g })),
        ];

        const nextRows = sourceGames
          .map(({ league, game }) => {
            const recommendedBet = game?.recommendedBet;
            const oddsComparison = game?.market?.oddsComparison;

            if (!recommendedBet || !oddsComparison) return null;

            const marketType = String(recommendedBet?.marketType || "").toLowerCase();
            const pick = String(recommendedBet?.side || "").toLowerCase();
            const winProb = num(recommendedBet?.modelProb ?? game?.market?.winProb);
            const bestOdds = num(oddsComparison?.bestOdds);
            const fairOdds = americanFromProb(winProb);
            const ev =
              num(recommendedBet?.evForStake100) != null
                ? num(recommendedBet.evForStake100) / 100
                : expectedValueFromAmericanOdds(winProb, bestOdds);

            if (winProb == null || bestOdds == null || fairOdds == null || ev == null) return null;

            return {
              id: `${league}-${game?.gameId}-${marketType}-${pick}`,
              league,
              gameId: game?.gameId,
              matchup: `${game?.away?.abbr || "AWAY"} @ ${game?.home?.abbr || "HOME"}`,
              marketType,
              pick,
              line: num(recommendedBet?.line),
              bestOdds,
              fairOdds,
              ev,
              confidence: winProb,
              bestBook: oddsComparison?.bestBook || "Best Book",
              edgeScore:
                num(recommendedBet?.edge) != null
                  ? Math.round(Math.max(0, Math.min(99, num(recommendedBet.edge) * 100 * 4)))
                  : null,
            };
          })
          .filter(Boolean)
          .sort((a, b) => (num(b.ev) || -999) - (num(a.ev) || -999));

        if (!cancelled) setRows(nextRows);
      } catch (e) {
        if (!cancelled) setError("Failed to load positive EV opportunities.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const min = Number(minEv);
    return rows.filter((row) => {
      if (league !== "all" && row.league.toLowerCase() !== league) return false;
      if (market !== "all" && row.marketType !== market) return false;
      if ((num(row.ev) || 0) < min) return false;
      return true;
    });
  }, [rows, league, market, minEv]);

  const styles = {
    page: {
      minHeight: "100vh",
      background:
        "radial-gradient(circle at top left, rgba(30,111,219,0.20), transparent 26%), radial-gradient(circle at top right, rgba(139,92,246,0.16), transparent 24%), linear-gradient(180deg, #071224 0%, #040b18 100%)",
      color: "#e5e7eb",
      padding: "28px 20px 40px",
    },
    shell: { maxWidth: "1240px", margin: "0 auto" },
    card: {
      background: "rgba(9,15,28,0.82)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: "22px",
      boxShadow: "0 18px 46px rgba(0,0,0,0.22)",
    },
    statCard: {
      background: "rgba(15,23,42,0.92)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: 16,
      padding: 12,
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <section style={{ ...styles.card, padding: 24, marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 800, marginBottom: 10 }}>
            Market Edge
          </div>

          <h1 style={{ margin: 0, fontSize: 34, fontWeight: 800, color: "#f8fafc" }}>
            Positive EV Betting Scanner
          </h1>

          <p style={{ color: "#94a3b8", marginTop: 10, lineHeight: 1.7, maxWidth: 980 }}>
            Find positive expected value betting opportunities across NBA, NHL, and NCAAM.
            The Sports MVP EV Scanner compares sportsbook odds against model-derived fair odds
            to identify wagers where the market price is better than the true probability.
            These are the spots where disciplined bettors can gain a long-term mathematical edge.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "180px 180px 220px 1fr", gap: 12, marginTop: 18 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#94a3b8", textTransform: "uppercase", marginBottom: 6, fontWeight: 700 }}>
                League
              </label>
              <select value={league} onChange={(e) => setLeague(e.target.value)} style={{ width: "100%", background: "rgba(30,41,59,0.82)", border: "1px solid rgba(148,163,184,0.18)", color: "#f8fafc", borderRadius: 12, padding: "10px 12px" }}>
                <option value="all">All</option>
                <option value="nba">NBA</option>
                <option value="ncaam">NCAAM</option>
                <option value="nhl">NHL</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "#94a3b8", textTransform: "uppercase", marginBottom: 6, fontWeight: 700 }}>
                Market
              </label>
              <select value={market} onChange={(e) => setMarket(e.target.value)} style={{ width: "100%", background: "rgba(30,41,59,0.82)", border: "1px solid rgba(148,163,184,0.18)", color: "#f8fafc", borderRadius: 12, padding: "10px 12px" }}>
                <option value="all">All</option>
                <option value="moneyline">Moneyline</option>
                <option value="spread">Spread</option>
                <option value="total">Total</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "#94a3b8", textTransform: "uppercase", marginBottom: 6, fontWeight: 700 }}>
                Minimum EV
              </label>
              <select value={minEv} onChange={(e) => setMinEv(e.target.value)} style={{ width: "100%", background: "rgba(30,41,59,0.82)", border: "1px solid rgba(148,163,184,0.18)", color: "#f8fafc", borderRadius: 12, padding: "10px 12px" }}>
                <option value="0.02">2%+</option>
                <option value="0.05">5%+</option>
                <option value="0.08">8%+</option>
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "end", color: "#94a3b8", fontSize: 14 }}>
              Showing {filtered.length} positive EV opportunities
            </div>
          </div>
        </section>

        {loading ? (
          <section style={{ ...styles.card, padding: 22 }}>Loading scanner...</section>
        ) : error ? (
          <section style={{ ...styles.card, padding: 22, color: "#fda4af" }}>{error}</section>
        ) : filtered.length === 0 ? (
          <section style={{ ...styles.card, padding: 22, color: "#94a3b8" }}>No positive EV opportunities match the current filters.</section>
        ) : (
          <section style={{ display: "grid", gap: 14 }}>
            {filtered.map((row, index) => {
              const tier = evTier(row.ev);
              return (
                <article key={row.id} style={{ ...styles.card, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 800 }}>
                        #{index + 1} • {row.league}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 22, fontWeight: 800, color: "#f8fafc" }}>{row.matchup}</div>
                      <div style={{ marginTop: 8, color: "#cbd5e1", fontSize: 15 }}>
                        {marketLabel(row)} • Best Odds {oddsText(row.bestOdds)} • Fair Odds {oddsText(row.fairOdds)} • {row.bestBook}
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", ...tierStyle(tier) }}>
                        {tier} EV
                      </span>
                      {row.edgeScore != null && (
                        <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.28)", color: "#bfdbfe" }}>
                          Edge Score {row.edgeScore}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
                    <div style={styles.statCard}>
                      <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Positive EV</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "#86efac" }}>{pctFromUnit(row.ev, 2)}</div>
                    </div>

                    <div style={styles.statCard}>
                      <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Confidence</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "#bfdbfe" }}>{pctFromUnit(row.confidence, 1)}</div>
                    </div>

                    <div style={styles.statCard}>
                      <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Best Odds</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc" }}>{oddsText(row.bestOdds)}</div>
                    </div>

                    <div style={styles.statCard}>
                      <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Fair Odds</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "#cbd5e1" }}>{oddsText(row.fairOdds)}</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        <section style={{ ...styles.card, padding: 24, marginTop: 18 }}>
          <div style={{ fontSize: 12, color: "#93c5fd", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 800, marginBottom: 10 }}>
            Education
          </div>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#f8fafc" }}>How It Works</h2>

          <div style={{ display: "grid", gap: 14, marginTop: 14, color: "#cbd5e1", lineHeight: 1.7 }}>
            <p style={{ margin: 0 }}>
              Sports MVP identifies positive expected value betting opportunities by comparing
              model-derived probabilities to current sportsbook odds.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Step 1 — Model Probability:</strong> our prediction engine estimates the true
              probability of each wager using statistical inputs, market context, and pricing data.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Step 2 — Fair Odds Calculation:</strong> we convert the model probability into a
              fair line — the price where the bet would have zero long-term expected profit.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Step 3 — Sportsbook Comparison:</strong> we compare that fair line to the best
              available sportsbook price across multiple bookmakers.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Step 4 — Positive EV Detection:</strong> if the market offers a better price than
              the model’s fair odds, the wager has positive expected value.
            </p>
            <p style={{ margin: 0 }}>
              Consistently betting positive EV opportunities is one of the core mathematical foundations
              of long-term profitable sports betting. Serious bettors focus on value and closing-line
              discipline rather than chasing isolated outcomes.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
