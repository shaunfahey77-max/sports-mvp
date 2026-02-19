// legacy/apps/web/src/pages/Predict.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

/* =========================================================
   Predict (Premium) — v2
   Fixes + upgrades:
   ✅ Logos: robust resolver + ESPN CDN fallbacks (NBA/NHL + NCAAM numeric IDs)
   ✅ “Why” panel: supports BOTH string + object why (headline/bullets/deltas)
   ✅ Better summary header (games, pick count, avg win%, avg edge, avg conf)
   ✅ Clean hierarchy + click-safe UI
   ========================================================= */

function todayUTC() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function pct(x, digits = 1) {
  if (x == null || !Number.isFinite(Number(x))) return "—";
  return `${(Number(x) * 100).toFixed(digits)}%`;
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function pickLogoAny(team) {
  return (
    team?.logo ||
    team?.logos?.[0]?.href ||
    team?.team?.logo ||
    team?.team?.logos?.[0]?.href ||
    team?.branding?.logo ||
    team?.branding?.logos?.[0]?.href ||
    null
  );
}

function inferAbbr(team) {
  const t = team?.team || team || {};
  const direct =
    t?.abbr ||
    t?.abbreviation ||
    t?.shortName ||
    t?.displayAbbreviation ||
    t?.code ||
    team?.abbr ||
    team?.abbreviation ||
    null;
  if (direct) return String(direct).trim().toUpperCase();

  const name = String(t?.name || t?.displayName || t?.shortDisplayName || team?.name || "").trim();
  if (/^[A-Z]{2,4}$/.test(name)) return name;

  const idLike = String(t?.id ?? t?.slug ?? team?.id ?? team?.slug ?? "").trim();
  if (idLike) {
    const parts = idLike.split("-").filter(Boolean);
    const last = parts[parts.length - 1];
    if (/^[a-z]{2,4}$/i.test(last)) return String(last).toUpperCase();
  }
  return null;
}

function espnLogoByLeagueAbbr(league, abbr) {
  const a = String(abbr || "").trim().toLowerCase();
  if (!a) return null;

  if (league === "nba") {
    return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/scoreboard/${a}.png&h=80&w=80`;
  }
  if (league === "nhl") {
    return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nhl/500/scoreboard/${a}.png&h=80&w=80`;
  }
  return null;
}

function espnNcaamLogoByTeamId(team) {
  const t = team?.team || team || {};
  const cand = t?.espnTeamId || t?.teamId || t?.id || team?.espnTeamId || team?.teamId || null;
  const n = Number(cand);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${n}.png`;
}

function resolveLogo(league, team) {
  const direct = pickLogoAny(team);
  if (direct) return direct;

  const abbr = inferAbbr(team);

  if (league === "ncaam") {
    // NCAAM prefers numeric ESPN team IDs when available
    return espnNcaamLogoByTeamId(team) || null;
  }

  return espnLogoByLeagueAbbr(league, abbr);
}

function getTeamsFromGame(g) {
  const home = g?.home || g?.homeTeam || g?.teams?.home || {};
  const away = g?.away || g?.awayTeam || g?.teams?.away || {};
  return { home, away };
}

function extractUnified(g) {
  const pick =
    g?.market?.pick ??
    g?.pick?.pickSide ??
    g?.pickSide ??
    g?.pick ??
    null;

  const winProb =
    g?.market?.winProb ??
    g?.pick?.winProb ??
    g?.winProb ??
    null;

  const edge =
    g?.market?.edge ??
    g?.pick?.edge ??
    g?.edge ??
    null;

  const conf =
    g?.market?.confidence ??
    g?.pick?.confidence ??
    g?.confidence ??
    null;

  const why =
    g?.market?.why ??
    g?.pick?.why ??
    g?.why ??
    null;

  const tier =
    g?.market?.tier ??
    g?.tier ??
    null;

  return { pick, winProb, edge, conf, why, tier };
}

// Accepts string OR {headline, bullets, deltas}
function normalizeWhy(why) {
  if (!why) return null;
  if (typeof why === "string") {
    const s = why.trim();
    return s ? { mode: "string", text: s } : null;
  }
  if (typeof why === "object") {
    const headline = typeof why.headline === "string" ? why.headline.trim() : "";
    const bullets = safeArr(why.bullets).filter((b) => typeof b === "string" && b.trim());
    const deltas = safeArr(why.deltas).filter((d) => d && typeof d === "object");
    return {
      mode: "object",
      headline: headline || null,
      bullets,
      deltas,
    };
  }
  return null;
}

function buildWhyFallback({ league, matchup, pick, winProb, edge, conf, tier }) {
  const p = pick ? String(pick).toUpperCase() : "—";
  const w = winProb != null && Number.isFinite(Number(winProb)) ? pct(winProb, 1) : "—";
  const e = edge != null && Number.isFinite(Number(edge)) ? Number(edge).toFixed(2) : "—";
  const c = conf != null && Number.isFinite(Number(conf)) ? pct(conf, 0) : "—";
  const t = tier ? String(tier).toUpperCase() : null;

  // honest copy for NHL (picks can be paused)
  const nhlNote = league === "nhl" && (!pick || winProb == null) ? " (picks paused / slate only)" : "";

  return `Pick ${p}${nhlNote} • Win ${w} • Edge ${e} • Conf ${c}${t ? ` • Tier ${t}` : ""}`;
}

export default function Predict() {
  const { league } = useParams();
  const l = String(league || "nba").toLowerCase();

  const [sp, setSp] = useSearchParams();
  const date = sp.get("date") || todayUTC();

  const [payload, setPayload] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;

    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(`/api/predictions?league=${encodeURIComponent(l)}&date=${encodeURIComponent(date)}`);
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
    return () => { dead = true; };
  }, [l, date]);

  const games = useMemo(() => (Array.isArray(payload?.games) ? payload.games : []), [payload]);
  const metaSource = payload?.meta?.source || payload?.meta?.model || "premium-predictions";

  const summary = useMemo(() => {
    const rows = games.map((g) => extractUnified(g));
    const picked = rows.filter((r) => r.pick && r.winProb != null);
    const avgWin = picked.length ? picked.reduce((a, r) => a + Number(r.winProb), 0) / picked.length : null;
    const avgEdge = picked.length ? picked.reduce((a, r) => a + Number(r.edge ?? 0), 0) / picked.length : null;
    const avgConf = picked.length ? picked.reduce((a, r) => a + Number(r.conf ?? 0), 0) / picked.length : null;

    return { games: games.length, picks: picked.length, avgWin, avgEdge, avgConf };
  }, [games]);

  function setDateParam(v) {
    setSp((prev) => {
      prev.set("date", v);
      return prev;
    });
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="slateHeader">
        <div style={{ minWidth: 0 }}>
          <div className="h1" style={{ fontSize: 22 }}>
            {l.toUpperCase()} Predictions
          </div>
          <div className="sub">
            Date: {date} • source: {metaSource}
          </div>

          <div className="pills" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <span className="badge">Games: {summary.games}</span>
            <span className={`badge ${summary.picks > 0 ? "good" : ""}`}>Picks: {summary.picks}</span>
            <span className="badge">Avg Win: {pct(summary.avgWin, 1)}</span>
            <span className="badge">Avg Edge: {summary.avgEdge != null ? summary.avgEdge.toFixed(2) : "—"}</span>
            <span className="badge">Avg Conf: {pct(summary.avgConf, 0)}</span>
          </div>
        </div>

        <div className="pills" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDateParam(e.target.value)}
            className="pill"
            style={{ padding: "6px 10px", background: "rgba(255,255,255,.04)" }}
          />
          <button className="pill" onClick={() => setDateParam("2026-02-04")}>Test: 2026-02-04</button>
          <Link className="pill" to="/">Dashboard</Link>
          <Link className="pill" to="/performance">Performance</Link>
          <Link className="pill" to={`/upsets?league=${encodeURIComponent(l)}&date=${encodeURIComponent(date)}`}>Upsets</Link>
        </div>
      </div>

      {loading ? (
        <div className="sub">Loading…</div>
      ) : err ? (
        <div className="badge bad">{err}</div>
      ) : games.length === 0 ? (
        <div className="sub">No games returned for this date.</div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {games.map((g) => {
            const { home, away } = getTeamsFromGame(g);

            const homeLogo = resolveLogo(l, home);
            const awayLogo = resolveLogo(l, away);

            const matchup =
              g?.matchup ||
              `${inferAbbr(away) || away?.abbr || away?.name || "AWAY"} @ ${inferAbbr(home) || home?.abbr || home?.name || "HOME"}`;

            const { pick, winProb, edge, conf, why, tier } = extractUnified(g);

            const whyNorm = normalizeWhy(why);
            const hasPick = Boolean(pick) && winProb != null;

            const fallbackLine = buildWhyFallback({
              league: l,
              matchup,
              pick,
              winProb,
              edge,
              conf,
              tier,
            });

            return (
              <div
                key={g?.gameId || matchup}
                className="gameRow"
                style={{ flexDirection: "column", alignItems: "stretch" }}
              >
                {/* top row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div className="matchup">
                    {awayLogo ? <img className="logo" src={awayLogo} alt="" /> : <span className="logo" />}
                    {homeLogo ? <img className="logo" src={homeLogo} alt="" /> : <span className="logo" />}
                    <span>{matchup}</span>
                  </div>

                  <div className="metaChips">
                    <span className="chip">{pick ? `Pick: ${String(pick).toUpperCase()}` : "Pick: —"}</span>
                    <span className="chip">{winProb != null ? `Win: ${pct(winProb, 1)}` : "Win: —"}</span>
                    <span className="chip">{edge != null ? `Edge: ${Number(edge).toFixed(2)}` : "Edge: —"}</span>
                    <span className="chip">{conf != null ? `Conf: ${pct(conf, 0)}` : "Conf: —"}</span>
                    {tier ? <span className="chip">{`Tier: ${String(tier).toUpperCase()}`}</span> : null}
                  </div>
                </div>

                {/* premium why */}
                <div
                  style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,.08)",
                    background: "rgba(255,255,255,.025)",
                  }}
                >
                  <div className="sub" style={{ margin: 0, display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontWeight: 800, color: "rgba(234,240,255,.9)" }}>
                      Why this pick
                    </span>
                    <span className={`badge ${hasPick ? "good" : ""}`}>{hasPick ? "Model pick" : "No pick"}</span>
                  </div>

                  {/* 1) headline (object why) */}
                  {whyNorm?.mode === "object" && whyNorm.headline ? (
                    <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.35, color: "rgba(234,240,255,.88)" }}>
                      <b>{whyNorm.headline}</b>
                    </div>
                  ) : null}

                  {/* 2) bullets (object why) */}
                  {whyNorm?.mode === "object" && whyNorm.bullets.length > 0 ? (
                    <ul className="whyList" style={{ marginTop: 8 }}>
                      {whyNorm.bullets.slice(0, 6).map((b, idx) => (
                        <li key={idx}>{b}</li>
                      ))}
                    </ul>
                  ) : null}

                  {/* 3) string why */}
                  {whyNorm?.mode === "string" ? (
                    <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.35, color: "rgba(234,240,255,.82)" }}>
                      {whyNorm.text}
                    </div>
                  ) : null}

                  {/* 4) fallback if missing */}
                  {!whyNorm ? (
                    <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.35, color: "rgba(234,240,255,.82)" }}>
                      {fallbackLine}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
