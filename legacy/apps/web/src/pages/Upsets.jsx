// legacy/apps/web/src/pages/Upsets.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getMatchupLogos } from "../lib/teamLogos";

function todayUTC() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function pct(x) {
  if (x == null || !Number.isFinite(Number(x))) return "—";
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function fmtNum(x, digits = 2) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export default function Upsets() {
  const [sp, setSp] = useSearchParams();

  const league = (sp.get("league") || "ncaam").toLowerCase();
  const date = sp.get("date") || todayUTC();
  const mode = sp.get("mode") || "watch";
  const minWin = sp.get("minWin") || "0.20";
  const limit = sp.get("limit") || "20";

  const [payload, setPayload] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const q =
          `league=${encodeURIComponent(league)}` +
          `&date=${encodeURIComponent(date)}` +
          `&mode=${encodeURIComponent(mode)}` +
          `&minWin=${encodeURIComponent(minWin)}` +
          `&limit=${encodeURIComponent(limit)}`;

        const r = await fetch(`/api/upsets?${q}`);
        const j = await r.json();
        if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`);
        if (!dead) setPayload(j);
      } catch (e) {
        if (!dead) setErr(String(e?.message || e));
      } finally {
        if (!dead) setLoading(false);
      }
    }
    run();
    return () => {
      dead = true;
    };
  }, [league, date, mode, minWin, limit]);

  const rows = useMemo(() => (Array.isArray(payload?.rows) ? payload.rows : []), [payload]);
  const meta = payload?.meta || {};

  function setParam(k, v) {
    setSp((prev) => {
      prev.set(k, v);
      return prev;
    });
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="slateHeader">
        <div style={{ minWidth: 0 }}>
          <div className="h1" style={{ fontSize: 24 }}>Upset Watch</div>
          <div className="sub">
            {league.toUpperCase()} • {date} • source: {meta?.source || "—"}
          </div>
        </div>

        <div className="pills" style={{ justifyContent: "flex-end" }}>
          <select className="pill" value={league} onChange={(e) => setParam("league", e.target.value)}>
            <option value="nba">NBA</option>
            <option value="nhl">NHL</option>
            <option value="ncaam">NCAAM</option>
          </select>

          <input
            type="date"
            value={date}
            onChange={(e) => setParam("date", e.target.value)}
            className="pill"
            style={{ padding: "7px 10px" }}
          />

          <select className="pill" value={mode} onChange={(e) => setParam("mode", e.target.value)}>
            <option value="watch">Watch</option>
            <option value="strict">Strict</option>
          </select>

          <select className="pill" value={minWin} onChange={(e) => setParam("minWin", e.target.value)}>
            <option value="0.20">Min 20%</option>
            <option value="0.25">Min 25%</option>
            <option value="0.30">Min 30%</option>
            <option value="0.35">Min 35%</option>
            <option value="0.05">Min 5% (debug)</option>
          </select>

          <select className="pill" value={limit} onChange={(e) => setParam("limit", e.target.value)}>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="30">30</option>
            <option value="50">50</option>
          </select>

          <Link className="pill" to={`/league/${league}?date=${encodeURIComponent(date)}`}>Predictions</Link>
          <Link className="pill" to={`/`}>Home</Link>
        </div>
      </div>

      <div className="hr" />

      {/* Summary strip */}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className="badge warn">Candidates: <b>{rows.length}</b></span>
        <span className="badge">Slate games: <b>{meta?.slateGames ?? "—"}</b></span>
        <span className="badge">Min win: <b>{minWin}</b></span>
        <span className="badge">Mode: <b>{mode}</b></span>
        {meta?.elapsedMs != null && <span className="badge">API: <b>{meta.elapsedMs}ms</b></span>}
      </div>

      {loading ? (
        <div className="sub" style={{ marginTop: 10 }}>Loading…</div>
      ) : err ? (
        <div className="badge bad" style={{ marginTop: 10 }}>{err}</div>
      ) : rows.length === 0 ? (
        <div className="sub" style={{ marginTop: 10 }}>
          No upset candidates for current filters.
          <div className="sub" style={{ marginTop: 6, opacity: 0.85 }}>
            Some slates legitimately return 0 candidates. For a quick sanity check, try <b>Min 5%</b> or switch to <b>NCAAM</b>.
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {rows.map((r) => {
            const matchup = r?.matchup || "—";
            const away = r?.away || {};
            const home = r?.home || {};

            const { awayLogo, homeLogo } = getMatchupLogos(league, away, home, matchup, { size: 72 });

            const whyObj =
              (r?.why && typeof r.why === "object" ? r.why : null) ||
              (r?.pick?.why && typeof r.pick.why === "object" ? r.pick.why : null);

            const bullets = safeArr(whyObj?.bullets);
            const deltas = safeArr(whyObj?.deltas);

            return (
              <div
                key={r.id || matchup}
                className="gameRow"
                style={{ alignItems: "flex-start", gap: 12, paddingTop: 12, paddingBottom: 12 }}
              >
                <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                  <div className="matchup" style={{ alignItems: "center" }}>
                    {awayLogo ? <img className="logo" src={awayLogo} alt="" /> : <span className="logo" />}
                    {homeLogo ? <img className="logo" src={homeLogo} alt="" /> : <span className="logo" />}
                    <span>{matchup}</span>
                    <span className="badge warn" style={{ marginLeft: 10 }}>
                      Upset {pct(r?.winProb)}
                    </span>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div
                      className="sub"
                      style={{
                        marginTop: 2,
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,.10)",
                        background: "rgba(255,255,255,.04)",
                      }}
                    >
                      <b>Why:</b>{" "}
                      {whyObj?.headline ? whyObj.headline : "Model did not return a headline for this row."}
                    </div>

                    {bullets.length > 0 && (
                      <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.35, opacity: 0.95 }}>
                        {bullets.slice(0, 5).map((b, idx) => (
                          <li key={idx} style={{ marginBottom: 4 }}>{b}</li>
                        ))}
                      </ul>
                    )}

                    {deltas.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                        {deltas.slice(0, 5).map((d, idx) => (
                          <span key={idx} className="chip">
                            {d?.label || "Δ"}: {d?.display ?? fmtNum(d?.value, 3)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="metaChips" style={{ flex: "0 0 auto", justifyContent: "flex-end" }}>
                  <span className="chip">Dog win: {pct(r?.winProb)}</span>
                  <span className="chip">Pick: {String(r?.pick?.pickSide || "—").toUpperCase()}</span>
                  <span className="chip">Fav win: {pct(r?.pick?.winProb)}</span>
                  <span className="chip">Edge: {r?.pick?.edge != null ? fmtNum(r.pick.edge, 3) : "—"}</span>
                  <span className="chip">{r?.signals?.usedModelWinProb ? "Model winProb" : "Fallback"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
