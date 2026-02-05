import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div>
      <h1 className="h1">Sports MVP</h1>
      <p className="sub">
        Choose a league to view games by date and model predictions with confidence.
      </p>

      <div className="grid2">
        <Link to="/league/nba" className="tile" aria-label="Go to NBA hub">
          <div className="badge">
            <span className="dot" style={{ background: "var(--nba)" }} />
            NBA
          </div>
          <div style={{ height: 10 }} />
          <div className="tileTitle">NBA Games & Predictions</div>
          <div className="tileMeta">
            Date-based slate • Picks + confidence • Team drilldown
          </div>
        </Link>

        <Link to="/league/nhl" className="tile" aria-label="Go to NHL hub">
          <div className="badge">
            <span className="dot" style={{ background: "var(--nhl)" }} />
            NHL
          </div>
          <div style={{ height: 10 }} />
          <div className="tileTitle">NHL Games & Predictions</div>
          <div className="tileMeta">
            Date-based slate • Picks + confidence • Team drilldown
          </div>
        </Link>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panelHead">
          <div>
            <div style={{ fontWeight: 760 }}>What this is</div>
            <div className="muted">
              An MVP prediction modeler for quick daily picks. Stable API + premium UX first, then model upgrades.
            </div>
          </div>
        </div>
        <div className="list">
          <div className="card">
            <div className="row">
              <div style={{ fontWeight: 700 }}>Model</div>
              <div className="muted">Rolling win% window</div>
            </div>
            <div className="kicker">
              Confidence is derived from win% diff across a selectable recent window.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
