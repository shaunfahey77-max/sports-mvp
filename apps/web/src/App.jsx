import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Games from "./pages/Games.jsx";
import TeamDetail from "./pages/TeamDetail.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Default landing → NBA */}
        <Route path="/" element={<Navigate to="/nba/games" replace />} />

        {/* NBA & NHL games */}
        <Route path="/nba/games" element={<Games league="nba" />} />
        <Route path="/nhl/games" element={<Games league="nhl" />} />

        {/* Team detail (shared) */}
        <Route path="/teams/:id" element={<TeamDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
