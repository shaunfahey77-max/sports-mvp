// apps/web/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import LeagueHub from "./pages/LeagueHub";
import Predict from "./pages/Predict";
import TeamDetail from "./pages/TeamDetail";
import Upsets from "./pages/Upsets";
import ParlayLab from "./pages/ParlayLab";
import SuperBowlProps from "./pages/SuperBowlProps";

function normalizeLeague(raw) {
  const l = String(raw || "nba").toLowerCase();
  return l === "nhl" ? "nhl" : "nba";
}

// Seasonal toggle (unique to Super Bowl)
const SHOW_SUPERBOWL = String(import.meta.env.VITE_SHOW_SUPERBOWL || "false").toLowerCase() === "true";

/**
 * Redirect legacy team URLs to:
 * /league/:league/team/:teamId
 */
function TeamLegacyRedirect() {
  const { league, teamId } = useParams();
  const l = normalizeLeague(league);
  if (!teamId) return <Navigate to={`/league/${l}`} replace />;
  return <Navigate to={`/league/${l}/team/${teamId}`} replace />;
}

/**
 * Redirect legacy hub URLs to:
 * /league/:league/hub
 */
function HubLegacyRedirect() {
  const { league } = useParams();
  const l = normalizeLeague(league);
  return <Navigate to={`/league/${l}/hub`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout showSuperBowl={SHOW_SUPERBOWL}>
        <Routes>
          {/* Primary flow */}
          <Route path="/" element={<Home />} />

          {/* ✅ Parlay Lab */}
          <Route path="/parlay-lab" element={<ParlayLab />} />
          <Route path="/app/parlay-lab" element={<ParlayLab />} />
          <Route path="/parlay" element={<Navigate to="/parlay-lab" replace />} />

          {/* ✅ Upsets */}
          <Route path="/upsets" element={<Upsets />} />
          <Route path="/app/upsets" element={<Upsets />} />
          <Route path="/upset" element={<Navigate to="/upsets" replace />} />

          {/* ✅ Super Bowl (seasonal) */}
          {SHOW_SUPERBOWL ? (
            <>
              <Route path="/superbowl" element={<SuperBowlProps />} />
              <Route path="/super-bowl" element={<Navigate to="/superbowl" replace />} />
              <Route path="/super-bowl-props" element={<Navigate to="/superbowl" replace />} />
            </>
          ) : null}

          {/* Default league route goes to Predictions */}
          <Route path="/league/:league" element={<Predict />} />

          {/* Hub */}
          <Route path="/league/:league/hub" element={<LeagueHub />} />

          {/* Team */}
          <Route path="/league/:league/team/:teamId" element={<TeamDetail />} />

          {/* Back-compat redirects */}
          <Route path="/team/:league/:teamId" element={<TeamLegacyRedirect />} />
          <Route path="/:league/team/:teamId" element={<TeamLegacyRedirect />} />
          <Route path="/:league/hub" element={<HubLegacyRedirect />} />

          {/* Back-compat league shortcuts */}
          <Route path="/nba" element={<Navigate to="/league/nba" replace />} />
          <Route path="/nhl" element={<Navigate to="/league/nhl" replace />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
