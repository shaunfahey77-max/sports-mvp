import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import GamesTabs from "./pages/GamesTabs.jsx";
import TeamDetail from "./pages/TeamDetail.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Default landing */}
        <Route path="/" element={<Navigate to="/games" replace />} />

        {/* Games with NBA / NHL tabs */}
        <Route path="/games" element={<GamesTabs />} />

        {/* Optional: keep old URLs working (redirects) */}
        <Route path="/nba/games" element={<Navigate to="/games" replace />} />
        <Route path="/nhl/games" element={<Navigate to="/games" replace />} />

        {/* Team detail (shared) */}
        <Route path="/teams/:id" element={<TeamDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
