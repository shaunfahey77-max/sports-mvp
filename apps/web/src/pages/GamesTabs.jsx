import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Games from "./Games";

export default function GamesTabs() {
  const [league, setLeague] = useState("nba");

  const tabs = useMemo(
    () => [
      { key: "nba", label: "NBA" },
      { key: "nhl", label: "NHL" },
    ],
    []
  );

  return (
    <div style={{ padding: 24 }}>
      {/* TOP NAV */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        <Link to="/games">Games</Link>
        <Link to="/predict">Predictions</Link>
      </div>

      {/* LEAGUE TABS */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => {
          const active = t.key === league;
          return (
            <button
              key={t.key}
              onClick={() => setLeague(t.key)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: active ? "rgba(255,255,255,0.15)" : "transparent",
                fontWeight: active ? 700 : 600,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <Games league={league} />
    </div>
  );
}
