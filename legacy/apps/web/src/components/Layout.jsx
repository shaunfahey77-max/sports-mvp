// legacy/apps/web/src/components/Layout.jsx
import { Link, NavLink } from "react-router-dom";

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `pill ${isActive ? "pillActive" : ""}`
      }
    >
      {children}
    </NavLink>
  );
}

export default function Layout({ children }) {
  return (
    <div className="page">
      <div className="shell">
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <Link to="/" className="h1" style={{ fontSize: 18, display: "inline-block" }}>
                MVP Sports
              </Link>
              <div className="sub">Premium dashboard • Predictions • Upset Watch</div>
            </div>

            <div className="pills" style={{ justifyContent: "flex-end" }}>
              <NavItem to="/">Home</NavItem>
              <NavItem to="/performance">Performance</NavItem>
              <NavItem to="/league/nba">NBA</NavItem>
              <NavItem to="/league/nhl">NHL</NavItem>
              <NavItem to="/league/ncaam">NCAAM</NavItem>
              <NavItem to="/upsets">Upsets</NavItem>
              <NavItem to="/parlay-lab">Parlay Lab</NavItem>
            </div>
          </div>
        </div>

        {children}

        <div className="sub" style={{ marginTop: 18, opacity: 0.7 }}>
          API: <span className="badge">/api</span>
        </div>
      </div>
    </div>
  );
}
