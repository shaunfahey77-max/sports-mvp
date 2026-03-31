import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pctFromUnit(v, digits = 1) {
  const n = num(v);
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function clvCoverageUnit(v) {
  const n = num(v);
  if (n == null) return null;
  if (n > 1) return n / 100;
  if (n < 0) return null;
  return n;
}

function signedNum(v, digits = 2) {
  const n = num(v);
  if (n == null) return "—";
  const abs = Math.abs(n).toFixed(digits);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${abs}`;
}

function clvDisplay(avg, coverage, digits = 2) {
  const n = num(avg);
  const c = clvCoverageUnit(coverage);

  if (n == null) return "—";
  if (Math.abs(n) < 0.005) return "—";

  const base = signedNum(n, digits);
  if (c == null) return base;

  const pct = Math.round(c * 100);
  if (pct >= 95) return base;
  return `${base} · ${pct}%`;
}

function fmtEv(v) {
  const n = num(v);
  if (n == null) return "—";
  return `${Math.round(n)}%`;
}

function oddsText(v) {
  const n = num(v);
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function tierBonus(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "ELITE") return 10;
  if (t === "STRONG") return 6;
  if (t === "EDGE") return 3;
  return 0;
}

function edgeScoreFromBet(bet) {
  if (!bet) return 0;

  const evNorm = (clamp(num(bet?.evForStake100) || 0, 0, 80) / 80) * 100;
  const confidenceNorm = clamp((num(bet?.modelProb) || 0) * 100, 0, 100);
  const edgeNorm = (clamp((num(bet?.edge) || 0) * 100, 0, 20) / 20) * 100;
  const kellyNorm = (clamp((num(bet?.kellyHalf) || 0) * 100, 0, 5) / 5) * 100;

  const score =
    evNorm * 0.4 +
    confidenceNorm * 0.25 +
    edgeNorm * 0.2 +
    kellyNorm * 0.1 +
    tierBonus(bet?.tier);

  return Math.round(clamp(score, 0, 99));
}

function marketText(bet) {
  if (!bet) return "—";
  const mt = String(bet.marketType || "").toLowerCase();
  const side = String(bet.side || "").toLowerCase();
  const line = num(bet.line);

  if (mt === "spread") {
    const sideText = side === "away" ? "Away" : side === "home" ? "Home" : side;
    return `${sideText} ${line == null ? "" : line > 0 ? `+${line}` : `${line}`}`.trim();
  }

  if (mt === "total") {
    const sideText = side === "under" ? "Under" : side === "over" ? "Over" : side;
    return `${sideText} ${line == null ? "" : line}`.trim();
  }

  if (mt === "moneyline") {
    return side ? `${side.toUpperCase()} ML` : "Moneyline";
  }

  return "—";
}

function leagueColor(league) {
  if (league === "NBA") return "#60a5fa";
  if (league === "NHL") return "#34d399";
  if (league === "NCAAM") return "#f59e0b";
  return "#cbd5e1";
}

function tierColors(tier) {
  const t = String(tier || "").toUpperCase();

  if (t === "ELITE") {
    return {
      background: "rgba(16,185,129,0.12)",
      border: "1px solid rgba(16,185,129,0.28)",
      color: "#86efac",
    };
  }

  if (t === "STRONG") {
    return {
      background: "rgba(59,130,246,0.12)",
      border: "1px solid rgba(59,130,246,0.28)",
      color: "#93c5fd",
    };
  }

  return {
    background: "rgba(148,163,184,0.12)",
    border: "1px solid rgba(148,163,184,0.22)",
    color: "#cbd5e1",
  };
}

function normalizeGames(league, games) {
  return (games || [])
    .filter((g) => g?.recommendedBet)
    .map((g) => ({
      league,
      gameId: g.gameId,
      matchup: `${g.away?.abbr || "AWAY"} @ ${g.home?.abbr || "HOME"}`,
      awayLogo: g.away?.logo || "",
      homeLogo: g.home?.logo || "",
      bet: g.recommendedBet,
    }));
}

function bestPickForLeague(league, games) {
  const rows = normalizeGames(league, games).sort(
    (a, b) => edgeScoreFromBet(b.bet) - edgeScoreFromBet(a.bet)
  );
  return rows[0] || null;
}

export default function Landing() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kpis, setKpis] = useState(null);
  const [leaguePicks, setLeaguePicks] = useState({
    NBA: null,
    NHL: null,
    NCAAM: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [kpiRes, nbaRes, nhlRes, ncaamRes] = await Promise.all([
          fetch("/api/performance/kpis"),
          fetch("/api/predictions?league=nba"),
          fetch("/api/predictions?league=nhl"),
          fetch("/api/predictions?league=ncaam"),
        ]);

        const [kpiJson, nbaJson, nhlJson, ncaamJson] = await Promise.all([
          kpiRes.json(),
          nbaRes.json(),
          nhlRes.json(),
          ncaamRes.json(),
        ]);

        if (cancelled) return;

        setKpis(kpiJson?.data || null);
        setLeaguePicks({
          NBA: bestPickForLeague("NBA", nbaJson?.games),
          NHL: bestPickForLeague("NHL", nhlJson?.games),
          NCAAM: bestPickForLeague("NCAAM", ncaamJson?.games),
        });
      } catch {
        if (!cancelled) {
          setError("Failed to load public landing page data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    return {
      picks: kpis?.picks ?? 93,
      wins: kpis?.wins ?? 33,
      accuracy: kpis?.acc ?? 0.355,
      clv: kpis?.avg_clv_line ?? null,
      clvCoverage: kpis?.clv_coverage ?? kpis?.clvCoverage ?? null,
      impliedClv: kpis?.avg_clv_implied ?? null,
      impliedClvCoverage: kpis?.implied_clv_coverage ?? kpis?.impliedClvCoverage ?? null,
    };
  }, [kpis]);

  const previewCards = [leaguePicks.NBA, leaguePicks.NHL, leaguePicks.NCAAM].filter(Boolean);

  const styles = {
    page: {
      minHeight: "100vh",
      background:
        "radial-gradient(circle at top left, rgba(30,111,219,0.20), transparent 28%), radial-gradient(circle at top right, rgba(99,102,241,0.16), transparent 24%), linear-gradient(180deg, #050b17 0%, #030813 100%)",
      color: "#e5e7eb",
    },
    shell: {
      maxWidth: "1280px",
      margin: "0 auto",
      padding: "22px 20px 64px",
    },
    nav: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "18px",
      padding: "8px 0 24px",
      flexWrap: "wrap",
    },
    brand: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
    },
    brandLogo: {
      width: "44px",
      height: "44px",
      objectFit: "contain",
      filter: "drop-shadow(0 10px 20px rgba(0,0,0,0.35))",
    },
    brandTextWrap: {
      display: "grid",
      gap: "2px",
    },
    brandTitle: {
      margin: 0,
      color: "#f8fafc",
      fontSize: "28px",
      lineHeight: 1,
      fontWeight: 900,
    },
    brandSub: {
      margin: 0,
      color: "#94a3b8",
      fontSize: "12px",
      fontWeight: 700,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
    },
    navLinks: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      flexWrap: "wrap",
    },
    navBtn: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "12px 16px",
      borderRadius: "14px",
      textDecoration: "none",
      background: "rgba(15,23,42,0.88)",
      border: "1px solid rgba(148,163,184,0.14)",
      color: "#f8fafc",
      fontWeight: 700,
    },
    navBtnPrimary: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "12px 18px",
      borderRadius: "14px",
      textDecoration: "none",
      background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
      border: "1px solid rgba(59,130,246,0.36)",
      color: "#f8fafc",
      fontWeight: 800,
      boxShadow: "0 12px 28px rgba(37,99,235,0.28)",
    },
    card: {
      background: "rgba(8,14,26,0.84)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: "28px",
      boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
      backdropFilter: "blur(10px)",
    },
    section: {
      marginTop: "22px",
      padding: "26px",
    },
    eyebrow: {
      color: "#93c5fd",
      fontSize: "12px",
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.18em",
      margin: 0,
    },
    sectionTitle: {
      margin: 0,
      fontSize: "12px",
      color: "#93c5fd",
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.18em",
    },
    sectionHeadline: {
      margin: "10px 0 0",
      fontSize: "38px",
      lineHeight: 1.05,
      fontWeight: 900,
      color: "#f8fafc",
    },
    sectionText: {
      margin: "12px 0 0",
      color: "#94a3b8",
      fontSize: "15px",
      lineHeight: 1.75,
      maxWidth: "860px",
    },

    hero: {
      padding: "28px",
      overflow: "hidden",
    },
    heroGrid: {
      display: "grid",
      gridTemplateColumns: "minmax(0, 0.96fr) minmax(420px, 1.04fr)",
      gap: "34px",
      alignItems: "center",
    },
    heroLeft: {
      display: "grid",
      gap: "14px",
      alignContent: "start",
    },
    heroLogoPanel: {
      width: "200px",
      height: "200px",
      padding: "14px",
      borderRadius: "28px",
      background: "linear-gradient(135deg, rgba(18,39,72,0.98) 0%, rgba(33,40,54,0.96) 46%, rgba(96,74,24,0.94) 100%)",
      border: "1px solid rgba(148,163,184,0.20)",
      boxShadow: "0 18px 40px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.04)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    heroLogoPanelImg: {
      width: "110%",
      maxWidth: "100%",
      maxHeight: "180px",
      height: "auto",
      display: "block",
      objectFit: "contain",
      filter: "drop-shadow(0 16px 30px rgba(0,0,0,0.35)) contrast(1.05) saturate(1.05)",
    },
    heroEyebrow: {
      margin: 0,
      color: "#93c5fd",
      fontSize: "12px",
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.18em",
    },
    heroTitle: {
      margin: 0,
      fontSize: "72px",
      lineHeight: 0.94,
      fontWeight: 900,
      color: "#f8fafc",
      maxWidth: "620px",
    },
    heroText: {
      margin: 0,
      color: "#cbd5e1",
      fontSize: "18px",
      lineHeight: 1.75,
      maxWidth: "620px",
    },
    heroActions: {
      display: "flex",
      gap: "12px",
      flexWrap: "wrap",
      marginTop: "4px",
    },
    heroTrustRow: {
      display: "flex",
      gap: "10px",
      flexWrap: "wrap",
      marginTop: "6px",
    },
    heroTrustPill: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "11px 16px",
      borderRadius: "999px",
      background: "linear-gradient(180deg, rgba(20,28,48,0.96), rgba(12,18,32,0.96))",
      border: "1px solid rgba(96,165,250,0.14)",
      color: "#e2e8f0",
      fontSize: "12px",
      fontWeight: 800,
      letterSpacing: "0.04em",
      boxShadow: "0 10px 24px rgba(0,0,0,0.20)",
    },
    heroRight: {
      display: "grid",
      alignContent: "center",
    },
    heroShotFrame: {
      background: "linear-gradient(180deg, rgba(11,18,32,0.98), rgba(6,12,22,0.98))",
      border: "1px solid rgba(96,165,250,0.18)",
      borderRadius: "26px",
      padding: "16px",
      boxShadow: "0 34px 80px rgba(0,0,0,0.34), 0 0 44px rgba(37,99,235,0.12)",
      transform: "translateY(8px)",
    },
    heroShot: {
      width: "100%",
      height: "auto",
      display: "block",
      borderRadius: "18px",
      border: "1px solid rgba(148,163,184,0.12)",
      background: "#050b17",
    },

    galleryGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: "18px",
      marginTop: "20px",
    },
    galleryCard: {
      background: "rgba(12,18,32,0.92)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: "24px",
      padding: "16px",
      display: "grid",
      gap: "14px",
      alignContent: "start",
      boxShadow: "0 16px 38px rgba(0,0,0,0.22)",
    },
    galleryImage: {
      width: "100%",
      aspectRatio: "16 / 10",
      objectFit: "cover",
      objectPosition: "top center",
      borderRadius: "18px",
      display: "block",
      border: "1px solid rgba(148,163,184,0.12)",
      background: "#050b17",
    },
    galleryTitle: {
      margin: 0,
      fontSize: "20px",
      fontWeight: 800,
      color: "#f8fafc",
    },
    galleryText: {
      margin: 0,
      fontSize: "14px",
      lineHeight: 1.7,
      color: "#94a3b8",
    },

    featureGrid: {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.9fr)",
      gap: "24px",
      alignItems: "stretch",
      marginTop: "20px",
    },
    featureMediaWrap: {
      position: "relative",
      borderRadius: "24px",
      overflow: "hidden",
      border: "1px solid rgba(148,163,184,0.12)",
      minHeight: "420px",
      boxShadow: "0 20px 46px rgba(0,0,0,0.24)",
    },
    featureMedia: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
    },
    featureOverlay: {
      position: "absolute",
      inset: 0,
      background: "linear-gradient(135deg, rgba(3,8,19,0.08), rgba(3,8,19,0.36))",
    },
    featureContent: {
      background: "rgba(12,18,32,0.92)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: "24px",
      padding: "28px",
      display: "grid",
      gap: "14px",
      alignContent: "center",
    },
    bulletList: {
      display: "grid",
      gap: "10px",
      marginTop: "8px",
    },
    bulletRow: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      color: "#dbeafe",
      fontSize: "15px",
      fontWeight: 700,
    },
    bulletDot: {
      width: "10px",
      height: "10px",
      borderRadius: "999px",
      background: "linear-gradient(135deg, #60a5fa, #34d399)",
      flex: "0 0 auto",
      boxShadow: "0 0 14px rgba(96,165,250,0.35)",
    },

    grid4: {
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: "14px",
      marginTop: "18px",
    },
    statCard: {
      background: "rgba(12,18,32,0.92)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: "20px",
      padding: "18px",
    },
    statLabel: {
      color: "#94a3b8",
      fontSize: "12px",
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      fontWeight: 800,
    },
    statValue: {
      fontSize: "40px",
      fontWeight: 900,
      color: "#f8fafc",
      lineHeight: 1,
      marginTop: "8px",
    },

    proofGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: "16px",
      marginTop: "20px",
    },
    proofCard: {
      background: "linear-gradient(180deg, rgba(17,24,39,0.94), rgba(10,15,28,0.96))",
      border: "1px solid rgba(96,165,250,0.10)",
      borderRadius: "24px",
      padding: "18px",
      display: "grid",
      gap: "14px",
      minHeight: "100%",
    },
    proofHeader: {
      display: "grid",
      gap: "8px",
    },
    pickLeague: {
      fontSize: "12px",
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.12em",
    },
    matchup: {
      fontSize: "26px",
      lineHeight: 1.05,
      fontWeight: 900,
      color: "#f8fafc",
    },
    pickLine: {
      color: "#cbd5e1",
      fontSize: "15px",
      fontWeight: 600,
    },
    badgeRow: {
      display: "flex",
      gap: "8px",
      flexWrap: "wrap",
    },
    badge: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: "999px",
      padding: "6px 10px",
      fontSize: "11px",
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
    },
    proofMetrics: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: "10px",
      marginTop: "auto",
    },
    miniStat: {
      background: "rgba(9,15,28,0.82)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: "16px",
      padding: "12px",
    },
    miniLabel: {
      color: "#94a3b8",
      fontSize: "11px",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      fontWeight: 700,
      marginBottom: "6px",
    },
    miniValue: {
      fontSize: "22px",
      fontWeight: 800,
      color: "#f8fafc",
    },

    bannerCard: {
      position: "relative",
      overflow: "hidden",
      minHeight: "340px",
    },
    bannerImage: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
    },
    bannerOverlay: {
      position: "absolute",
      inset: 0,
      background: "linear-gradient(90deg, rgba(3,8,19,0.82) 0%, rgba(3,8,19,0.58) 48%, rgba(3,8,19,0.72) 100%)",
    },
    bannerContent: {
      position: "relative",
      zIndex: 1,
      padding: "34px",
      maxWidth: "620px",
      display: "grid",
      gap: "14px",
    },

    grid3: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: "16px",
      marginTop: "20px",
    },
    infoCard: {
      background: "rgba(12,18,32,0.92)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: "24px",
      padding: "22px",
    },
    infoTitle: {
      margin: 0,
      fontSize: "20px",
      fontWeight: 800,
      color: "#f8fafc",
    },
    infoText: {
      margin: "10px 0 0",
      color: "#94a3b8",
      fontSize: "14px",
      lineHeight: 1.7,
    },

    priceCard: {
      marginTop: "18px",
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: "18px",
      alignItems: "center",
      background: "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(14,55,96,0.92))",
      border: "1px solid rgba(96,165,250,0.18)",
      borderRadius: "24px",
      padding: "26px",
    },
    priceValue: {
      fontSize: "56px",
      fontWeight: 900,
      color: "#f8fafc",
      lineHeight: 1,
      textAlign: "right",
    },
    finePrint: {
      marginTop: "10px",
      color: "#94a3b8",
      fontSize: "14px",
      lineHeight: 1.7,
    },

    formRow: {
      marginTop: "20px",
      display: "flex",
      gap: "10px",
      flexWrap: "wrap",
    },
    input: {
      padding: "14px 16px",
      borderRadius: "12px",
      border: "1px solid rgba(148,163,184,0.20)",
      background: "rgba(15,23,42,0.90)",
      color: "#e5e7eb",
      minWidth: "280px",
      outline: "none",
    },
    button: {
      padding: "14px 20px",
      borderRadius: "12px",
      border: "none",
      background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
      color: "#fff",
      fontWeight: 800,
      cursor: "pointer",
      boxShadow: "0 12px 28px rgba(37,99,235,0.20)",
    },
    footer: {
      color: "#64748b",
      fontSize: "13px",
      textAlign: "center",
      padding: "28px 0 8px",
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <nav style={styles.nav}>
          <div style={styles.brand}>
            <img src="/sports-mvp-logo.png" alt="SportsMVP hero logo" style={styles.brandLogo} />
            <div style={styles.brandTextWrap}>
              <p style={styles.brandTitle}>SportsMVP</p>
              <p style={styles.brandSub}>NBA · NHL · NCAAM</p>
            </div>
          </div>

          <div style={styles.navLinks}>
            <a href="#gallery" style={styles.navBtn}>Platform</a>
            <a href="#proof" style={styles.navBtn}>Proof</a>
            <a href="#pricing" style={styles.navBtn}>Pricing</a>
            <Link to="/track-record" style={styles.navBtn}>Track Record</Link>
            <Link to="/app" style={styles.navBtnPrimary}>Enter App</Link>
          </div>
        </nav>

        <section style={{ ...styles.card, ...styles.hero }}>
          <div style={styles.heroGrid}>
            <div style={styles.heroLeft}>
              <div style={styles.heroLogoPanel}>
                <img src="/sports-mvp-logo.png" alt="SportsMVP logo" style={styles.heroLogoPanelImg} />
              </div>

              <p style={styles.heroEyebrow}>Professional Betting Intelligence</p>
              <h1 style={styles.heroTitle}>Bet with a sharper edge.</h1>

              <p style={styles.heroText}>
                Find positive-EV betting opportunities across NBA, NHL, and NCAAM using Edge Score —
                a model-driven ranking system combining expected value, probability edge, confidence,
                and bankroll discipline.
              </p>

              <div style={styles.heroActions}>
                <Link to="/app" style={styles.navBtnPrimary}>Enter Premium App</Link>
                <a href="#proof" style={styles.navBtn}>See Live Proof</a>
              </div>

              <div style={styles.heroTrustRow}>
                <div style={styles.heroTrustPill}>Tracked Picks {loading ? "—" : stats.picks}</div>
                <div style={styles.heroTrustPill}>Wins {loading ? "—" : stats.wins}</div>
                <div style={styles.heroTrustPill}>Accuracy {loading ? "—" : pctFromUnit(stats.accuracy, 1)}</div>
                <div style={styles.heroTrustPill}>Avg CLV {loading ? "—" : clvDisplay(stats.clv, stats.clvCoverage, 2)}</div>
              </div>
            </div>

            <div style={styles.heroRight}>
              <div style={styles.heroShotFrame}>
                <img
                  src="/landing/sports-mvp-top-picks.png"
                  alt="SportsMVP live pick board"
                  style={styles.heroShot}
                />
              </div>
            </div>
          </div>
        </section>

        <section id="gallery" style={{ ...styles.card, ...styles.section }}>
          <p style={styles.sectionTitle}>Platform Overview</p>
          <h2 style={styles.sectionHeadline}>Three core workflows built for serious bettors.</h2>
          <p style={styles.sectionText}>
            SportsMVP combines ranked plays, bankroll intelligence, and transparent performance proof
            into a single premium workflow.
          </p>

          <div style={styles.galleryGrid}>
            <article style={styles.galleryCard}>
              <img
                src="/landing/sports-mvp-top-picks.png"
                alt="SportsMVP live pick board"
                style={styles.galleryImage}
              />
              <h3 style={styles.galleryTitle}>Live Pick Board</h3>
              <p style={styles.galleryText}>
                Compare premium-ranked plays across leagues with Edge Score, EV, confidence, and bet sizing.
              </p>
            </article>

            <article style={styles.galleryCard}>
              <img
                src="/landing/sports-mvp-payout-calc.png"
                alt="SportsMVP payout calculator"
                style={styles.galleryImage}
              />
              <h3 style={styles.galleryTitle}>Bankroll Intelligence</h3>
              <p style={styles.galleryText}>
                Understand payout, expected value, and Kelly sizing before placing a bet.
              </p>
            </article>

            <article style={styles.galleryCard}>
              <img
                src="/landing/sports-mvp-trust.png"
                alt="SportsMVP verified performance"
                style={styles.galleryImage}
              />
              <h3 style={styles.galleryTitle}>Verified Performance</h3>
              <p style={styles.galleryText}>
                Show subscribers real scoring volume, win-rate context, and closing-line signal transparency.
              </p>
            </article>
          </div>
        </section>

        <section style={{ ...styles.card, ...styles.section }}>
          <div style={styles.featureGrid}>
            <div style={styles.featureMediaWrap}>
              <img
                src="/landing/sportsbook-market.jpg"
                alt="Sportsbook market screens"
                style={styles.featureMedia}
              />
              <div style={styles.featureOverlay} />
            </div>

            <div style={styles.featureContent}>
              <p style={styles.sectionTitle}>Market Intelligence</p>
              <h2 style={{ ...styles.sectionHeadline, fontSize: "42px" }}>
                Beat the market — not just the game.
              </h2>
              <p style={styles.sectionText}>
                SportsMVP identifies pricing inefficiencies across NBA, NHL, and NCAAM markets before
                sportsbooks fully adjust. The platform is built to help serious bettors evaluate edge,
                not chase blind picks.
              </p>

              <div style={styles.bulletList}>
                <div style={styles.bulletRow}>
                  <span style={styles.bulletDot} />
                  <span>Edge vs implied probability</span>
                </div>
                <div style={styles.bulletRow}>
                  <span style={styles.bulletDot} />
                  <span>Market-based ranking</span>
                </div>
                <div style={styles.bulletRow}>
                  <span style={styles.bulletDot} />
                  <span>Structured bankroll guidance</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="proof" style={{ ...styles.card, ...styles.section }}>
          <p style={styles.sectionTitle}>Proof</p>
          <h2 style={styles.sectionHeadline}>Live model-ranked opportunities from the premium scoring engine.</h2>
          <p style={styles.sectionText}>
            This section shows the model in action right now with live league leaders and recent performance context.
          </p>

          <div style={styles.grid4}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Tracked Picks</div>
              <div style={styles.statValue}>{loading ? "—" : stats.picks}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Wins</div>
              <div style={{ ...styles.statValue, color: "#86efac" }}>{loading ? "—" : stats.wins}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Accuracy</div>
              <div style={styles.statValue}>{loading ? "—" : pctFromUnit(stats.accuracy, 1)}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Avg CLV</div>
              <div style={styles.statValue}>
                {loading ? "—" : clvDisplay(stats.clv, stats.clvCoverage, 2)}
              </div>
            </div>
          </div>

          <div style={styles.proofGrid}>
            {error ? (
              <div style={styles.infoCard}>{error}</div>
            ) : previewCards.length === 0 ? (
              <div style={styles.infoCard}>No live preview picks available right now.</div>
            ) : (
              previewCards.map((row) => {
                const score = edgeScoreFromBet(row.bet);
                return (
                  <article key={`${row.league}-${row.gameId}`} style={styles.proofCard}>
                    <div style={styles.proofHeader}>
                      <div style={{ ...styles.pickLeague, color: leagueColor(row.league) }}>{row.league}</div>
                      <div style={styles.matchup}>{row.matchup}</div>
                      <div style={styles.pickLine}>
                        {marketText(row.bet)} • Odds {oddsText(row.bet?.odds)}
                      </div>
                    </div>

                    <div style={styles.badgeRow}>
                      <span style={{ ...styles.badge, ...tierColors(row.bet?.tier) }}>
                        {row.bet?.tier || "—"}
                      </span>
                      <span
                        style={{
                          ...styles.badge,
                          background: "rgba(59,130,246,0.12)",
                          border: "1px solid rgba(59,130,246,0.28)",
                          color: "#bfdbfe",
                        }}
                      >
                        Edge Score {score}
                      </span>
                    </div>

                    <div style={styles.proofMetrics}>
                      <div style={styles.miniStat}>
                        <div style={styles.miniLabel}>Edge Score</div>
                        <div style={{ ...styles.miniValue, color: "#bfdbfe" }}>{score}</div>
                      </div>
                      <div style={styles.miniStat}>
                        <div style={styles.miniLabel}>EV</div>
                        <div style={{ ...styles.miniValue, color: "#93c5fd" }}>
                          {fmtEv(row.bet?.evForStake100)}
                        </div>
                      </div>
                      <div style={styles.miniStat}>
                        <div style={styles.miniLabel}>Confidence</div>
                        <div style={styles.miniValue}>{pctFromUnit(row.bet?.modelProb, 1)}</div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section style={{ ...styles.card, ...styles.bannerCard, marginTop: "22px" }}>
          <img
            src="/landing/bettor-win.jpg"
            alt="Celebrating sports betting win"
            style={styles.bannerImage}
          />
          <div style={styles.bannerOverlay} />
          <div style={styles.bannerContent}>
            <p style={styles.sectionTitle}>Discipline over noise</p>
            <h2 style={{ ...styles.sectionHeadline, marginTop: 0 }}>
              Turn model insight into disciplined betting decisions.
            </h2>
            <p style={{ ...styles.sectionText, marginTop: 0, color: "#dbeafe" }}>
              SportsMVP helps serious bettors move from raw information to structured action.
            </p>
            <div style={styles.heroActions}>
              <Link to="/app" style={styles.navBtnPrimary}>Enter Premium App</Link>
              <a href="#pricing" style={styles.navBtn}>View Pricing</a>
            </div>
          </div>
        </section>

        <section style={{ ...styles.card, ...styles.section }}>
          <p style={styles.sectionTitle}>Why SportsMVP Wins</p>
          <h2 style={styles.sectionHeadline}>Built for disciplined bettors who want an edge.</h2>
          <p style={styles.sectionText}>
            SportsMVP is designed to help users evaluate real betting quality, prioritize stronger opportunities,
            and turn model signals into more structured execution.
          </p>

          <div style={styles.grid3}>
            <div style={styles.infoCard}>
              <h3 style={styles.infoTitle}>Market Intelligence</h3>
              <p style={styles.infoText}>
                Identify pricing inefficiencies across sportsbooks instead of reacting to generic pick content.
              </p>
            </div>
            <div style={styles.infoCard}>
              <h3 style={styles.infoTitle}>Edge Score Ranking</h3>
              <p style={styles.infoText}>
                Edge Score ranks opportunities using EV, probability edge, confidence signals, and tier strength.
              </p>
            </div>
            <div style={styles.infoCard}>
              <h3 style={styles.infoTitle}>Bankroll Discipline</h3>
              <p style={styles.infoText}>
                Suggested bet sizing turns model conviction into more structured bankroll decisions.
              </p>
            </div>
          </div>
        </section>

        <section id="pricing" style={{ ...styles.card, ...styles.section }}>
          <p style={styles.sectionTitle}>Simple Pricing</p>
          <h2 style={styles.sectionHeadline}>A premium betting intelligence platform, priced like software.</h2>
          <p style={styles.sectionText}>
            A clean subscription layer built around ranked picks, bankroll guidance, performance proof,
            and premium dashboards.
          </p>

          <div style={styles.priceCard}>
            <div>
              <div
                style={{
                  fontSize: "14px",
                  color: "#93c5fd",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                }}
              >
                SportsMVP Premium
              </div>

              <div
                style={{
                  marginTop: "10px",
                  color: "#f8fafc",
                  fontSize: "24px",
                  fontWeight: 800,
                }}
              >
                Edge-ranked picks, bankroll guidance, performance proof, and premium dashboards.
              </div>

              <div style={styles.finePrint}>
                Includes the premium pick board, live ranked opportunities, performance analytics,
                My Bets tracking, and bankroll intelligence workflows.
              </div>
            </div>

            <div>
              <div style={styles.priceValue}>$19</div>
              <div
                style={{
                  color: "#cbd5e1",
                  fontSize: "18px",
                  marginTop: "6px",
                  fontWeight: 700,
                  textAlign: "right",
                }}
              >
                / month
              </div>
              <div style={{ marginTop: "16px", textAlign: "right" }}>
                <Link to="/app" style={styles.navBtnPrimary}>Preview Premium App</Link>
              </div>
            </div>
          </div>
        </section>

        <section style={{ ...styles.card, ...styles.section }}>
          <p style={styles.sectionTitle}>Stay Ahead of the Market</p>
          <h2 style={styles.sectionHeadline}>Get SportsMVP updates and model insights.</h2>
          <p style={styles.sectionText}>
            Join the SportsMVP mailing list to receive product updates, model insights, and major
            feature releases as the platform evolves.
          </p>

          <div style={styles.formRow}>
            <input
              type="email"
              placeholder="Enter your email"
              style={styles.input}
            />
            <button style={styles.button}>Join Updates</button>
          </div>
        </section>

        <div style={styles.footer}>
          SportsMVP — premium sports betting intelligence for NBA, NHL, and NCAAM.
        </div>
      </div>
    </div>
  );
}
