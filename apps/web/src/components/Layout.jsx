// apps/web/src/components/Layout.jsx
import { NavLink } from "react-router-dom";

export default function Layout({ children }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbarInner">
          <div className="brand">
            <span className="logoDot" aria-hidden="true" />
            <div className="brandText">
              <div className="brandName">Sports MVP</div>
              <div className="brandTag">NBA • NHL • NCAAM</div>
            </div>
          </div>

          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
              Home
            </NavLink>

            <NavLink to="/league/nba" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
              NBA
            </NavLink>

            <NavLink to="/league/nhl" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
              NHL
            </NavLink>

            <NavLink to="/league/ncaam" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
              NCAAM
            </NavLink>

            <NavLink to="/parlay-lab" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
              Parlay Lab
            </NavLink>

            <NavLink to="/upsets" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
              Upset Watch
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="container">
        {children}
        <footer className="footer">
          <div className="footerInner">
            <span className="muted">Sports MVP</span>
            <span className="muted">Model: rolling win% (MVP)</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
