import { BrowserRouter, Routes, Route } from "react-router-dom";
import Teams from "./pages/Teams.jsx";
import TeamDetail from "./pages/TeamDetail.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Teams />} />
        <Route path="/teams/:id" element={<TeamDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
