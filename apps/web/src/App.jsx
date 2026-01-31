import { BrowserRouter, Routes, Route } from "react-router-dom";
import Teams from "./pages/Teams";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Teams />} />
      </Routes>
    </BrowserRouter>
  );
}
