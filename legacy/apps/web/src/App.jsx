// legacy/apps/web/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import Layout from "./components/Layout.jsx";

import Home from "./pages/Home.jsx";
import LeagueHub from "./pages/LeagueHub.jsx";
import Predict from "./pages/Predict.jsx";
import TeamDetail from "./pages/TeamDetail.jsx";
import Upsets from "./pages/Upsets.jsx";
import Performance from "./pages/Performance.jsx";
import ParlayLab from "./pages/ParlayLab.jsx";

function normalizeLeague(raw) {
  const l = String(raw || "nba").toLowerCase();
  if (l === "nba") return "nba";
  if (l === "nhl") return "nhl";
  if (l === "ncaam") return "ncaam";
  return "nba";
}

function TeamLegacyRedirect() {
  const { league, teamId } = useParams();
  const l = normalizeLeague(league);
  if (!teamId) return <Navigate to={`/league/${l}`} replace />;
  return <Navigate to={`/league/${l}/team/${teamId}`} replace />;
}

function HubLegacyRedirect() {
  const { league } = useParams();
  const l = normalizeLeague(league);
  return <Navigate to={`/league/${l}/hub`} replace />;
}

function NcaamTournamentRedirect() {
  return <Navigate to="/league/ncaam?mode=tournament" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          {/* Home */}
          <Route path="/" element={<Home />} />

          {/* Performance (NEW, required for premium dashboard) */}
          <Route path="/performance" element={<Performance />} />
          <Route path="/app/performance" element={<Navigate to="/performance" replace />} />

          {/* Parlay Lab */}
          <Route path="/parlay-lab" element={<ParlayLab />} />
          <Route path="/app/parlay-lab" element={<ParlayLab />} />
          <Route path="/parlay" element={<Navigate to="/parlay-lab" replace />} />

          {/* Upsets */}
          <Route path="/upsets" element={<Upsets />} />
          <Route path="/app/upsets" element={<Upsets />} />
          <Route path="/upset" element={<Navigate to="/upsets" replace />} />

          {/* League predict (primary) */}
          <Route path="/league/:league" element={<Predict />} />
          <Route path="/league/:league/predict" element={<Predict />} />

          {/* Tournament alias */}
          <Route path="/league/ncaam/tournament" element={<NcaamTournamentRedirect />} />

          {/* Hub */}
          <Route path="/league/:league/hub" element={<LeagueHub />} />

          {/* Team */}
          <Route path="/league/:league/team/:teamId" element={<TeamDetail />} />

          {/* Back-compat redirects */}
          <Route path="/team/:league/:teamId" element={<TeamLegacyRedirect />} />
          <Route path="/:league/team/:teamId" element={<TeamLegacyRedirect />} />
          <Route path="/:league/hub" element={<HubLegacyRedirect />} />

          {/* Shortcuts */}
          <Route path="/nba" element={<Navigate to="/league/nba" replace />} />
          <Route path="/nhl" element={<Navigate to="/league/nhl" replace />} />
          <Route path="/ncaam" element={<Navigate to="/league/ncaam" replace />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
