import { useEffect, useMemo, useState } from "react";

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v, digits = 1) {
  const n = num(v);
  if (n == null) return "—";
  return `${n.toFixed(digits)}%`;
}

function pctFromUnit(v, digits = 1) {
  const n = num(v);
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function oddsText(v) {
  const n = num(v);
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function impliedFromAmerican(odds) {
  const o = num(odds);
  if (o == null || o === 0) return null;
  if (o > 0) return 100 / (o + 100);
  return Math.abs(o) / (Math.abs(o) + 100);
}

function normalizeUpsetRows(data) {
  const rootArray =
    (Array.isArray(data?.rows) && data.rows) ||
    (Array.isArray(data?.items) && data.items) ||
    (Array.isArray(data?.candidates) && data.candidates) ||
    (Array.isArray(data?.upsets) && data.upsets) ||
    (Array.isArray(data?.games) && data.games) ||
    [];

  return rootArray.map((row, idx) => {
    const books = Array.isArray(row?.books)
      ? row.books
      : Array.isArray(row?.sportsbooks)
      ? row.sportsbooks
      : Array.isArray(row?.bookmakers)
      ? row.bookmakers
      : [];

    const normalizedBooks = books
      .map((b) => ({
        name: b?.name || b?.book || b?.bookmaker || b?.key || "Book",
        odds: b?.odds ?? b?.price ?? b?.dogOdds ?? null,
      }))
      .filter((b) => b.odds != null);

    const underdog =
      row?.underdog ||
      row?.dog ||
      row?.away ||
      row?.awayTeam ||
      row?.away_abbr ||
      "Underdog";

    const favorite =
      row?.fav ||
      row?.favorite ||
      row?.home ||
      row?.homeTeam ||
      row?.home_abbr ||
      "Favorite";

    const dogOdds = row?.dogOdds ?? row?.odds ?? normalizedBooks[0]?.odds ?? null;
    const dogWinProb = num(row?.dogWinProb ?? row?.modelDogProb ?? row?.underdogWinProb ?? row?.dog_prob);
    const impliedDogProb = num(row?.impliedDogProb ?? row?.dogImpliedProb ?? impliedFromAmerican(dogOdds));
    const conf = num(row?.conf ?? row?.confidence ?? row?.modelConf ?? dogWinProb);
    const rawScore = num(row?.score ?? row?.watchScore ?? row?.dogEdgeScore);
    const edge = dogWinProb != null && impliedDogProb != null ? (dogWinProb - impliedDogProb) * 100 : null;

    return {
      id: row?.id || row?.gameId || `${idx}`,
      matchup: row?.matchup || `${underdog} @ ${favorite}`,
      underdog,
      favorite,
      dogOdds,
      dogWinProb,
      impliedDogProb,
      conf,
      edge,
      score: rawScore != null ? rawScore : dogWinProb != null && impliedDogProb != null ? Math.max(0, Math.min(100, 50 + (dogWinProb - impliedDogProb) * 200)) : null,
      why: row?.why || row?.reason || row?.notes || "",
      books: normalizedBooks,
    };
  });
}

function cardStyle() {
  return {
    background: "rgba(9,15,28,0.82)",
    border: "1px solid rgba(148,163,184,0.14)",
    borderRadius: 22,
    boxShadow: "0 18px 46px rgba(0,0,0,0.22)",
  };
}

function tileStyle() {
  return {
    background: "rgba(15,23,42,0.9)",
    border: "1px solid rgba(148,163,184,0.12)",
    borderRadius: 16,
    padding: 14,
  };
}

export default function Upsets() {
  const [league, setLeague] = useState("nba");
  const [date, setDate] = useState(todayYMD());
  const [windowDays, setWindowDays] = useState(21);
  const [minDogWin, setMinDogWin] = useState(0.3);
  const [limit, setLimit] = useState(20);
  const [mode, setMode] = useState("watch");
  const [sort, setSort] = useState("score");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const url =
          `/api/upsetsOdds?league=${league}&date=${date}&window=${windowDays}&minDogWin=${minDogWin}&limit=${limit}&mode=${mode}&sort=${sort}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("Failed to load upset opportunities.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [league, date, windowDays, minDogWin, limit, mode, sort]);

  const rows = useMemo(() => normalizeUpsetRows(data), [data]);
  const featured = rows[0] || null;

  const styles = {
    page: {
      minHeight: "100vh",
      background:
        "radial-gradient(circle at top left, rgba(30,111,219,0.20), transparent 26%), radial-gradient(circle at top right, rgba(139,92,246,0.16), transparent 24%), linear-gradient(180deg, #071224 0%, #040b18 100%)",
      color: "#e5e7eb",
      padding: "28px 20px 40px",
    },
    shell: { maxWidth: 1180, margin: "0 auto" },
    hero: {
      ...cardStyle(),
      padding: 24,
      marginBottom: 20,
      background:
        "linear-gradient(180deg, rgba(9,15,28,0.92) 0%, rgba(7,12,24,0.96) 100%)",
    },
    topGrid: {
      display: "grid",
      gridTemplateColumns: "320px 1fr",
      gap: 18,
      alignItems: "start",
    },
    formCard: { ...tileStyle(), padding: 16 },
    label: {
      display: "block",
      fontSize: 12,
      color: "#94a3b8",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      marginBottom: 6,
      fontWeight: 700,
    },
    input: {
      width: "100%",
      background: "rgba(30,41,59,0.82)",
      border: "1px solid rgba(148,163,184,0.18)",
      color: "#f8fafc",
      borderRadius: 12,
      padding: "10px 12px",
      outline: "none",
    },
    overline: {
      fontSize: 12,
      color: "#93c5fd",
      textTransform: "uppercase",
      letterSpacing: "0.14em",
      fontWeight: 800,
      marginBottom: 10,
    },
    h2: {
      margin: 0,
      fontSize: 28,
      fontWeight: 800,
      color: "#f8fafc",
    },
    panelGrid: {
      display: "grid",
      gridTemplateColumns: "1.35fr 0.95fr",
      gap: 20,
    },
    sectionPanel: { ...cardStyle(), padding: 22 },
    gaugeTrack: {
      width: "100%",
      height: 12,
      background: "rgba(30,41,59,0.95)",
      borderRadius: 999,
      overflow: "hidden",
      border: "1px solid rgba(148,163,184,0.12)",
    },
    statGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: 12,
      marginTop: 14,
    },
    statTile: { ...tileStyle(), padding: 12 },
    metricLabel: {
      fontSize: 11,
      color: "#94a3b8",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      fontWeight: 700,
      marginBottom: 6,
    },
    metricValue: {
      fontSize: 24,
      lineHeight: 1.05,
      fontWeight: 800,
      color: "#f8fafc",
    },
    cardList: {
      display: "grid",
      gap: 14,
      marginTop: 14,
    },
    upsetCard: {
      ...tileStyle(),
      padding: 16,
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <section style={styles.hero}>
          <div style={styles.overline}>Premium Upset Watch</div>
          <h1 style={styles.h2}>Upsets</h1>
          <p style={{ color: "#94a3b8", marginTop: 8, marginBottom: 0 }}>
            Premium underdog scanner with upset probability gauges, sportsbook comparison, and dog edge scoring.
          </p>

          <div style={styles.topGrid}>
            <div style={styles.formCard}>
              <div style={{ marginBottom: 12 }}>
                <label style={styles.label}>League</label>
                <select value={league} onChange={(e) => setLeague(e.target.value)} style={styles.input}>
                  <option value="nba">NBA</option>
                  <option value="nhl">NHL</option>
                  <option value="ncaam">NCAAM</option>
                </select>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={styles.label}>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={styles.input} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={styles.label}>Window</label>
                  <input type="number" min="7" max="60" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value) || 21)} style={styles.input} />
                </div>
                <div>
                  <label style={styles.label}>Limit</label>
                  <input type="number" min="5" max="50" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 20)} style={styles.input} />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={styles.label}>Min Dog Win %</label>
                <input type="number" min="0.1" max="0.9" step="0.05" value={minDogWin} onChange={(e) => setMinDogWin(Number(e.target.value) || 0.3)} style={styles.input} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={styles.label}>Mode</label>
                  <select value={mode} onChange={(e) => setMode(e.target.value)} style={styles.input}>
                    <option value="watch">Watch</option>
                    <option value="strict">Strict</option>
                  </select>
                </div>
                <div>
                  <label style={styles.label}>Sort</label>
                  <select value={sort} onChange={(e) => setSort(e.target.value)} style={styles.input}>
                    <option value="score">Score</option>
                    <option value="dogWinProb">Dog Win %</option>
                    <option value="dogEdge">Dog Edge</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={tileStyle()}>
              <div style={styles.metricLabel}>Top Dog Opportunity</div>

              {!featured ? (
                <div style={{ color: "#94a3b8" }}>{loading ? "Loading..." : error || "No upset candidates."}</div>
              ) : (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc" }}>{featured.matchup}</div>
                  <div style={{ marginTop: 8, color: "#cbd5e1", fontSize: 16 }}>
                    Dog {featured.underdog} • Best price {oddsText(featured.dogOdds)}
                  </div>

                  <div style={styles.statGrid}>
                    <div style={styles.statTile}>
                      <div style={styles.metricLabel}>Upset Prob</div>
                      <div style={{ ...styles.metricValue, color: "#93c5fd" }}>{pctFromUnit(featured.dogWinProb, 1)}</div>
                    </div>
                    <div style={styles.statTile}>
                      <div style={styles.metricLabel}>Dog Edge</div>
                      <div style={{ ...styles.metricValue, color: "#86efac" }}>{featured.edge == null ? "—" : pct(featured.edge, 1)}</div>
                    </div>
                    <div style={styles.statTile}>
                      <div style={styles.metricLabel}>Dog Score</div>
                      <div style={{ ...styles.metricValue, color: "#fcd34d" }}>{featured.score == null ? "—" : `${Math.round(featured.score)}`}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                      <span>Upset Probability Gauge</span>
                      <span>{pctFromUnit(featured.dogWinProb, 1)}</span>
                    </div>
                    <div style={styles.gaugeTrack}>
                      <div
                        style={{
                          width: `${Math.max(0, Math.min(100, (Number(featured.dogWinProb) || 0) * 100))}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, #2563eb 0%, #22c55e 100%)",
                          borderRadius: 999,
                        }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <div style={styles.panelGrid}>
          <section style={styles.sectionPanel}>
            <div style={styles.overline}>Premium Dog Scanner</div>
            <h2 style={styles.h2}>Upset Candidates</h2>

            {loading ? (
              <div style={{ ...tileStyle(), marginTop: 14 }}>Loading upset candidates...</div>
            ) : error ? (
              <div style={{ ...tileStyle(), marginTop: 14, color: "#fda4af" }}>{error}</div>
            ) : rows.length === 0 ? (
              <div style={{ ...tileStyle(), marginTop: 14 }}>No upset candidates on this slate.</div>
            ) : (
              <div style={styles.cardList}>
                {rows.map((row) => (
                  <article key={row.id} style={styles.upsetCard}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "start" }}>
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc" }}>{row.matchup}</div>
                        <div style={{ marginTop: 6, color: "#cbd5e1", fontSize: 15 }}>
                          Dog: {row.underdog} • Favorite: {row.favorite}
                        </div>
                      </div>
                      <div style={{ ...tileStyle(), padding: "8px 12px", minWidth: 78, textAlign: "center" }}>
                        <div style={styles.metricLabel}>Score</div>
                        <div style={{ ...styles.metricValue, color: "#fcd34d", fontSize: 22 }}>
                          {row.score == null ? "—" : Math.round(row.score)}
                        </div>
                      </div>
                    </div>

                    <div style={styles.statGrid}>
                      <div style={styles.statTile}>
                        <div style={styles.metricLabel}>Model Dog %</div>
                        <div style={{ ...styles.metricValue, color: "#93c5fd" }}>{pctFromUnit(row.dogWinProb, 1)}</div>
                      </div>
                      <div style={styles.statTile}>
                        <div style={styles.metricLabel}>Implied Dog %</div>
                        <div style={{ ...styles.metricValue, color: "#f8fafc" }}>{pctFromUnit(row.impliedDogProb, 1)}</div>
                      </div>
                      <div style={styles.statTile}>
                        <div style={styles.metricLabel}>Dog Edge</div>
                        <div style={{ ...styles.metricValue, color: "#86efac" }}>{row.edge == null ? "—" : pct(row.edge, 1)}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                        <span>Confidence Gauge</span>
                        <span>{pctFromUnit(row.conf, 1)}</span>
                      </div>
                      <div style={styles.gaugeTrack}>
                        <div
                          style={{
                            width: `${Math.max(0, Math.min(100, (Number(row.conf) || 0) * 100))}%`,
                            height: "100%",
                            background: "linear-gradient(90deg, #2563eb 0%, #22c55e 100%)",
                            borderRadius: 999,
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: 14 }}>
                      <div style={styles.metricLabel}>Sportsbook Odds Comparison</div>
                      {(row.books || []).length === 0 ? (
                        <div style={tileStyle()}>
                          <div style={{ color: "#94a3b8", fontSize: 14 }}>
                            Best available dog price: {oddsText(row.dogOdds)}
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                          {row.books.slice(0, 4).map((book) => (
                            <div key={`${row.id}-${book.name}`} style={tileStyle()}>
                              <div style={styles.metricLabel}>{book.name}</div>
                              <div style={{ ...styles.metricValue, fontSize: 22 }}>{oddsText(book.odds)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {row.why ? (
                      <div style={{ marginTop: 14, color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>{row.why}</div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside style={{ display: "grid", gap: 20 }}>
            <section style={styles.sectionPanel}>
              <div style={styles.overline}>Slate Snapshot</div>
              <h2 style={styles.h2}>Summary</h2>
              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                <div style={tileStyle()}>
                  <div style={styles.metricLabel}>League</div>
                  <div style={styles.metricValue}>{league.toUpperCase()}</div>
                </div>
                <div style={tileStyle()}>
                  <div style={styles.metricLabel}>Candidates</div>
                  <div style={styles.metricValue}>{rows.length}</div>
                </div>
                <div style={tileStyle()}>
                  <div style={styles.metricLabel}>Mode</div>
                  <div style={styles.metricValue}>{mode}</div>
                </div>
              </div>
            </section>

            <section style={styles.sectionPanel}>
              <div style={styles.overline}>How to Use</div>
              <h2 style={styles.h2}>Why This Page Matters</h2>
              <div style={{ ...tileStyle(), marginTop: 14, color: "#94a3b8", lineHeight: 1.7 }}>
                The best upset opportunities happen when the model gives the underdog a materially better chance
                than the sportsbook implies. This page ranks those dogs by probability, edge, score, and available prices.
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
