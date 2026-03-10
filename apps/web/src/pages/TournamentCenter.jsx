import { useEffect, useMemo, useState } from "react";

const API_BASE = "http://127.0.0.1:3001";
const USER_KEY = "local-dev";


function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctFromUnit(v, digits = 1) {
  const n = num(v);
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPctFromUnit(v, digits = 1) {
  const n = num(v);
  if (n == null) return "—";
  const abs = Math.abs(n * 100).toFixed(digits);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${abs}%`;
}

function oddsText(v) {
  const n = num(v);
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function lineText(marketType, side, line) {
  const l = num(line);
  const mt = String(marketType || "").toLowerCase();
  const s = String(side || "").toLowerCase();

  if (mt === "moneyline") return s ? `${s.toUpperCase()} ML` : "Moneyline";
  if (mt === "spread") {
    if (l == null) return s || "Spread";
    const linePart = l > 0 ? `+${l}` : `${l}`;
    return `${s.toUpperCase()} ${linePart}`;
  }
  if (mt === "total") {
    if (l == null) return s || "Total";
    return `${s.toUpperCase()} ${l}`;
  }
  return "—";
}

function tierColors(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "ELITE") {
    return {
      background: "rgba(16,185,129,0.14)",
      border: "1px solid rgba(16,185,129,0.24)",
      color: "#86efac",
    };
  }
  if (t === "STRONG") {
    return {
      background: "rgba(59,130,246,0.14)",
      border: "1px solid rgba(59,130,246,0.24)",
      color: "#93c5fd",
    };
  }
  if (t === "EDGE") {
    return {
      background: "rgba(245,158,11,0.14)",
      border: "1px solid rgba(245,158,11,0.24)",
      color: "#fcd34d",
    };
  }
  return {
    background: "rgba(148,163,184,0.12)",
    border: "1px solid rgba(148,163,184,0.22)",
    color: "#cbd5e1",
  };
}

function sortByPriority(games) {
  return [...games].sort((a, b) => {
    const at = String(a?.market?.tier || "");
    const bt = String(b?.market?.tier || "");
    const rank = { ELITE: 3, STRONG: 2, EDGE: 1 };
    const tierDiff = (rank[bt] || 0) - (rank[at] || 0);
    if (tierDiff) return tierDiff;

    const edgeDiff = (num(b?.market?.edgeVsMarket) || 0) - (num(a?.market?.edgeVsMarket) || 0);
    if (edgeDiff) return edgeDiff;

    return (num(b?.market?.evForStake100) || 0) - (num(a?.market?.evForStake100) || 0);
  });
}

function buildLedgerPayload(game) {
  const m = game?.market || {};
  return {
    date: game?.date || new Date().toISOString().slice(0, 10),
    league: "ncaam",
    mode: "tournament",
    bet_type: "straight",
    game_key: game?.gameId || game?.game_key || `${game?.away?.abbr || "AWAY"}@${game?.home?.abbr || "HOME"}:${game?.date || new Date().toISOString().slice(0, 10)}`,
    game_label: `${game?.away?.abbr || "AWAY"} @ ${game?.home?.abbr || "HOME"}`,
    market: String(m.marketType || "moneyline").toLowerCase(),
    pick: String(m.marketSide || m.pick || "").toLowerCase(),
    line: num(m.marketLine),
    odds: num(m.marketOdds),
    stake: 25,
    book: "DraftKings",
    source: "model",
    source_meta: {
      page: "tournament-center",
      tier: m.tier || null,
      modelProb: num(m.winProb),
      edgeVsMarket: num(m.edgeVsMarket),
      evForStake100: num(m.evForStake100),
      kellyHalf: num(m.kellyHalf),
      why: Array.isArray(game?.why?.bullets) ? game.why.bullets : [],
    },
    publish_line: num(m.marketLine),
    publish_odds: num(m.marketOdds),
    notes: `Added from Tournament Center (${String(m.marketType || "").toUpperCase()} ${String(m.marketSide || m.pick || "").toUpperCase()})`,
  };
}

function getTournamentPhase(game) {
  const phase =
    String(
      game?.tournamentPhase ??
      game?.tournament_phase ??
      game?.model?.tournamentPhase ??
      ""
    )
      .trim()
      .toLowerCase();

  if (phase === "ncaa") return "ncaa";
  if (phase === "conference") return "conference";
  return "conference";
}

export default function TournamentCenter() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [games, setGames] = useState([]);
  const [meta, setMeta] = useState(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/api/predictions?league=ncaam&mode=tournament`);
      const j = await r.json();

      if (!r.ok || j?.ok === false) {
        throw new Error(j?.error || "Failed to load tournament predictions.");
      }

      setGames(Array.isArray(j?.games) ? j.games : []);
      setMeta(j?.meta || null);
    } catch (e) {
      setError(String(e?.message || "Failed to load tournament predictions."));
    } finally {
      setLoading(false);
    }
  }

  async function addToMyBets(game) {
    const key = String(game?.gameId || game?.game_key || game?.away?.abbr || "game");
    setSavingKey(key);
    setSaveMessage("");
    setError("");

    try {
      const payload = buildLedgerPayload(game);

      const res = await fetch(`${API_BASE}/api/bets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-key": USER_KEY,
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Failed to add tournament pick to My Bets.");
      }

      setSaveMessage(`Added ${payload.game_label} to My Bets.`);
      setTimeout(() => setSaveMessage(""), 3500);
    } catch (e) {
      setError(String(e?.message || "Failed to add pick to My Bets."));
    } finally {
      setSavingKey("");
    }
  }

  const filteredGames = useMemo(() => {
    if (phaseFilter === "all") return games;
    return games.filter((g) => getTournamentPhase(g) === phaseFilter);
  }, [games, phaseFilter]);

  const premiumGames = useMemo(() => {
    return sortByPriority(
      filteredGames.filter((g) => g?.market?.recommendedMarket && g?.market?.pick)
    );
  }, [filteredGames]);

  const topPicks = useMemo(() => premiumGames.slice(0, 8), [premiumGames]);

  const upsetWatch = useMemo(() => {
    return sortByPriority(
      premiumGames.filter((g) => {
        const m = g?.market || {};
        const mt = String(m.marketType || "").toLowerCase();
        const side = String(m.marketSide || m.pick || "").toLowerCase();
        const ml = g?.markets?.moneyline || {};
        const awayOdds = num(ml?.away?.odds);
        const homeOdds = num(ml?.home?.odds);
        const awayEdge = num(ml?.away?.edge);
        const homeEdge = num(ml?.home?.edge);

        if (mt === "moneyline") {
          if (side === "away" && awayOdds != null && awayOdds > 0 && (awayEdge || 0) > 0) return true;
          if (side === "home" && homeOdds != null && homeOdds > 0 && (homeEdge || 0) > 0) return true;
        }

        if (mt === "spread" && side === "away" && num(m.marketLine) != null && num(m.marketLine) > 0) return true;

        return false;
      })
    ).slice(0, 6);
  }, [premiumGames]);

  const counts = useMemo(() => {
    const conference = games.filter((g) => getTournamentPhase(g) === "conference").length;
    const ncaa = games.filter((g) => getTournamentPhase(g) === "ncaa").length;
    return {
      all: games.length,
      conference,
      ncaa,
    };
  }, [games]);

  const styles = {
    shell: {
      minHeight: "100vh",
      background:
        "radial-gradient(circle at top left, rgba(30,111,219,0.20), transparent 26%), radial-gradient(circle at top right, rgba(139,92,246,0.16), transparent 24%), linear-gradient(180deg,#071224 0%,#040b18 100%)",
      color: "#e5e7eb",
      padding: "28px 20px 40px",
    },
    card: {
      maxWidth: 1240,
      margin: "0 auto",
      background: "rgba(9,15,28,0.82)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: 24,
      boxShadow: "0 18px 46px rgba(0,0,0,0.22)",
      padding: 26,
    },
    heroWrap: {
      width: 520,
      height: 150,
      margin: "0 auto 24px",
      borderRadius: 28,
      background: "linear-gradient(135deg, rgba(30,111,219,0.16), rgba(242,183,5,0.14))",
      border: "1px solid rgba(148,163,184,0.18)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "18px 24px",
    },
    heroLogo: {
      width: "100%",
      height: "auto",
    },
    title: {
      textAlign: "center",
      fontSize: 42,
      fontWeight: 900,
      marginTop: 8,
      color: "#f8fafc",
    },
    eyebrow: {
      textAlign: "center",
      letterSpacing: "0.15em",
      fontSize: 12,
      color: "#93c5fd",
      fontWeight: 800,
    },
    desc: {
      textAlign: "center",
      color: "#94a3b8",
      maxWidth: 860,
      margin: "12px auto 0",
      lineHeight: 1.6,
      fontSize: 16,
    },
    section: {
      marginTop: 34,
    },
    sectionTitle: {
      fontSize: 28,
      fontWeight: 900,
      marginBottom: 8,
      color: "#f8fafc",
    },
    sectionDesc: {
      color: "#94a3b8",
      marginBottom: 18,
      maxWidth: 860,
      lineHeight: 1.6,
    },
    filterRow: {
      display: "flex",
      gap: 12,
      flexWrap: "wrap",
      marginTop: 18,
    },
    filterBtn: {
      border: "1px solid rgba(148,163,184,0.18)",
      borderRadius: 12,
      background: "rgba(15,23,42,0.9)",
      color: "#e2e8f0",
      padding: "10px 14px",
      fontWeight: 800,
      cursor: "pointer",
    },
    filterBtnActive: {
      border: "1px solid rgba(59,130,246,0.24)",
      borderRadius: 12,
      background: "rgba(30,111,219,0.16)",
      color: "#bfdbfe",
      padding: "10px 14px",
      fontWeight: 800,
      cursor: "pointer",
      boxShadow: "0 8px 18px rgba(37,99,235,0.18)",
    },
    picksGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: 16,
    },
    gameCard: {
      background: "rgba(15,23,42,0.9)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: 18,
      padding: 18,
    },
    topRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 10,
    },
    matchupWrap: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      minWidth: 0,
    },
    logoPair: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexShrink: 0,
    },
    teamLogo: {
      width: 34,
      height: 34,
      objectFit: "contain",
      display: "block",
      filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.22))",
    },
    matchup: {
      fontWeight: 900,
      fontSize: 24,
      color: "#f8fafc",
    },
    subRow: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 12,
    },
    chip: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "6px 10px",
      fontWeight: 800,
      fontSize: 12,
      background: "rgba(30,111,219,0.16)",
      color: "#bfdbfe",
      border: "1px solid rgba(59,130,246,0.24)",
    },
    phaseChipConference: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "6px 10px",
      fontWeight: 800,
      fontSize: 12,
      background: "rgba(245,158,11,0.14)",
      color: "#fcd34d",
      border: "1px solid rgba(245,158,11,0.24)",
    },
    phaseChipNcaa: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "6px 10px",
      fontWeight: 800,
      fontSize: 12,
      background: "rgba(139,92,246,0.14)",
      color: "#c4b5fd",
      border: "1px solid rgba(139,92,246,0.24)",
    },
    statGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: 12,
      marginTop: 14,
      marginBottom: 14,
    },
    statBox: {
      background: "rgba(9,15,28,0.72)",
      border: "1px solid rgba(148,163,184,0.10)",
      borderRadius: 14,
      padding: 12,
    },
    statLabel: {
      fontSize: 11,
      color: "#94a3b8",
      textTransform: "uppercase",
      fontWeight: 800,
      letterSpacing: "0.08em",
      marginBottom: 6,
    },
    statValue: {
      fontSize: 24,
      fontWeight: 900,
      color: "#f8fafc",
    },
    whyWrap: {
      marginTop: 10,
      background: "rgba(9,15,28,0.58)",
      border: "1px solid rgba(148,163,184,0.10)",
      borderRadius: 14,
      padding: 14,
    },
    whyTitle: {
      fontSize: 12,
      color: "#93c5fd",
      textTransform: "uppercase",
      fontWeight: 800,
      letterSpacing: "0.12em",
      marginBottom: 8,
    },
    whyBullet: {
      color: "#cbd5f5",
      fontSize: 14,
      lineHeight: 1.6,
      marginBottom: 4,
    },
    boardTableWrap: {
      overflowX: "auto",
      borderRadius: 18,
      border: "1px solid rgba(148,163,184,0.12)",
      background: "rgba(15,23,42,0.78)",
    },
    boardTable: {
      width: "100%",
      borderCollapse: "collapse",
      minWidth: 1120,
    },
    th: {
      textAlign: "left",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      color: "#94a3b8",
      padding: "14px 14px",
      borderBottom: "1px solid rgba(148,163,184,0.12)",
      background: "rgba(15,23,42,0.96)",
    },
    td: {
      padding: "14px 14px",
      borderBottom: "1px solid rgba(148,163,184,0.10)",
      color: "#e5e7eb",
      verticalAlign: "top",
      fontSize: 14,
    },
    empty: {
      color: "#94a3b8",
      padding: "16px 0",
    },
    actionRow: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      marginTop: 14,
    },
    primaryBtn: {
      border: "none",
      borderRadius: 12,
      background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
      color: "#fff",
      padding: "10px 14px",
      fontWeight: 800,
      cursor: "pointer",
      boxShadow: "0 10px 24px rgba(37,99,235,0.28)",
    },
    boardBtn: {
      border: "1px solid rgba(59,130,246,0.24)",
      borderRadius: 10,
      background: "rgba(30,111,219,0.16)",
      color: "#bfdbfe",
      padding: "8px 10px",
      fontWeight: 800,
      cursor: "pointer",
    },
    message: {
      marginTop: 18,
      color: "#86efac",
      fontWeight: 800,
      textAlign: "center",
    },
    error: {
      marginTop: 18,
      color: "#fda4af",
      fontWeight: 800,
      textAlign: "center",
    },
  };

  return (
    <div style={styles.shell}>
      <div style={styles.card}>
        <div style={styles.heroWrap}>
          <img src="/assets/sports-mvp-hero.png" style={styles.heroLogo} alt="Sports MVP Hero" />
        </div>

        <div style={styles.eyebrow}>POSTSEASON MODEL</div>

        <div style={styles.title}>Tournament Center</div>

        <div style={styles.desc}>
          Conference tournaments and March Madness create a very different betting environment.
          Neutral courts, short rest, and elimination pressure generate market inefficiencies the
          regular-season model does not capture. Tournament Mode evaluates moneyline, spread, and
          total markets to identify the highest-value opportunities each day.
        </div>

        {saveMessage ? <div style={styles.message}>{saveMessage}</div> : null}
        {error ? <div style={styles.error}>{error}</div> : null}

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Tournament Filters</div>
          <div style={styles.sectionDesc}>
            Use these filters to switch between all postseason games, conference tournament games,
            and NCAA tournament games. This helps you focus on the right part of the calendar without
            changing the rest of the application.
          </div>

          <div style={styles.filterRow}>
            <button
              type="button"
              style={phaseFilter === "all" ? styles.filterBtnActive : styles.filterBtn}
              onClick={() => setPhaseFilter("all")}
            >
              All Postseason ({counts.all})
            </button>
            <button
              type="button"
              style={phaseFilter === "conference" ? styles.filterBtnActive : styles.filterBtn}
              onClick={() => setPhaseFilter("conference")}
            >
              Conference Tournaments ({counts.conference})
            </button>
            <button
              type="button"
              style={phaseFilter === "ncaa" ? styles.filterBtnActive : styles.filterBtn}
              onClick={() => setPhaseFilter("ncaa")}
            >
              NCAA Tournament ({counts.ncaa})
            </button>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Top Tournament Picks</div>
          <div style={styles.sectionDesc}>
            These are the strongest edges identified by the Sports MVP postseason model. Use this
            section to focus on the best tournament opportunities first. Every pick includes market
            type, line, odds, probability, edge, EV, Kelly sizing, and the model’s reasoning.
          </div>

          {loading ? (
            <div style={styles.empty}>Loading tournament picks…</div>
          ) : topPicks.length === 0 ? (
            <div style={styles.empty}>No tournament picks available for this filter.</div>
          ) : (
            <div style={styles.picksGrid}>
              {topPicks.map((g, idx) => {
                const m = g.market || {};
                const tierStyle = tierColors(m.tier);
                const whyBullets = Array.isArray(g?.why?.bullets) ? g.why.bullets : [];
                const saveKey = String(g?.gameId || g?.game_key || g?.away?.abbr || idx);
                const phase = getTournamentPhase(g);

                return (
                  <div key={g.gameId || g.game_key || idx} style={styles.gameCard}>
                    <div style={styles.topRow}>
                      <div style={styles.matchupWrap}>
                        <div style={styles.logoPair}>
                          <img src={g.away?.logo || "/img/logo-fallback.svg"} alt={g.away?.abbr || "Away"} style={styles.teamLogo} />
                          <img src={g.home?.logo || "/img/logo-fallback.svg"} alt={g.home?.abbr || "Home"} style={styles.teamLogo} />
                        </div>
                        <div style={styles.matchup}>
                          {g.away?.abbr} @ {g.home?.abbr}
                        </div>
                      </div>
                      <div style={{ ...styles.chip, ...tierStyle }}>
                        {String(m.tier || "EDGE").toUpperCase()}
                      </div>
                    </div>

                    <div style={styles.subRow}>
                      <span style={styles.chip}>{String(m.marketType || "—").toUpperCase()}</span>
                      <span style={styles.chip}>{lineText(m.marketType, m.marketSide || m.pick, m.marketLine)}</span>
                      <span style={styles.chip}>Odds {oddsText(m.marketOdds)}</span>
                      <span style={styles.chip}>{g?.status || "Scheduled"}</span>
                      <span style={phase === "ncaa" ? styles.phaseChipNcaa : styles.phaseChipConference}>
                        {phase === "ncaa" ? "NCAA Tournament" : "Conference Tournament"}
                      </span>
                    </div>

                    <div style={styles.statGrid}>
                      <div style={styles.statBox}>
                        <div style={styles.statLabel}>Model Prob</div>
                        <div style={styles.statValue}>{pctFromUnit(m.winProb, 1)}</div>
                      </div>
                      <div style={styles.statBox}>
                        <div style={styles.statLabel}>Edge</div>
                        <div style={styles.statValue}>{signedPctFromUnit(m.edgeVsMarket, 1)}</div>
                      </div>
                      <div style={styles.statBox}>
                        <div style={styles.statLabel}>EV</div>
                        <div style={styles.statValue}>{num(m.evForStake100) == null ? "—" : `${Math.round(m.evForStake100)}%`}</div>
                      </div>
                      <div style={styles.statBox}>
                        <div style={styles.statLabel}>Kelly</div>
                        <div style={styles.statValue}>{pctFromUnit(m.kellyHalf, 1)}</div>
                      </div>
                    </div>

                    <div style={styles.whyWrap}>
                      <div style={styles.whyTitle}>Why the Model Likes This Pick</div>
                      {whyBullets.length ? (
                        whyBullets.map((b, i) => (
                          <div key={i} style={styles.whyBullet}>• {b}</div>
                        ))
                      ) : (
                        <div style={styles.whyBullet}>• Model edge detected in this matchup.</div>
                      )}
                    </div>

                    <div style={styles.actionRow}>
                      <button
                        type="button"
                        style={styles.primaryBtn}
                        disabled={savingKey === saveKey}
                        onClick={() => addToMyBets(g)}
                      >
                        {savingKey === saveKey ? "Adding..." : "Add to My Bets"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Upset Watch</div>
          <div style={styles.sectionDesc}>
            Tournament basketball produces more upsets than regular season games. Use this section to
            find underdogs and uncomfortable market spots where the model sees more value than the market
            is pricing in.
          </div>

          {loading ? (
            <div style={styles.empty}>Loading upset spots…</div>
          ) : upsetWatch.length === 0 ? (
            <div style={styles.empty}>No strong upset spots identified for this filter.</div>
          ) : (
            <div style={styles.picksGrid}>
              {upsetWatch.map((g, idx) => {
                const m = g.market || {};
                const whyBullets = Array.isArray(g?.why?.bullets) ? g.why.bullets : [];
                const saveKey = `upset-${String(g?.gameId || g?.game_key || g?.away?.abbr || idx)}`;
                const phase = getTournamentPhase(g);

                return (
                  <div key={g.gameId || g.game_key || `upset-${idx}`} style={styles.gameCard}>
                    <div style={styles.topRow}>
                      <div style={styles.matchupWrap}>
                        <div style={styles.logoPair}>
                          <img src={g.away?.logo || "/img/logo-fallback.svg"} alt={g.away?.abbr || "Away"} style={styles.teamLogo} />
                          <img src={g.home?.logo || "/img/logo-fallback.svg"} alt={g.home?.abbr || "Home"} style={styles.teamLogo} />
                        </div>
                        <div style={styles.matchup}>
                          {g.away?.abbr} @ {g.home?.abbr}
                        </div>
                      </div>
                      <div style={{ ...styles.chip, background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.24)", color: "#fcd34d" }}>
                        UPSET WATCH
                      </div>
                    </div>

                    <div style={styles.subRow}>
                      <span style={styles.chip}>{String(m.marketType || "—").toUpperCase()}</span>
                      <span style={styles.chip}>{lineText(m.marketType, m.marketSide || m.pick, m.marketLine)}</span>
                      <span style={styles.chip}>Odds {oddsText(m.marketOdds)}</span>
                      <span style={phase === "ncaa" ? styles.phaseChipNcaa : styles.phaseChipConference}>
                        {phase === "ncaa" ? "NCAA Tournament" : "Conference Tournament"}
                      </span>
                    </div>

                    <div style={styles.statGrid}>
                      <div style={styles.statBox}>
                        <div style={styles.statLabel}>Model Prob</div>
                        <div style={styles.statValue}>{pctFromUnit(m.winProb, 1)}</div>
                      </div>
                      <div style={styles.statBox}>
                        <div style={styles.statLabel}>Edge</div>
                        <div style={styles.statValue}>{signedPctFromUnit(m.edgeVsMarket, 1)}</div>
                      </div>
                      <div style={styles.statBox}>
                        <div style={styles.statLabel}>EV</div>
                        <div style={styles.statValue}>{num(m.evForStake100) == null ? "—" : `${Math.round(m.evForStake100)}%`}</div>
                      </div>
                      <div style={styles.statBox}>
                        <div style={styles.statLabel}>Tier</div>
                        <div style={styles.statValue}>{String(m.tier || "EDGE").toUpperCase()}</div>
                      </div>
                    </div>

                    <div style={styles.whyWrap}>
                      <div style={styles.whyTitle}>Why This Dog Is Live</div>
                      {whyBullets.length ? (
                        whyBullets.map((b, i) => (
                          <div key={i} style={styles.whyBullet}>• {b}</div>
                        ))
                      ) : (
                        <div style={styles.whyBullet}>• Underdog value detected by the tournament model.</div>
                      )}
                    </div>

                    <div style={styles.actionRow}>
                      <button
                        type="button"
                        style={styles.primaryBtn}
                        disabled={savingKey === saveKey}
                        onClick={() => addToMyBets(g)}
                      >
                        {savingKey === saveKey ? "Adding..." : "Add to My Bets"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Tournament Game Board</div>
          <div style={styles.sectionDesc}>
            This is the full slate view for tournament games. Use it to scan every matchup, compare
            market type and edge quickly, and identify where the model is strongest across moneyline,
            spread, and total opportunities.
          </div>

          <div style={styles.boardTableWrap}>
            <table style={styles.boardTable}>
              <thead>
                <tr>
                  <th style={styles.th}>Matchup</th>
                  <th style={styles.th}>Phase</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Market</th>
                  <th style={styles.th}>Pick</th>
                  <th style={styles.th}>Odds</th>
                  <th style={styles.th}>Prob</th>
                  <th style={styles.th}>Edge</th>
                  <th style={styles.th}>Tier</th>
                  <th style={styles.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td style={styles.td} colSpan={10}>Loading game board…</td>
                  </tr>
                ) : premiumGames.length === 0 ? (
                  <tr>
                    <td style={styles.td} colSpan={10}>No tournament games available for this filter.</td>
                  </tr>
                ) : (
                  premiumGames.map((g, idx) => {
                    const m = g.market || {};
                    const saveKey = `board-${String(g?.gameId || g?.game_key || g?.away?.abbr || idx)}`;
                    const phase = getTournamentPhase(g);
                    return (
                      <tr key={g.gameId || g.game_key || `board-${idx}`}>
                        <td style={styles.td}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <img src={g.away?.logo || "/img/logo-fallback.svg"} alt={g.away?.abbr || "Away"} style={{ ...styles.teamLogo, width: 24, height: 24 }} />
                            <img src={g.home?.logo || "/img/logo-fallback.svg"} alt={g.home?.abbr || "Home"} style={{ ...styles.teamLogo, width: 24, height: 24 }} />
                            <div style={{ fontWeight: 800, color: "#f8fafc" }}>
                              {g.away?.abbr} @ {g.home?.abbr}
                            </div>
                          </div>
                        </td>
                        <td style={styles.td}>{phase === "ncaa" ? "NCAA" : "Conference"}</td>
                        <td style={styles.td}>{g?.status || "Scheduled"}</td>
                        <td style={styles.td}>{String(m.marketType || "—").toUpperCase()}</td>
                        <td style={styles.td}>{lineText(m.marketType, m.marketSide || m.pick, m.marketLine)}</td>
                        <td style={styles.td}>{oddsText(m.marketOdds)}</td>
                        <td style={styles.td}>{pctFromUnit(m.winProb, 1)}</td>
                        <td style={styles.td}>{signedPctFromUnit(m.edgeVsMarket, 1)}</td>
                        <td style={styles.td}>{String(m.tier || "EDGE").toUpperCase()}</td>
                        <td style={styles.td}>
                          <button
                            type="button"
                            style={styles.boardBtn}
                            disabled={savingKey === saveKey}
                            onClick={() => addToMyBets(g)}
                          >
                            {savingKey === saveKey ? "Adding..." : "Add"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>How to Use Tournament Mode</div>
          <div style={styles.sectionDesc}>
            Tournament games behave differently than regular season matchups. Use Top Tournament Picks
            to focus on the highest-value spots first. Use Upset Watch to identify dangerous underdogs
            and volatile games. Use the filters to switch between conference tournament action and the
            NCAA tournament once the national bracket begins.
          </div>

          <div style={styles.whyWrap}>
            <div style={styles.whyTitle}>Best Practices</div>
            <div style={styles.whyBullet}>• Start with ELITE and STRONG tournament picks before expanding to the full board.</div>
            <div style={styles.whyBullet}>• In postseason play, neutral-court adjustments and short rest matter more than usual.</div>
            <div style={styles.whyBullet}>• Compare upset candidates carefully — not every underdog is a moneyline dog worth betting.</div>
            <div style={styles.whyBullet}>• Tournament phase filters are now driven by backend tournament tagging for safer postseason separation.</div>
          </div>

          {meta ? (
            <div style={{ ...styles.whyWrap, marginTop: 14 }}>
              <div style={styles.whyTitle}>Model Diagnostics</div>
              <div style={styles.whyBullet}>• Model: {meta.model || "—"}</div>
              <div style={styles.whyBullet}>• Mode: {meta.mode || "—"}</div>
              <div style={styles.whyBullet}>• Odds Feed: {meta?.odds?.ok ? "Connected" : "Unavailable"}</div>
              <div style={styles.whyBullet}>• Odds Events: {meta?.odds?.events ?? "—"}</div>
              <div style={styles.whyBullet}>• Current Filter: {phaseFilter === "all" ? "All Postseason" : phaseFilter === "conference" ? "Conference Tournaments" : "NCAA Tournament"}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
