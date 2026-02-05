// apps/web/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import LeagueHub from "./pages/LeagueHub";
import Predict from "./pages/Predict";
import TeamDetail from "./pages/TeamDetail";
import Upsets from "./pages/Upsets"; // ✅ ADD

function normalizeLeague(raw) {
  const l = String(raw || "nba").toLowerCase();
  return l === "nhl" ? "nhl" : "nba"; // lock to supported leagues
}

/**
 * Redirect legacy team URLs to the canonical route:
 * /league/:league/team/:teamId
 */
function TeamLegacyRedirect() {
  const { league, teamId } = useParams();
  const l = normalizeLeague(league);
  if (!teamId) return <Navigate to={`/league/${l}`} replace />;
  return <Navigate to={`/league/${l}/team/${teamId}`} replace />;
}

/**
 * Redirect legacy hub URLs to the canonical route:
 * /league/:league/hub
 *
 * Examples:
 * /nhl/hub -> /league/nhl/hub
 * /nba/hub -> /league/nba/hub
 */
function HubLegacyRedirect() {
  const { league } = useParams();
  const l = normalizeLeague(league);
  return <Navigate to={`/league/${l}/hub`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          {/* Primary flow */}
          <Route path="/" element={<Home />} />

          {/* ✅ Upsets (public + "logged-in area" namespace) */}
          <Route path="/upsets" element={<Upsets />} />
          <Route path="/app/upsets" element={<Upsets />} />

          {/* Optional legacy shortcut */}
          <Route path="/upset" element={<Navigate to="/upsets" replace />} />

          {/* Default league route goes to Predictions */}
          <Route path="/league/:league" element={<Predict />} />

          {/* Hub still accessible */}
          <Route path="/league/:league/hub" element={<LeagueHub />} />

          {/* ✅ Canonical team route */}
          <Route path="/league/:league/team/:teamId" element={<TeamDetail />} />

          {/* ✅ Back-compat: old team route patterns redirect to canonical */}
          <Route path="/team/:league/:teamId" element={<TeamLegacyRedirect />} />
          <Route path="/:league/team/:teamId" element={<TeamLegacyRedirect />} />

          {/* ✅ Back-compat: legacy hub route patterns redirect to canonical */}
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
