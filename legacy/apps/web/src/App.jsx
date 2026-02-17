// apps/web/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import LeagueHub from "./pages/LeagueHub";
import Predict from "./pages/Predict";
import TeamDetail from "./pages/TeamDetail";
import Upsets from "./pages/Upsets";
import ParlayLab from "./pages/ParlayLab";

/**
 * Normalize supported leagues.
 * Supports: nba, nhl, ncaam (NCAA Men's College Basketball)
 */
function normalizeLeague(raw) {
  const l = String(raw || "nba").toLowerCase();
  if (l === "nba") return "nba";
  if (l === "nhl") return "nhl";
  if (l === "ncaam") return "ncaam";
  return "nba";
}

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

/**
 * Nice URL alias:
 * /league/ncaam/tournament -> /league/ncaam?mode=tournament
 */
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

          {/* ✅ Parlay Lab */}
          <Route path="/parlay-lab" element={<ParlayLab />} />
          <Route path="/app/parlay-lab" element={<ParlayLab />} />
          <Route path="/parlay" element={<Navigate to="/parlay-lab" replace />} />

          {/* ✅ Upsets */}
          <Route path="/upsets" element={<Upsets />} />
          <Route path="/app/upsets" element={<Upsets />} />
          <Route path="/upset" element={<Navigate to="/upsets" replace />} />

          {/*
            Primary league route:
            - /league/nba   -> Predict
            - /league/nhl   -> Predict
            - /league/ncaam -> Predict (+ tournament via query)
          */}
          <Route path="/league/:league" element={<Predict />} />

          {/* Optional explicit alias (safe, clearer linking) */}
          <Route path="/league/:league/predict" element={<Predict />} />

          {/* ✅ Tournament alias */}
          <Route path="/league/ncaam/tournament" element={<NcaamTournamentRedirect />} />

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
          <Route path="/ncaam" element={<Navigate to="/league/ncaam" replace />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
