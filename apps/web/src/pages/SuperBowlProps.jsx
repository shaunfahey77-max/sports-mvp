import React, { useMemo, useState } from "react";

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyProp() {
  return { market: "First TD", pick: "", odds: "", result: "PENDING" };
}

export default function SuperBowlProps() {
  const [date, setDate] = useState(todayISODate());
  const [notes, setNotes] = useState("");
  const [props, setProps] = useState([emptyProp(), emptyProp(), emptyProp()]);

  const summary = useMemo(() => {
    const total = props.length;
    const wins = props.filter((p) => p.result === "WIN").length;
    const losses = props.filter((p) => p.result === "LOSS").length;
    const pending = props.filter((p) => p.result === "PENDING").length;
    return { total, wins, losses, pending };
  }, [props]);

  const onPropChange = (idx, patch) => {
    setProps((arr) => {
      const next = [...arr];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const addProp = () => setProps((arr) => [...arr, emptyProp()]);
  const removeProp = (idx) => setProps((arr) => arr.filter((_, i) => i !== idx));

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>
        <div className="muted" style={{ letterSpacing: 2, fontSize: 11 }}>
          MVP SPORTS
        </div>
        <h1 style={{ margin: "6px 0 6px", fontSize: 34, letterSpacing: -0.3 }}>Super Bowl Props</h1>
        <div className="muted">
          One-off seasonal page. Track prop bets here (separate from Parlay Lab).
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="muted" style={{ fontWeight: 800 }}>Game date</div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="pr-select"
            style={{ minWidth: 180 }}
          />

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span className="badge">Props: {summary.total}</span>
            <span className="badge badge-soft">W: {summary.wins}</span>
            <span className="badge badge-soft">L: {summary.losses}</span>
            <span className="badge badge-soft">Pending: {summary.pending}</span>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontWeight: 800, marginBottom: 6 }}>Notes</div>
          <input
            className="fieldInput"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
          />
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>Prop Bets</div>
          <button className="btn btn-ghost" type="button" onClick={addProp}>
            Add Prop
          </button>
        </div>

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {props.map((p, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "180px 1fr 160px 170px 120px",
                gap: 10,
                alignItems: "end",
                padding: 10,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.08)",
                background: "rgba(0,0,0,.12)",
              }}
            >
              <div className="field">
                <label className="fieldLabel">Market</label>
                <select
                  className="fieldInput"
                  value={p.market}
                  onChange={(e) => onPropChange(idx, { market: e.target.value })}
                >
                  <option>First TD</option>
                  <option>Anytime TD</option>
                  <option>Passing Yards</option>
                  <option>Rushing Yards</option>
                  <option>Receiving Yards</option>
                  <option>Longest Reception</option>
                  <option>Coin Toss</option>
                  <option>Other</option>
                </select>
              </div>

              <div className="field">
                <label className="fieldLabel">Pick</label>
                <input
                  className="fieldInput"
                  value={p.pick}
                  onChange={(e) => onPropChange(idx, { pick: e.target.value })}
                  placeholder="Player / Over / Under / Heads / Tails…"
                />
              </div>

              <div className="field">
                <label className="fieldLabel">Odds / Line</label>
                <input
                  className="fieldInput"
                  value={p.odds}
                  onChange={(e) => onPropChange(idx, { odds: e.target.value })}
                  placeholder="+120 / 79.5"
                />
              </div>

              <div className="field">
                <label className="fieldLabel">Result</label>
                <select
                  className="fieldInput"
                  value={p.result}
                  onChange={(e) => onPropChange(idx, { result: e.target.value })}
                >
                  <option value="PENDING">PENDING</option>
                  <option value="WIN">WIN</option>
                  <option value="LOSS">LOSS</option>
                </select>
              </div>

              <div className="field">
                <label className="fieldLabel">&nbsp;</label>
                <button className="btn btn-danger" type="button" onClick={() => removeProp(idx)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="muted" style={{ marginTop: 12 }}>
          Next step: save these to LocalStorage (separate key) and optionally “Send to Parlay Lab” as NFL PROPS.
        </div>
      </div>
    </div>
  );
}
