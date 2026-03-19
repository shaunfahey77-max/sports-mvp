import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";

import Layout from "./components/Layout";
import ProtectedRoute from "./auth/ProtectedRoute";

import Home from "./pages/Home";
import Landing from "./pages/Landing";
import Predict from "./pages/Predict";
import Parlays from "./pages/Parlays";
import Performance from "./pages/Performance";
import LeagueHub from "./pages/LeagueHub";
import TeamDetail from "./pages/TeamDetail";
import ParlayLab from "./pages/ParlayLab";
import TournamentCenter from "./pages/TournamentCenter";
import MyBets from "./pages/MyBets";
import Login from "./pages/Login";
import EvScanner from "./pages/EvScanner";

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

function LeaguePredictRedirect() {
  const { league } = useParams();
  const l = normalizeLeague(league);
  return <Navigate to={`/league/${l}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          {/* Dashboard */}
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/app" element={<ProtectedRoute><Home /></ProtectedRoute>} />

          <Route path="/login" element={<Login />} />

          {/* Premium Picks workflow */}
          <Route path="/predict" element={<ProtectedRoute><Predict /></ProtectedRoute>} />
          <Route path="/all-picks" element={<Navigate to="/predict" replace />} />

          {/* Explicit league aliases used by current nav/buttons */}
          <Route path="/predict-nba" element={<Navigate to="/league/nba" replace />} />
          <Route path="/predict-nhl" element={<Navigate to="/league/nhl" replace />} />
          <Route path="/ncaab-predictions" element={<Navigate to="/league/ncaam" replace />} />

          {/* Core league routes */}
          <Route path="/league/:league" element={<ProtectedRoute><Predict /></ProtectedRoute>} />
          <Route path="/league/:league/predict" element={<ProtectedRoute><Predict /></ProtectedRoute>} />
          <Route path="/league/ncaam/tournament" element={<NcaamTournamentRedirect />} />

          {/* Nice aliases */}
          <Route path="/nba" element={<Navigate to="/league/nba" replace />} />
          <Route path="/nhl" element={<Navigate to="/league/nhl" replace />} />
          <Route path="/ncaam" element={<Navigate to="/league/ncaam" replace />} />
          <Route path="/predict/:league" element={<LeaguePredictRedirect />} />

          {/* Parlays */}
          <Route path="/parlays" element={<ProtectedRoute><Parlays /></ProtectedRoute>} />
          <Route path="/parlay-lab" element={<Parlays />} />
          <Route path="/app/parlays" element={<ProtectedRoute><Parlays /></ProtectedRoute>} />
          <Route path="/parlay" element={<Navigate to="/parlays" replace />} />
          <Route path="/app/parlay-lab" element={<ProtectedRoute><Parlays /></ProtectedRoute>} />
          <Route path="/legacy/parlay-lab" element={<ProtectedRoute><ParlayLab /></ProtectedRoute>} />

          {/* Performance */}
          <Route path="/performance" element={<ProtectedRoute><Performance /></ProtectedRoute>} />
          <Route path="/app/performance" element={<ProtectedRoute><Performance /></ProtectedRoute>} />

          {/* Retention layer */}
          <Route path="/my-bets" element={<ProtectedRoute><MyBets /></ProtectedRoute>} />
          <Route path="/tournament" element={<ProtectedRoute><TournamentCenter /></ProtectedRoute>} />
          <Route path="/bets" element={<Navigate to="/my-bets" replace />} />
          <Route path="/ledger" element={<Navigate to="/my-bets" replace />} />

          {/* Supporting pages */}
          <Route path="/league/:league/hub" element={<ProtectedRoute><LeagueHub /></ProtectedRoute>} />
          <Route path="/league/:league/team/:teamId" element={<ProtectedRoute><TeamDetail /></ProtectedRoute>} />

          {/* Legacy redirects */}
          <Route path="/team/:league/:teamId" element={<TeamLegacyRedirect />} />
          <Route path="/:league/team/:teamId" element={<TeamLegacyRedirect />} />
          <Route path="/:league/hub" element={<HubLegacyRedirect />} />

          <Route path="/ev" element={<ProtectedRoute><EvScanner /></ProtectedRoute>} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
