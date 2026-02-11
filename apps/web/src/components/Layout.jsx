// apps/web/src/components/Layout.jsx
import { NavLink } from "react-router-dom";

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `navLink ${isActive ? "navLinkActive" : ""}`}
      end={to === "/"}
    >
      {children}
    </NavLink>
  );
}

export default function Layout({ children }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="pill">
              <span style={{ fontWeight: 900, letterSpacing: ".02em" }}>Sports MVP</span>
              <span className="muted2" style={{ fontSize: 12 }}>NBA • NHL • NCAAM</span>
            </span>
          </div>

          <nav className="nav">
            <NavItem to="/">Home</NavItem>
            <NavItem to="/league/nba">NBA</NavItem>
            <NavItem to="/league/nhl">NHL</NavItem>
            <NavItem to="/league/ncaam">NCAAM</NavItem>
            <NavItem to="/parlay-lab">Parlay Lab</NavItem>
            <NavItem to="/upsets">Upset Watch</NavItem>
          </nav>
        </div>
      </header>

      {children}
    </>
  );
}
