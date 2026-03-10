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

function signedNum(v, digits = 2, prefix = "") {
  const n = num(v);
  if (n == null) return "—";
  const abs = Math.abs(n).toFixed(digits);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${prefix}${abs}`;
}

function money(v) {
  const n = num(v);
  if (n == null) return "—";
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}

function oddsText(v) {
  const n = num(v);
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function titleCase(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return "—";
  return t.charAt(0).toUpperCase() + t.slice(1).replaceAll("_", " ");
}

function clvLineText(v) {
  const n = num(v);
  if (n == null) return "—";
  const abs = Math.abs(n).toFixed(1);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${abs} pts`;
}

function clvImpliedText(v) {
  const n = num(v);
  if (n == null) return "—";
  const abs = Math.abs(n * 100).toFixed(1);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${abs}% edge`;
}

function emptyForm() {
  return {
    date: new Date().toISOString().slice(0, 10),
    league: "nba",
    mode: "regular",
    bet_type: "straight",
    parlay_type: "multi_game",
    legs_count: "2",
    legs_summary: "",
    game_key: "",
    game_label: "",
    market: "spread",
    pick: "",
    line: "",
    odds: "",
    stake: "",
    book: "",
    notes: "",
    source: "manual",
  };
}

export default function MyBets() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settlingId, setSettlingId] = useState(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [bets, setBets] = useState([]);
  const [form, setForm] = useState(emptyForm());

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [summaryRes, betsRes] = await Promise.all([
        fetch(`${API_BASE}/api/bets/summary?user_key=${encodeURIComponent(USER_KEY)}`),
        fetch(`${API_BASE}/api/bets?user_key=${encodeURIComponent(USER_KEY)}`),
      ]);

      const [summaryJson, betsJson] = await Promise.all([
        summaryRes.json(),
        betsRes.json(),
      ]);

      if (!summaryRes.ok || summaryJson?.ok === false) {
        throw new Error(summaryJson?.error || "Failed to load bet summary.");
      }
      if (!betsRes.ok || betsJson?.ok === false) {
        throw new Error(betsJson?.error || "Failed to load bets.");
      }

      setSummary(summaryJson?.data || null);
      setBets(Array.isArray(betsJson?.data) ? betsJson.data : []);
    } catch (e) {
      setError(String(e?.message || "Failed to load My Bets."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = {
        ...form,
        legs_count: form.bet_type === "parlay" ? Number(form.legs_count) : null,
        line: form.bet_type === "straight" && form.line !== "" ? Number(form.line) : null,
        odds: form.odds === "" ? null : Number(form.odds),
        stake: form.stake === "" ? null : Number(form.stake),
        market: form.bet_type === "straight" ? form.market : "moneyline",
        pick: form.bet_type === "straight" ? form.pick : "parlay",
        parlay_type: form.bet_type === "parlay" ? form.parlay_type : null,
        legs_summary: form.bet_type === "parlay" ? form.legs_summary : null,
      };

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
        throw new Error(json?.error || "Failed to add bet.");
      }

      setForm(emptyForm());
      await loadData();
    } catch (e) {
      setError(String(e?.message || "Failed to save bet."));
    } finally {
      setSaving(false);
    }
  }

  async function quickSettle(id, result) {
    setSettlingId(id);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/bets/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          result,
          settled_at: new Date().toISOString(),
        }),
      });

      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `Failed to mark bet as ${result}.`);
      }

      await loadData();
    } catch (e) {
      setError(String(e?.message || "Failed to update bet."));
    } finally {
      setSettlingId(null);
    }
  }

  const pendingCount = useMemo(
    () => bets.filter((b) => !b?.result || String(b.result).toLowerCase() === "pending").length,
    [bets]
  );

  const sortedBets = useMemo(() => {
    return [...bets].sort((a, b) => {
      const ar = String(a?.result || "pending").toLowerCase();
      const br = String(b?.result || "pending").toLowerCase();
      const ap = !a?.result || ar === "pending" ? 1 : 0;
      const bp = !b?.result || br === "pending" ? 1 : 0;
      if (bp !== ap) return bp - ap;

      const ad = String(a?.date || "");
      const bd = String(b?.date || "");
      if (ad !== bd) return bd.localeCompare(ad);

      return Number(b?.id || 0) - Number(a?.id || 0);
    });
  }, [bets]);

  const styles = {
    page: {
      minHeight: "100vh",
      background:
        "radial-gradient(circle at top left, rgba(30,111,219,0.20), transparent 26%), radial-gradient(circle at top right, rgba(139,92,246,0.16), transparent 24%), linear-gradient(180deg, #071224 0%, #040b18 100%)",
      color: "#e5e7eb",
      padding: "28px 20px 40px",
    },
    shell: {
      maxWidth: "1240px",
      margin: "0 auto",
    },
    card: {
      background: "rgba(9,15,28,0.84)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: "24px",
      boxShadow: "0 18px 46px rgba(0,0,0,0.22)",
      padding: 22,
    },
    hero: {
      textAlign: "center",
      paddingTop: 12,
      paddingBottom: 6,
    },
    heroLogoWrap: {
      width: 520,
      height: 150,
      margin: "0 auto 22px",
      borderRadius: 28,
      background: "linear-gradient(135deg, rgba(30,111,219,0.16), rgba(242,183,5,0.14))",
      border: "1px solid rgba(148,163,184,0.18)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
      padding: "18px 24px"
    },
    heroLogo: {
      width: "100%",
      height: "auto",
      objectFit: "contain",
      display: "block",
    },
    eyebrow: {
      fontSize: 12,
      color: "#93c5fd",
      textTransform: "uppercase",
      letterSpacing: "0.16em",
      fontWeight: 800,
      marginBottom: 10,
    },
    heroTitle: {
      margin: 0,
      fontSize: 42,
      fontWeight: 900,
      lineHeight: 1.05,
      color: "#f8fafc",
    },
    heroText: {
      color: "#a5b4c7",
      margin: "12px auto 0",
      fontSize: 16,
      lineHeight: 1.6,
      maxWidth: 820,
    },
    sectionTitle: {
      fontSize: 24,
      fontWeight: 900,
      color: "#f8fafc",
      margin: 0,
    },
    sectionSub: {
      color: "#94a3b8",
      marginTop: 8,
      lineHeight: 1.6,
      maxWidth: 920,
    },
    statsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
      gap: 14,
      marginTop: 18,
    },
    statTile: {
      background: "rgba(15,23,42,0.92)",
      border: "1px solid rgba(148,163,184,0.12)",
      borderRadius: 18,
      padding: 16,
    },
    statLabel: {
      fontSize: 11,
      color: "#94a3b8",
      textTransform: "uppercase",
      fontWeight: 800,
      letterSpacing: "0.08em",
      marginBottom: 8,
    },
    statValue: {
      fontSize: 28,
      fontWeight: 900,
      color: "#f8fafc",
    },
    formGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: 14,
      marginTop: 18,
    },
    field: {
      display: "grid",
      gap: 8,
    },
    label: {
      fontSize: 12,
      color: "#cbd5e1",
      fontWeight: 700,
    },
    input: {
      width: "100%",
      borderRadius: 14,
      border: "1px solid rgba(148,163,184,0.18)",
      background: "rgba(15,23,42,0.94)",
      color: "#f8fafc",
      padding: "12px 14px",
      outline: "none",
      fontSize: 14,
      boxSizing: "border-box",
    },
    textarea: {
      width: "100%",
      minHeight: 110,
      borderRadius: 14,
      border: "1px solid rgba(148,163,184,0.18)",
      background: "rgba(15,23,42,0.94)",
      color: "#f8fafc",
      padding: "12px 14px",
      outline: "none",
      fontSize: 14,
      boxSizing: "border-box",
      resize: "vertical",
    },
    buttonRow: {
      display: "flex",
      gap: 12,
      marginTop: 18,
      flexWrap: "wrap",
    },
    primaryBtn: {
      border: "none",
      borderRadius: 14,
      background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
      color: "#ffffff",
      padding: "12px 18px",
      fontWeight: 800,
      cursor: "pointer",
      boxShadow: "0 10px 24px rgba(37,99,235,0.28)",
    },
    ghostBtn: {
      border: "1px solid rgba(148,163,184,0.18)",
      borderRadius: 12,
      background: "rgba(15,23,42,0.9)",
      color: "#e2e8f0",
      padding: "10px 12px",
      fontWeight: 700,
      cursor: "pointer",
    },
    tableWrap: {
      overflowX: "auto",
      marginTop: 18,
      borderRadius: 18,
      border: "1px solid rgba(148,163,184,0.12)",
      background: "rgba(15,23,42,0.78)",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      minWidth: 1200,
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
    typeChip: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "6px 10px",
      fontWeight: 800,
      fontSize: 12,
      background: "rgba(16,185,129,0.14)",
      color: "#86efac",
      border: "1px solid rgba(16,185,129,0.24)",
    },
    parlayChip: {
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
    tournamentChip: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "5px 9px",
      fontWeight: 800,
      fontSize: 11,
      background: "rgba(245,158,11,0.14)",
      color: "#fcd34d",
      border: "1px solid rgba(245,158,11,0.24)",
    },
    statusChipPending: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "6px 10px",
      fontWeight: 800,
      fontSize: 12,
      background: "rgba(148,163,184,0.14)",
      color: "#cbd5e1",
      border: "1px solid rgba(148,163,184,0.24)",
    },
    statusChipWin: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "6px 10px",
      fontWeight: 800,
      fontSize: 12,
      background: "rgba(16,185,129,0.14)",
      color: "#86efac",
      border: "1px solid rgba(16,185,129,0.24)",
    },
    statusChipLoss: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "6px 10px",
      fontWeight: 800,
      fontSize: 12,
      background: "rgba(244,63,94,0.14)",
      color: "#fda4af",
      border: "1px solid rgba(244,63,94,0.24)",
    },
    statusChipPush: {
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
    settledLabel: {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "6px 10px",
      fontWeight: 800,
      fontSize: 12,
      background: "rgba(16,185,129,0.10)",
      color: "#86efac",
      border: "1px solid rgba(16,185,129,0.18)",
    },
    rowGameTitle: {
      fontWeight: 800,
      color: "#f8fafc",
      fontSize: 15,
    },
    rowSub: {
      color: "#94a3b8",
      fontSize: 12,
      marginTop: 4,
    },
    rowStrong: {
      fontWeight: 800,
      color: "#f8fafc",
    },
    actionStack: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
    },
    actionBtnWin: {
      border: "1px solid rgba(16,185,129,0.24)",
      borderRadius: 10,
      background: "rgba(16,185,129,0.14)",
      color: "#86efac",
      padding: "8px 10px",
      fontWeight: 800,
      cursor: "pointer",
    },
    actionBtnLoss: {
      border: "1px solid rgba(244,63,94,0.24)",
      borderRadius: 10,
      background: "rgba(244,63,94,0.14)",
      color: "#fda4af",
      padding: "8px 10px",
      fontWeight: 800,
      cursor: "pointer",
    },
    actionBtnPush: {
      border: "1px solid rgba(245,158,11,0.24)",
      borderRadius: 10,
      background: "rgba(245,158,11,0.14)",
      color: "#fcd34d",
      padding: "8px 10px",
      fontWeight: 800,
      cursor: "pointer",
    },
    error: {
      marginTop: 14,
      color: "#fda4af",
      fontWeight: 700,
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <section style={{ ...styles.card, marginBottom: 20 }}>
          <div style={styles.hero}>
            <div style={styles.heroLogoWrap}>
              <img
                src="/assets/sports-mvp-hero.png"
                alt="Sports MVP Hero Logo"
                style={styles.heroLogo}
              />
            </div>

            <div style={styles.eyebrow}>Subscriber Bet Ledger</div>
            <h1 style={styles.heroTitle}>My Bets</h1>
            <div style={styles.heroText}>
              Track every wager you place, measure real profit and loss, and evaluate whether you are
              beating the market over time. Use this page to log straight bets and parlays manually,
              monitor your bankroll performance, and compare your actual betting results against closing
              line value.
            </div>
          </div>
        </section>

        {error ? (
          <section style={{ ...styles.card, marginBottom: 20 }}>
            <div style={styles.error}>{error}</div>
          </section>
        ) : null}

        <section style={{ ...styles.card, marginBottom: 20 }}>
          <h2 style={styles.sectionTitle}>Bankroll Summary</h2>
          <div style={styles.sectionSub}>
            This section gives you the big-picture view of your betting performance. Use it to monitor
            total volume, straight versus parlay usage, settled results, bankroll efficiency, ROI, and
            whether you are getting better numbers than the closing market over time.
          </div>

          <div style={styles.statsGrid}>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Total Bets</div>
              <div style={styles.statValue}>{loading ? "—" : summary?.bets ?? 0}</div>
            </div>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Settled</div>
              <div style={styles.statValue}>{loading ? "—" : summary?.settled ?? 0}</div>
            </div>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Wins</div>
              <div style={{ ...styles.statValue, color: "#86efac" }}>{loading ? "—" : summary?.wins ?? 0}</div>
            </div>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Losses</div>
              <div style={{ ...styles.statValue, color: "#fda4af" }}>{loading ? "—" : summary?.losses ?? 0}</div>
            </div>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Profit</div>
              <div style={styles.statValue}>{loading ? "—" : money(summary?.total_profit)}</div>
            </div>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>ROI</div>
              <div style={styles.statValue}>{loading ? "—" : pctFromUnit(summary?.roi, 2)}</div>
            </div>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Avg CLV</div>
              <div style={styles.statValue}>{loading ? "—" : signedNum(summary?.avg_clv_line, 2)}</div>
            </div>
          </div>

          <div style={{ ...styles.statsGrid, gridTemplateColumns: "repeat(5, minmax(0, 1fr))", marginTop: 14 }}>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Implied CLV</div>
              <div style={styles.statValue}>{loading ? "—" : pctFromUnit(summary?.avg_clv_implied, 2)}</div>
            </div>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Total Stake</div>
              <div style={styles.statValue}>{loading ? "—" : money(summary?.total_stake)}</div>
            </div>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Pending Bets</div>
              <div style={styles.statValue}>{loading ? "—" : pendingCount}</div>
            </div>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Straight Bets</div>
              <div style={styles.statValue}>{loading ? "—" : summary?.straight_bets ?? 0}</div>
            </div>
            <div style={styles.statTile}>
              <div style={styles.statLabel}>Parlays</div>
              <div style={styles.statValue}>{loading ? "—" : summary?.parlay_bets ?? 0}</div>
            </div>
          </div>
        </section>

        <section style={{ ...styles.card, marginBottom: 20 }}>
          <h2 style={styles.sectionTitle}>Add a Bet</h2>
          <div style={styles.sectionSub}>
            Use this section to log any wager you place. Select the betting type first, then fill in
            the relevant details. Straight bets capture the standard single-market fields, while parlay
            entries add leg count and parlay-specific details so your ledger stays organized.
          </div>

          <form onSubmit={handleSubmit}>
            <div style={styles.formGrid}>
              <div style={styles.field}>
                <label style={styles.label}>Date</label>
                <input
                  style={styles.input}
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>League</label>
                <select
                  style={styles.input}
                  value={form.league}
                  onChange={(e) => setForm((f) => ({ ...f, league: e.target.value }))}
                >
                  <option value="nba">NBA</option>
                  <option value="ncaam">NCAAM</option>
                  <option value="nhl">NHL</option>
                </select>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Mode</label>
                <select
                  style={styles.input}
                  value={form.mode}
                  onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
                >
                  <option value="regular">Regular</option>
                  <option value="tournament">Tournament</option>
                </select>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Betting Type</label>
                <select
                  style={styles.input}
                  value={form.bet_type}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      bet_type: e.target.value,
                      market: e.target.value === "straight" ? f.market : "spread",
                      pick: e.target.value === "straight" ? f.pick : "",
                    }))
                  }
                >
                  <option value="straight">Straight</option>
                  <option value="parlay">Parlay</option>
                </select>
              </div>

              {form.bet_type === "straight" ? (
                <>
                  <div style={styles.field}>
                    <label style={styles.label}>Market</label>
                    <select
                      style={styles.input}
                      value={form.market}
                      onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}
                    >
                      <option value="moneyline">Moneyline</option>
                      <option value="spread">Spread</option>
                      <option value="total">Total</option>
                    </select>
                  </div>

                  <div style={styles.field}>
                    <label style={styles.label}>Pick</label>
                    <input
                      style={styles.input}
                      type="text"
                      placeholder="away / home / over / under"
                      value={form.pick}
                      onChange={(e) => setForm((f) => ({ ...f, pick: e.target.value }))}
                    />
                  </div>

                  <div style={styles.field}>
                    <label style={styles.label}>Line</label>
                    <input
                      style={styles.input}
                      type="number"
                      step="0.5"
                      value={form.line}
                      onChange={(e) => setForm((f) => ({ ...f, line: e.target.value }))}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div style={styles.field}>
                    <label style={styles.label}>Parlay Type</label>
                    <select
                      style={styles.input}
                      value={form.parlay_type}
                      onChange={(e) => setForm((f) => ({ ...f, parlay_type: e.target.value }))}
                    >
                      <option value="multi_game">Multi-Game</option>
                      <option value="sgp">Same Game Parlay</option>
                    </select>
                  </div>

                  <div style={styles.field}>
                    <label style={styles.label}>Number of Picks</label>
                    <select
                      style={styles.input}
                      value={form.legs_count}
                      onChange={(e) => setForm((f) => ({ ...f, legs_count: e.target.value }))}
                    >
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                      <option value="6">6</option>
                      <option value="7">7</option>
                      <option value="8">8</option>
                    </select>
                  </div>

                  <div style={styles.field}>
                    <label style={styles.label}>Leg Summary</label>
                    <input
                      style={styles.input}
                      type="text"
                      placeholder="MEM +2.5 | LAL +2.5 | CHI +6.5"
                      value={form.legs_summary}
                      onChange={(e) => setForm((f) => ({ ...f, legs_summary: e.target.value }))}
                    />
                  </div>
                </>
              )}

              <div style={styles.field}>
                <label style={styles.label}>Game Label</label>
                <input
                  style={styles.input}
                  type="text"
                  placeholder={form.bet_type === "parlay" ? "3-Leg NBA Parlay" : "MEM @ PHI"}
                  value={form.game_label}
                  onChange={(e) => setForm((f) => ({ ...f, game_label: e.target.value }))}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Game Key</label>
                <input
                  style={styles.input}
                  type="text"
                  placeholder={form.bet_type === "parlay" ? "PARLAY:2026-03-10:NBA:3" : "MEM@PHI:2026-03-10"}
                  value={form.game_key}
                  onChange={(e) => setForm((f) => ({ ...f, game_key: e.target.value }))}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Odds</label>
                <input
                  style={styles.input}
                  type="number"
                  step="1"
                  placeholder="-110"
                  value={form.odds}
                  onChange={(e) => setForm((f) => ({ ...f, odds: e.target.value }))}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Stake</label>
                <input
                  style={styles.input}
                  type="number"
                  step="0.01"
                  placeholder="50"
                  value={form.stake}
                  onChange={(e) => setForm((f) => ({ ...f, stake: e.target.value }))}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Book</label>
                <input
                  style={styles.input}
                  type="text"
                  placeholder="DraftKings"
                  value={form.book}
                  onChange={(e) => setForm((f) => ({ ...f, book: e.target.value }))}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Source</label>
                <select
                  style={styles.input}
                  value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                >
                  <option value="manual">Manual</option>
                  <option value="model">Model</option>
                </select>
              </div>
            </div>

            <div style={{ ...styles.field, marginTop: 14 }}>
              <label style={styles.label}>Notes</label>
              <textarea
                style={styles.textarea}
                placeholder="Why you placed it, book timing, or any extra notes..."
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div style={styles.buttonRow}>
              <button type="submit" style={styles.primaryBtn} disabled={saving}>
                {saving ? "Saving Bet..." : "Add Bet to Ledger"}
              </button>
              <button
                type="button"
                style={styles.ghostBtn}
                onClick={() => setForm(emptyForm())}
              >
                Reset Form
              </button>
            </div>
          </form>
        </section>

        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Bet History</h2>
          <div style={styles.sectionSub}>
            This section shows your full tracked ledger. Use it to review every wager you have logged,
            compare straight bets versus parlays, monitor results, compare profit and loss, and settle
            pending bets quickly while your bankroll and CLV statistics update automatically.
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Game</th>
                  <th style={styles.th}>Market</th>
                  <th style={styles.th}>Pick / Legs</th>
                  <th style={styles.th}>Line</th>
                  <th style={styles.th}>Odds</th>
                  <th style={styles.th}>Stake</th>
                  <th style={styles.th}>Result</th>
                  <th style={styles.th}>Profit</th>
                  <th style={styles.th}>CLV</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td style={styles.td} colSpan={12}>Loading bet history…</td>
                  </tr>
                ) : bets.length === 0 ? (
                  <tr>
                    <td style={styles.td} colSpan={12}>No bets logged yet. Add your first wager above.</td>
                  </tr>
                ) : (
                  sortedBets.map((bet) => {
                    const result = String(bet?.result || "pending").toLowerCase();
                    const isParlay = String(bet?.bet_type || "straight").toLowerCase() === "parlay";
                    const isTournament = String(bet?.mode || "").toLowerCase() === "tournament";

                    const statusStyle =
                      result === "win"
                        ? styles.statusChipWin
                        : result === "loss"
                        ? styles.statusChipLoss
                        : result === "push"
                        ? styles.statusChipPush
                        : styles.statusChipPending;

                    return (
                      <tr key={bet.id}>
                        <td style={styles.td}>{bet?.date || "—"}</td>
                        <td style={styles.td}>
                          <span style={isParlay ? styles.parlayChip : styles.typeChip}>
                            {isParlay ? `PARLAY${bet?.legs_count ? ` (${bet.legs_count})` : ""}` : "STRAIGHT"}
                          </span>
                          {isParlay && bet?.parlay_type ? (
                            <div style={styles.rowSub}>{titleCase(bet.parlay_type)}</div>
                          ) : null}
                        </td>
                        <td style={styles.td}>
                          <div style={styles.rowGameTitle}>{bet?.game_label || "—"}</div>
                          <div style={styles.rowSub}>{bet?.book || "—"}</div>
                          {isTournament ? (
                            <div style={{ marginTop: 6 }}>
                              <span style={styles.tournamentChip}>Tournament Mode</span>
                            </div>
                          ) : null}
                        </td>
                        <td style={styles.td}>
                          <span style={styles.chip}>{isParlay ? "Parlay" : titleCase(bet?.market)}</span>
                        </td>
                        <td style={styles.td}>
                          {isParlay ? (
                            <>
                              <div style={styles.rowStrong}>{bet?.legs_summary || "Parlay"}</div>
                              <div style={styles.rowSub}>
                                {bet?.legs_count ? `${bet.legs_count} legs` : "—"}
                              </div>
                            </>
                          ) : (
                            <div style={styles.rowStrong}>{titleCase(bet?.pick)}</div>
                          )}
                        </td>
                        <td style={styles.td}>{isParlay ? "—" : num(bet?.line) == null ? "—" : bet.line}</td>
                        <td style={styles.td}>
                          <div style={styles.rowStrong}>{oddsText(bet?.odds)}</div>
                        </td>
                        <td style={styles.td}>
                          <div style={styles.rowStrong}>{money(bet?.stake)}</div>
                        </td>
                        <td style={styles.td}>
                          <span style={statusStyle}>{String(result || "pending").toUpperCase()}</span>
                        </td>
                        <td style={styles.td}>
                          <div style={styles.rowStrong}>{money(bet?.profit)}</div>
                        </td>
                        <td style={styles.td}>
                          <div style={styles.rowStrong}>{clvLineText(bet?.clv_line_delta)}</div>
                          <div style={styles.rowSub}>{clvImpliedText(bet?.clv_implied_delta)}</div>
                        </td>
                        <td style={styles.td}>
                          {!bet?.result || result === "pending" ? (
                            <div style={styles.actionStack}>
                              <button
                                type="button"
                                style={styles.actionBtnWin}
                                disabled={settlingId === bet.id}
                                onClick={() => quickSettle(bet.id, "win")}
                              >
                                WIN
                              </button>
                              <button
                                type="button"
                                style={styles.actionBtnLoss}
                                disabled={settlingId === bet.id}
                                onClick={() => quickSettle(bet.id, "loss")}
                              >
                                LOSS
                              </button>
                              <button
                                type="button"
                                style={styles.actionBtnPush}
                                disabled={settlingId === bet.id}
                                onClick={() => quickSettle(bet.id, "push")}
                              >
                                PUSH
                              </button>
                            </div>
                          ) : (
                            <span style={styles.settledLabel}>SETTLED ✓</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
