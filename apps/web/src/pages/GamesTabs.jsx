import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
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

  const linkBase =
    "px-3 py-2 rounded-lg text-sm font-semibold border border-white/10";
  const active = "bg-white/10 text-white";
  const inactive = "bg-white/5 text-white/70 hover:text-white hover:bg-white/10";

  return (
    <div style={{ padding: 16, maxWidth: 960, margin: "0 auto" }}>
      {/* TOP NAV */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <NavLink to="/games" className={({ isActive }) =>
          `${linkBase} ${isActive ? active : inactive}`
        }>
          Games
        </NavLink>

        <NavLink to="/predict" className={({ isActive }) =>
          `${linkBase} ${isActive ? active : inactive}`
        }>
          NBA Predict
        </NavLink>

        <NavLink to="/predict/nhl" className={({ isActive }) =>
          `${linkBase} ${isActive ? active : inactive}`
        }>
          NHL Predict
        </NavLink>
      </div>

      {/* LEAGUE TABS */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setLeague(t.key)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background:
                league === t.key
                  ? "rgba(255,255,255,0.15)"
                  : "transparent",
              color: "rgba(255,255,255,0.9)",
              fontWeight: league === t.key ? 700 : 600,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Games league={league} />
    </div>
  );
}
