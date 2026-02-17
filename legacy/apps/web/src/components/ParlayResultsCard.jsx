import React, { useMemo, useState } from "react";

/**
 * ParlayResultsCard.jsx
 * Phase 1 + Phase 1.5
 *
 * Includes:
 * - Summary metrics (legs, W–L, hit rate, status)
 * - League split chips (NBA vs NHL etc.)
 * - Pick-type split chips (ML vs SPREAD vs TOTAL etc.)
 * - LocalStorage persistence (save/load latest/clear)
 * - Inline editor: Create + Edit + Delete
 *
 * Storage key:
 * - "mvp_parlays_v1"
 */

const STORAGE_KEY = "mvp_parlays_v1";

/* --------------------------- utils --------------------------- */

function pillClass(result) {
  if (result === "WIN") return "pill pill-win";
  if (result === "LOSS") return "pill pill-loss";
  return "pill";
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function canUseStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function safeJsonParse(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function readSavedParlays() {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = safeJsonParse(raw, []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeSavedParlays(items) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore storage write errors
  }
}

function nowIso() {
  return new Date().toISOString();
}

function stableTeamsSignature(legs) {
  return (legs ?? [])
    .map((l) => (l?.team ?? "").trim())
    .filter(Boolean)
    .join("|");
}

function makeParlayId(parlay) {
  const teams = stableTeamsSignature(parlay?.legs);
  return `${parlay?.date ?? "unknown"}::${teams}::${Date.now()}`;
}

function normalizeLeague(x) {
  return (x ?? "OTHER").toString().trim().toUpperCase() || "OTHER";
}

function normalizePickType(leg) {
  const raw = (leg?.pick ?? "").toString().trim().toUpperCase();

  if (raw.includes("ML") || raw.includes("MONEYLINE")) return "ML";
  if (raw.includes("SPREAD")) return "SPREAD";
  if (raw.includes("TOTAL") || raw.includes("OVER") || raw.includes("UNDER")) return "TOTAL";
  if (raw.includes("PROP")) return "PROPS";
  if (raw) return raw;

  // Optional heuristic if pick not provided:
  // numeric like -6.5 often implies a spread
  const odds = (leg?.odds ?? "").toString().trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(odds) && odds.includes(".")) return "SPREAD";

  return "OTHER";
}

function normalizeResult(x) {
  const r = (x ?? "").toString().trim().toUpperCase();
  return r === "WIN" || r === "LOSS" ? r : "";
}

function sortLatestFirst(a, b) {
  const ta = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
  const tb = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
  return tb - ta;
}

/* --------------------------- editor defaults --------------------------- */

function todayISODate() {
  // Returns YYYY-MM-DD in local time
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyLeg() {
  return { league: "NBA", team: "", pick: "ML", odds: "", result: "WIN" };
}

function emptyDraft() {
  return {
    date: todayISODate(),
    sportsbook: "DraftKings",
    betType: "Moneyline",
    stake: "",
    notes: "",
    legs: [emptyLeg(), emptyLeg()],
  };
}

function isLegValid(leg) {
  const league = (leg?.league ?? "").toString().trim();
  const team = (leg?.team ?? "").toString().trim();
  const result = normalizeResult(leg?.result);
  return Boolean(league && team && (result === "WIN" || result === "LOSS"));
}

function validateDraft(draft) {
  if (!draft?.date) return "Date is required.";
  if (!Array.isArray(draft.legs) || draft.legs.length < 2) return "Add at least 2 legs.";
  for (let i = 0; i < draft.legs.length; i++) {
    if (!isLegValid(draft.legs[i])) return "Complete League / Team / Result for each leg.";
  }
  return "";
}

/* --------------------------- component --------------------------- */

export default function ParlayResultsCard({ parlay }) {
  const [saved, setSaved] = useState(() => {
    if (typeof window === "undefined") return [];
    const items = readSavedParlays();
    items.sort(sortLatestFirst);
    return items;
  });

  const [activeSavedId, setActiveSavedId] = useState(""); // "" means show current prop parlay
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("create"); // "create" | "edit"
  const [draft, setDraft] = useState(() => emptyDraft());

  const activeParlay = useMemo(() => {
    if (activeSavedId) {
      const found = saved.find((p) => p.id === activeSavedId);
      return found || parlay || null;
    }
    return parlay || null;
  }, [activeSavedId, saved, parlay]);

  const computed = useMemo(() => {
    const legsRaw = activeParlay?.legs ?? [];
    const legs = Array.isArray(legsRaw) ? legsRaw : [];
    const legsCount = legs.length;

    // Normalize results, league; decided legs = only WIN/LOSS
    const legsNormalized = legs.map((l) => ({
      ...l,
      league: normalizeLeague(l?.league),
      result: normalizeResult(l?.result),
    }));
    const decided = legsNormalized.filter((l) => l.result === "WIN" || l.result === "LOSS");

    const wins = decided.filter((l) => l.result === "WIN").length;
    const losses = decided.filter((l) => l.result === "LOSS").length;

    // Hit rate should not be distorted by PENDING legs
    const hitRate = decided.length ? Math.round((wins / decided.length) * 100) : 0;

    // Status:
    // - PENDING if no legs OR any leg ungraded
    // - LOSS if fully graded and any LOSS exists
    // - WIN if fully graded and all WIN
    let status = "PENDING";
    if (legsCount === 0) status = "PENDING";
    else if (decided.length !== legsCount) status = "PENDING";
    else if (losses > 0) status = "LOSS";
    else status = "WIN";

    // League split (graded legs only)
    const leagueMap = {};
    for (const leg of decided) {
      const key = leg.league || "OTHER";
      if (!leagueMap[key]) leagueMap[key] = { wins: 0, losses: 0, total: 0 };
      leagueMap[key].total += 1;
      if (leg.result === "WIN") leagueMap[key].wins += 1;
      if (leg.result === "LOSS") leagueMap[key].losses += 1;
    }
    const leagueSplit = Object.entries(leagueMap)
      .map(([league, v]) => ({
        league,
        ...v,
        summary: `${v.wins}\u2013${v.losses}`,
        hitRate: v.total ? Math.round((v.wins / v.total) * 100) : 0,
      }))
      .sort((a, b) => {
        const order = (x) => (x === "NBA" ? 0 : x === "NHL" ? 1 : 2);
        const oa = order(a.league);
        const ob = order(b.league);
        if (oa !== ob) return oa - ob;
        return a.league.localeCompare(b.league);
      });

    // Pick-type split (graded legs only)
    const pickMap = {};
    for (const leg of decided) {
      const key = normalizePickType(leg);
      if (!pickMap[key]) pickMap[key] = { wins: 0, losses: 0, total: 0 };
      pickMap[key].total += 1;
      if (leg.result === "WIN") pickMap[key].wins += 1;
      if (leg.result === "LOSS") pickMap[key].losses += 1;
    }
    const pickTypeSplit = Object.entries(pickMap)
      .map(([type, v]) => ({
        type,
        ...v,
        summary: `${v.wins}\u2013${v.losses}`,
        hitRate: v.total ? Math.round((v.wins / v.total) * 100) : 0,
      }))
      .sort((a, b) => {
        const order = (x) => (x === "ML" ? 0 : x === "SPREAD" ? 1 : 2);
        const oa = order(a.type);
        const ob = order(b.type);
        if (oa !== ob) return oa - ob;
        return a.type.localeCompare(b.type);
      });

    return { wins, losses, legsCount, hitRate, status, leagueSplit, pickTypeSplit, decidedCount: decided.length };
  }, [activeParlay]);

  const isSavedActive = Boolean(activeSavedId);
  const activeSaved = isSavedActive ? saved.find((p) => p.id === activeSavedId) : null;

  const openCreate = () => {
    setEditorMode("create");
    setDraft(emptyDraft());
    setEditorOpen(true);
  };

  const openEdit = () => {
    if (!activeSaved) return;
    setEditorMode("edit");
    setDraft({
      id: activeSaved.id,
      createdAt: activeSaved.createdAt,
      updatedAt: activeSaved.updatedAt,
      date: activeSaved.date || todayISODate(),
      sportsbook: activeSaved.sportsbook || "",
      betType: activeSaved.betType || "Moneyline",
      stake: activeSaved.stake ?? "",
      notes: activeSaved.notes ?? "",
      legs: (activeSaved.legs ?? []).map((l) => ({
        league: l.league ?? "NBA",
        team: l.team ?? "",
        pick: l.pick ?? "ML",
        odds: l.odds ?? "",
        result: normalizeResult(l.result) || "WIN",
      })),
    });
    setEditorOpen(true);
  };

  const syncSaved = (next) => {
    const sorted = [...next].sort(sortLatestFirst);
    writeSavedParlays(sorted);
    setSaved(sorted);
  };

  const handleLoadLatest = () => {
    if (!saved.length) return;
    setActiveSavedId(saved[0].id);
  };

  const handleClear = () => {
    if (!saved.length) return;
    const ok = typeof window !== "undefined" ? window.confirm("Clear all saved parlays? This cannot be undone.") : false;
    if (!ok) return;

    if (canUseStorage()) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    setSaved([]);
    setActiveSavedId("");
    setEditorOpen(false);
  };

  const handleDeleteActive = () => {
    if (!activeSaved) return;
    const ok = typeof window !== "undefined" ? window.confirm("Delete this saved parlay?") : false;
    if (!ok) return;

    const next = saved.filter((p) => p.id !== activeSaved.id);
    syncSaved(next);
    setActiveSavedId(next.length ? next[0].id : "");
    setEditorOpen(false);
  };

  const onDraftChange = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const onLegChange = (idx, patch) => {
    setDraft((d) => {
      const legs = [...(d.legs ?? [])];
      legs[idx] = { ...legs[idx], ...patch };
      return { ...d, legs };
    });
  };

  const addLeg = () => {
    setDraft((d) => ({ ...d, legs: [...(d.legs ?? []), emptyLeg()] }));
  };

  const removeLeg = (idx) => {
    setDraft((d) => {
      const legs = [...(d.legs ?? [])].filter((_, i) => i !== idx);
      return { ...d, legs: legs.length ? legs : [emptyLeg(), emptyLeg()] };
    });
  };

  const saveDraft = () => {
    const error = validateDraft(draft);
    if (error) return;

    const cleaned = {
      ...draft,
      betType: draft.betType || "Moneyline",
      legs: (draft.legs ?? []).map((l) => ({
        league: normalizeLeague(l.league),
        team: (l.team ?? "").toString().trim(),
        pick: (l.pick ?? "ML").toString().trim(),
        odds: (l.odds ?? "").toString().trim(),
        result: normalizeResult(l.result) || "WIN",
      })),
    };

    // Normalize stake safely (avoid NaN)
    if (cleaned.stake === "" || cleaned.stake == null) {
      delete cleaned.stake;
    } else {
      const n = Number(cleaned.stake);
      if (Number.isFinite(n)) cleaned.stake = n;
      else delete cleaned.stake;
    }

    const signature = `${cleaned.date}::${stableTeamsSignature(cleaned.legs)}`;

    if (editorMode === "edit" && cleaned.id) {
      const updated = {
        ...cleaned,
        id: cleaned.id,
        createdAt: cleaned.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      const next = saved.map((p) => (p.id === updated.id ? updated : p));
      syncSaved(next);
      setActiveSavedId(updated.id);
      setEditorOpen(false);
      return;
    }

    // Create mode: dedupe by signature (date + teams)
    const existingIdx = saved.findIndex((p) => {
      const sig = `${p.date}::${stableTeamsSignature(p.legs)}`;
      return sig === signature;
    });

    if (existingIdx >= 0) {
      const existing = saved[existingIdx];
      const updated = {
        ...existing, // preserve id + createdAt
        ...cleaned,
        id: existing.id,
        createdAt: existing.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      const next = [...saved];
      next[existingIdx] = updated;
      syncSaved(next);
      setActiveSavedId(updated.id);
      setEditorOpen(false);
      return;
    }

    const created = {
      ...cleaned,
      id: makeParlayId(cleaned),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const next = [created, ...saved];
    syncSaved(next);
    setActiveSavedId(created.id);
    setEditorOpen(false);
  };

  const draftError = editorOpen ? validateDraft(draft) : "";

  return (
    <section className="pr-card" aria-label="Parlay results">
      {/* Header */}
      <header className="pr-head">
        <div className="pr-titleWrap">
          <div className="pr-titleRow">
            <h3 className="pr-title">Parlay Results</h3>
            <span className={pillClass(computed.status)}>{computed.status}</span>
          </div>

          <div className="pr-sub">
            <span className="muted">{activeParlay?.date ? formatDate(activeParlay.date) : "No parlay loaded"}</span>
            {activeParlay?.sportsbook ? <span className="dot" /> : null}
            {activeParlay?.sportsbook ? <span className="muted">{activeParlay.sportsbook}</span> : null}
            {activeParlay?.betType ? <span className="dot" /> : null}
            {activeParlay?.betType ? <span className="muted">{activeParlay.betType}</span> : null}
          </div>

          {/* League split */}
          {computed.leagueSplit?.length ? (
            <div className="pr-splitRow" role="list" aria-label="League split">
              {computed.leagueSplit.map((x) => (
                <div key={x.league} className="splitChip" role="listitem">
                  <span className="splitLeague">{x.league}</span>
                  <span className="splitWL">{x.summary}</span>
                  <span className="splitPct muted">{x.hitRate}%</span>
                </div>
              ))}
            </div>
          ) : null}

          {/* Pick type split (ML vs SPREAD etc.) */}
          {computed.pickTypeSplit?.length ? (
            <div className="pr-splitRow pr-splitRow--types" role="list" aria-label="Pick type split">
              {computed.pickTypeSplit.map((x) => (
                <div key={x.type} className="splitChip splitChip--type" role="listitem">
                  <span className="splitLeague">{x.type}</span>
                  <span className="splitWL">{x.summary}</span>
                  <span className="splitPct muted">{x.hitRate}%</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="pr-rightCol">
          <div className="pr-metrics">
            <div className="metric">
              <div className="metric-k">{computed.legsCount}</div>
              <div className="metric-l">Legs</div>
            </div>
            <div className="metric">
              <div className="metric-k">
                {computed.wins}-{computed.losses}
              </div>
              <div className="metric-l">W–L</div>
            </div>
            <div className="metric">
              <div className="metric-k">{computed.hitRate}%</div>
              <div className="metric-l">Hit rate</div>
            </div>
          </div>

          {/* Actions */}
          <div className="pr-actions">
            <button className="btn" type="button" onClick={openCreate}>
              New Parlay
            </button>

            <button
              className="btn btn-ghost"
              type="button"
              onClick={openEdit}
              disabled={!activeSaved}
              title={!activeSaved ? "Load a saved parlay to edit it" : "Edit loaded parlay"}
            >
              Edit
            </button>

            <button className="btn btn-ghost" onClick={handleLoadLatest} type="button" disabled={!saved.length}>
              Load latest
            </button>

            <button className="btn btn-danger" onClick={handleClear} type="button" disabled={!saved.length}>
              Clear
            </button>
          </div>

          {/* Saved selector */}
          {saved.length ? (
            <div className="pr-saved">
              <label className="muted pr-savedLabel" htmlFor="savedParlays">
                Saved ({saved.length})
              </label>
              <select
                id="savedParlays"
                className="pr-select"
                value={activeSavedId}
                onChange={(e) => setActiveSavedId(e.target.value)}
              >
                <option value="">Current</option>
                {saved.map((p) => {
                  const decided = (p.legs ?? []).filter((l) => normalizeResult(l.result));
                  const w = decided.filter((l) => normalizeResult(l.result) === "WIN").length;
                  const n = decided.length;
                  const total = (p.legs ?? []).length;
                  const label = `${formatDate(p.date)} • ${w}/${n}${n !== total ? ` (/${total})` : ""}`;
                  return (
                    <option key={p.id} value={p.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : null}
        </div>
      </header>

      {/* Body */}
      <div className="pr-body">
        {/* Inline Editor */}
        {editorOpen ? (
          <div className="pr-editor" aria-label="Parlay editor">
            <div className="pr-editorHead">
              <div className="pr-editorTitle">{editorMode === "edit" ? "Edit Parlay" : "New Parlay"}</div>

              <div className="pr-editorBtns">
                {editorMode === "edit" ? (
                  <button className="btn btn-danger" type="button" onClick={handleDeleteActive}>
                    Delete
                  </button>
                ) : null}
                <button className="btn btn-ghost" type="button" onClick={() => setEditorOpen(false)}>
                  Cancel
                </button>
                <button className="btn" type="button" onClick={saveDraft} disabled={Boolean(draftError)}>
                  {editorMode === "edit" ? "Save Changes" : "Save Parlay"}
                </button>
              </div>
            </div>

            {draftError ? <div className="pr-editorError">{draftError}</div> : null}

            <div className="pr-editorGrid">
              <div className="field">
                <label className="fieldLabel">Date</label>
                <input
                  className="fieldInput"
                  type="date"
                  value={draft.date || ""}
                  onChange={(e) => onDraftChange({ date: e.target.value })}
                />
              </div>

              <div className="field">
                <label className="fieldLabel">Sportsbook</label>
                <input
                  className="fieldInput"
                  type="text"
                  value={draft.sportsbook || ""}
                  onChange={(e) => onDraftChange({ sportsbook: e.target.value })}
                  placeholder="DraftKings"
                />
              </div>

              <div className="field">
                <label className="fieldLabel">Bet Type</label>
                <select
                  className="fieldInput"
                  value={draft.betType || "Moneyline"}
                  onChange={(e) => onDraftChange({ betType: e.target.value })}
                >
                  <option>Moneyline</option>
                  <option>Spread</option>
                  <option>Total</option>
                  <option>Props</option>
                  <option>Other</option>
                </select>
              </div>

              <div className="field">
                <label className="fieldLabel">Stake</label>
                <input
                  className="fieldInput"
                  type="number"
                  inputMode="decimal"
                  value={draft.stake}
                  onChange={(e) => onDraftChange({ stake: e.target.value })}
                  placeholder="25"
                />
              </div>

              <div className="field field--wide">
                <label className="fieldLabel">Notes</label>
                <input
                  className="fieldInput"
                  type="text"
                  value={draft.notes || ""}
                  onChange={(e) => onDraftChange({ notes: e.target.value })}
                  placeholder="Optional notes…"
                />
              </div>
            </div>

            <div className="pr-legsEditorHead">
              <div className="muted">Legs</div>
              <button className="btn btn-ghost" type="button" onClick={addLeg}>
                Add Leg
              </button>
            </div>

            <div className="pr-legsEditor">
              {(draft.legs ?? []).map((leg, idx) => (
                <div className="legRow" key={`${leg.league || "L"}-${leg.team || "T"}-${idx}`}>
                  <div className="field">
                    <label className="fieldLabel">League</label>
                    <select
                      className="fieldInput"
                      value={leg.league || "NBA"}
                      onChange={(e) => onLegChange(idx, { league: e.target.value })}
                    >
                      <option>NBA</option>
                      <option>NHL</option>
                      <option>NFL</option>
                      <option>NCAAB</option>
                      <option>NCAAF</option>
                      <option>MLB</option>
                      <option>EPL</option>
                      <option>Other</option>
                    </select>
                  </div>

                  <div className="field field--team">
                    <label className="fieldLabel">Team</label>
                    <input
                      className="fieldInput"
                      type="text"
                      value={leg.team || ""}
                      onChange={(e) => onLegChange(idx, { team: e.target.value })}
                      placeholder="Boston Celtics"
                    />
                  </div>

                  <div className="field">
                    <label className="fieldLabel">Pick</label>
                    <select
                      className="fieldInput"
                      value={leg.pick || "ML"}
                      onChange={(e) => onLegChange(idx, { pick: e.target.value })}
                    >
                      <option value="ML">ML</option>
                      <option value="SPREAD">Spread</option>
                      <option value="TOTAL">Total</option>
                      <option value="PROPS">Props</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>

                  <div className="field">
                    <label className="fieldLabel">Odds / Line</label>
                    <input
                      className="fieldInput"
                      type="text"
                      value={leg.odds || ""}
                      onChange={(e) => onLegChange(idx, { odds: e.target.value })}
                      placeholder="-6.5 / +102"
                    />
                  </div>

                  <div className="field">
                    <label className="fieldLabel">Result</label>
                    <div className="seg">
                      <button
                        type="button"
                        className={`segBtn ${normalizeResult(leg.result) === "WIN" ? "segBtn--on" : ""}`}
                        onClick={() => onLegChange(idx, { result: "WIN" })}
                      >
                        WIN
                      </button>
                      <button
                        type="button"
                        className={`segBtn ${normalizeResult(leg.result) === "LOSS" ? "segBtn--on" : ""}`}
                        onClick={() => onLegChange(idx, { result: "LOSS" })}
                      >
                        LOSS
                      </button>
                    </div>
                  </div>

                  <div className="field field--remove">
                    <label className="fieldLabel">&nbsp;</label>
                    <button className="btn btn-danger" type="button" onClick={() => removeLeg(idx)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Legs table */}
        <div className="pr-legsHead">
          <span className="muted">League</span>
          <span className="muted">Team</span>
          <span className="muted pr-right">Pick</span>
          <span className="muted pr-right">Result</span>
        </div>

        <ul className="pr-legs" role="list">
          {(activeParlay?.legs ?? []).map((leg, idx) => {
            const league = normalizeLeague(leg.league);
            const team = (leg.team ?? "").toString();
            const pick = (leg.pick ?? "—").toString();
            const result = normalizeResult(leg.result);
            return (
              <li key={`${league}-${team}-${idx}`} className="pr-leg">
                <div className="pr-league">
                  <span className="badge">{league}</span>
                </div>

                <div className="pr-team">
                  <div className="pr-teamName">{team || "—"}</div>
                  {leg.odds ? <div className="pr-odds muted">{leg.odds}</div> : null}
                </div>

                <div className="pr-pick pr-right">
                  <span className="badge badge-soft">{pick || "—"}</span>
                </div>

                <div className="pr-result pr-right">
                  <span className={pillClass(result || "PENDING")}>{result || "PENDING"}</span>
                </div>
              </li>
            );
          })}
        </ul>

        {(activeParlay?.stake != null || activeParlay?.notes) ? (
          <div className="pr-foot">
            {activeParlay?.stake != null ? (
              <div className="muted">
                Stake:{" "}
                <span className="mutedStrong">
                  $
                  {Number.isFinite(Number(activeParlay.stake))
                    ? Number(activeParlay.stake).toFixed(2)
                    : "—"}
                </span>
              </div>
            ) : (
              <div />
            )}
            {activeParlay?.notes ? <div className="muted pr-notes">{activeParlay.notes}</div> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------
   Paste the CSS below into:
   apps/web/src/styles/app.css
---------------------------------------------------------- */
export const PARLAY_RESULTS_CARD_CSS = `
.pr-card{
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.06);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 16px 50px rgba(0,0,0,.35);
}

.pr-head{
  display:flex;
  gap:16px;
  align-items:flex-start;
  justify-content:space-between;
  padding:16px 16px 12px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}

.pr-titleWrap{ flex:1; min-width: 280px; }
.pr-titleRow{ display:flex; gap:10px; align-items:center; }
.pr-title{ margin:0; font-size:15px; letter-spacing:.2px; }
.pr-sub{ display:flex; gap:10px; align-items:center; margin-top:6px; flex-wrap:wrap; }
.dot{ width:4px; height:4px; border-radius:999px; background: rgba(255,255,255,.25); }

.pr-splitRow{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-top:10px;
}

.splitChip{
  display:flex;
  align-items:center;
  gap:8px;
  padding:6px 10px;
  border-radius:999px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.04);
}
.pr-splitRow--types .splitChip--type{
  background: rgba(255,255,255,.03);
  border-color: rgba(255,255,255,.08);
}
.splitLeague{ font-size:11px; font-weight:800; letter-spacing:.5px; }
.splitWL{ font-size:11px; font-weight:800; }
.splitPct{ font-size:11px; }

.pr-rightCol{
  display:flex;
  flex-direction:column;
  align-items:flex-end;
  gap:10px;
}

.pr-metrics{
  display:flex;
  gap:10px;
  align-items:stretch;
}

.metric{
  min-width:78px;
  padding:10px 12px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.05);
  border-radius: 14px;
  text-align:right;
}
.metric-k{ font-weight:800; font-size:14px; }
.metric-l{ font-size:11px; opacity:.7; margin-top:2px; }

.pr-actions{
  display:flex;
  gap:8px;
  justify-content:flex-end;
  flex-wrap:wrap;
}

.btn{
  appearance:none;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.08);
  color: rgba(255,255,255,.92);
  padding:8px 10px;
  border-radius: 12px;
  font-size:12px;
  font-weight:800;
  cursor:pointer;
}
.btn:hover{ background: rgba(255,255,255,.12); }
.btn:disabled{ opacity:.45; cursor:not-allowed; }
.btn-ghost{
  background: rgba(255,255,255,.04);
  border-color: rgba(255,255,255,.10);
}
.btn-danger{
  background: rgba(255,90,120,.10);
  border-color: rgba(255,90,120,.24);
}
.btn-danger:hover{
  background: rgba(255,90,120,.14);
}

.pr-saved{
  display:flex;
  gap:10px;
  align-items:center;
}
.pr-savedLabel{ font-size:11px; }

.pr-select{
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(0,0,0,.18);
  color: rgba(255,255,255,.92);
  padding:8px 10px;
  border-radius: 12px;
  font-size:12px;
  min-width: 180px;
}

.pr-body{ padding: 12px 12px 14px; }

.pr-legsHead{
  display:grid;
  grid-template-columns: 90px 1fr 90px 90px;
  gap:10px;
  padding: 0 8px 8px;
  font-size:11px;
  opacity:.8;
}
.pr-legs{ margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:8px; }
.pr-leg{
  display:grid;
  grid-template-columns: 90px 1fr 90px 90px;
  gap:10px;
  align-items:center;
  padding: 10px 8px;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(0,0,0,.12);
  border-radius: 14px;
}

.pr-right{ text-align:right; }

.badge{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:6px 10px;
  border-radius:999px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  font-size:11px;
  font-weight:800;
  letter-spacing:.2px;
}

.badge-soft{
  background: rgba(255,255,255,.04);
  border-color: rgba(255,255,255,.10);
}

.pr-teamName{ font-weight:800; font-size:13px; }
.pr-odds{ font-size:11px; margin-top:2px; opacity:.7; }

.pill{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:6px 10px;
  border-radius:999px;
  font-size:11px;
  font-weight:900;
  letter-spacing:.4px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
}
.pill-win{
  border-color: rgba(90,255,170,.30);
  background: rgba(90,255,170,.10);
}
.pill-loss{
  border-color: rgba(255,90,120,.30);
  background: rgba(255,90,120,.10);
}

.muted{ opacity:.75; font-size:12px; }
.mutedStrong{ opacity:1; font-weight:900; }

.pr-foot{
  display:flex;
  justify-content:space-between;
  gap:12px;
  margin-top:12px;
  padding: 10px 8px 0;
  border-top: 1px dashed rgba(255,255,255,.10);
}
.pr-notes{ max-width: 60%; text-align:right; }

/* ---------- Inline editor ---------- */

.pr-editor{
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(0,0,0,.10);
  border-radius: 16px;
  padding: 12px;
  margin-bottom: 12px;
}

.pr-editorHead{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom: 10px;
}

.pr-editorTitle{
  font-weight:900;
  letter-spacing:.2px;
}

.pr-editorBtns{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  justify-content:flex-end;
}

.pr-editorError{
  margin: 8px 0 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255,90,120,.24);
  background: rgba(255,90,120,.10);
  font-size:12px;
  font-weight:700;
}

.pr-editorGrid{
  display:grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap:10px;
}

.field{ display:flex; flex-direction:column; gap:6px; }
.fieldLabel{ font-size:11px; opacity:.75; }
.fieldInput{
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(0,0,0,.18);
  color: rgba(255,255,255,.92);
  padding: 10px 10px;
  border-radius: 12px;
  font-size:12px;
  outline:none;
}
.fieldInput:focus{
  border-color: rgba(255,255,255,.22);
  background: rgba(0,0,0,.22);
}

.field--wide{ grid-column: 1 / -1; }

.pr-legsEditorHead{
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin-top: 12px;
  margin-bottom: 8px;
}

.pr-legsEditor{
  display:flex;
  flex-direction:column;
  gap:10px;
}

.legRow{
  display:grid;
  grid-template-columns: 120px 1.6fr 110px 120px 160px 110px;
  gap:10px;
  align-items:end;
  padding: 10px;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.03);
  border-radius: 14px;
}

.field--team{ min-width: 0; }
.field--remove{ justify-content:flex-end; }

.seg{
  display:flex;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(0,0,0,.18);
  border-radius: 12px;
  overflow:hidden;
}
.segBtn{
  flex:1;
  padding: 10px 8px;
  font-size:12px;
  font-weight:900;
  color: rgba(255,255,255,.85);
  background: transparent;
  border: 0;
  cursor:pointer;
}
.segBtn--on{
  background: rgba(255,255,255,.10);
  color: rgba(255,255,255,.95);
}

/* mobile */
@media (max-width: 860px){
  .pr-head{ flex-direction:column; align-items:stretch; }
  .pr-rightCol{ align-items:stretch; }
  .pr-metrics{ justify-content:space-between; }
  .metric{ text-align:left; }
  .pr-actions{ justify-content:flex-start; }
  .pr-select{ width: 100%; min-width: 0; }

  .pr-legsHead, .pr-leg{
    grid-template-columns: 80px 1fr 72px 80px;
  }

  .pr-editorGrid{
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .legRow{
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .field--remove .btn{ width: 100%; }
  .pr-notes{ max-width: 100%; text-align:left; }
}
`;
