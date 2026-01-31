import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Teams from "./pages/Teams";
import TeamDetail from "./pages/TeamDetail";

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1>Sports MVP</h1>

        <nav style={{ marginBottom: 16 }}>
          <Link to="/" style={{ marginRight: 8 }}>Home</Link>
          <Link to="/teams">Teams</Link>
        </nav>

        <Routes>
          <Route path="/" element={<div>Welcome 👋</div>} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:id" element={<TeamDetail />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
