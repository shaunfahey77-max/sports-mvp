import { useMemo, useState } from "react";
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
                border: "1px solid rgba(0,0,0,0.15)",
                background: active ? "rgba(0,0,0,0.08)" : "white",
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
