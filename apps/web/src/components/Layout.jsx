import { NavLink } from "react-router-dom";
import logo from "../assets/sports-mvp-logo.png";

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      style={({ isActive }) => ({
        textDecoration: "none",
        padding: "10px 14px",
        borderRadius: "12px",
        fontSize: "14px",
        fontWeight: 700,
        letterSpacing: "0.01em",
        color: isActive ? "#f8fafc" : "#cbd5e1",
        background: isActive ? "linear-gradient(180deg, rgba(30,111,219,0.26), rgba(30,111,219,0.14))" : "transparent",
        border: isActive ? "1px solid rgba(30,111,219,0.34)" : "1px solid transparent",
        boxShadow: isActive ? "0 10px 24px rgba(30,111,219,0.14)" : "none",
        transition: "all 160ms ease",
        whiteSpace: "nowrap",
      })}
    >
      {children}
    </NavLink>
  );
}

export default function Layout({ children }) {
  const styles = {
    shell: {
      minHeight: "100vh",
      background: "#040b18",
    },
    headerWrap: {
      position: "sticky",
      top: 0,
      zIndex: 50,
      backdropFilter: "blur(12px)",
      background:
        "linear-gradient(180deg, rgba(4,11,24,0.92) 0%, rgba(7,18,36,0.82) 100%)",
      borderBottom: "1px solid rgba(148,163,184,0.12)",
      boxShadow: "0 14px 32px rgba(0,0,0,0.22)",
    },
    headerInner: {
      maxWidth: "1280px",
      margin: "0 auto",
      padding: "14px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "18px",
    },
    brandWrap: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      textDecoration: "none",
      minWidth: 0,
    },
    brandLogo: {
      width: "44px",
      height: "44px",
      objectFit: "contain",
      filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.30))",
      flexShrink: 0,
    },
    brandText: {
      display: "flex",
      flexDirection: "column",
      lineHeight: 1.1,
      minWidth: 0,
    },
    brandTitle: {
      color: "#f8fafc",
      fontSize: "18px",
      fontWeight: 800,
      letterSpacing: "0.01em",
    },
    brandSub: {
      color: "#94a3b8",
      fontSize: "11px",
      fontWeight: 700,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      marginTop: "3px",
    },
    nav: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flexWrap: "wrap",
      justifyContent: "flex-end",
    },
    main: {
      maxWidth: "100%",
    },
  };

  return (
    <div style={styles.shell}>
      <header style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <NavLink to="/" style={styles.brandWrap} aria-label="Sports MVP home">
            <img src={logo} alt="Sports MVP" style={styles.brandLogo} />
            <div style={styles.brandText}>
              <span style={styles.brandTitle}>Sports MVP</span>
              <span style={styles.brandSub}>NBA • NHL • NCAAM</span>
            </div>
          </NavLink>

          <nav style={styles.nav} aria-label="Primary">
            <NavItem to="/">Home</NavItem>
            <NavItem to="/predict">Picks</NavItem>
            <NavItem to="/parlays">Parlays</NavItem>
            <NavItem to="/performance">Performance</NavItem>
            <NavItem to="/my-bets">My Bets</NavItem>
            <NavItem to="/tournament">Tournament</NavItem>
          </nav>
        </div>
      </header>

      <main style={styles.main}>{children}</main>
    </div>
  );
}
