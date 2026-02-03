import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import GamesTabs from "./pages/GamesTabs.jsx";
import TeamDetail from "./pages/TeamDetail.jsx";
import Predict from "./pages/Predict.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/games" replace />} />

        <Route path="/games" element={<GamesTabs />} />

        <Route path="/nba/games" element={<Navigate to="/games" replace />} />
        <Route path="/nhl/games" element={<Navigate to="/games" replace />} />

        <Route path="/teams/:id" element={<TeamDetail />} />

        {/* NEW */}
        <Route path="/predict" element={<Predict />} />
        {/* optional: keep /predictions working */}
        <Route path="/predictions" element={<Navigate to="/predict" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
