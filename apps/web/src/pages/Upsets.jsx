// apps/web/src/pages/Upsets.jsx
import { Link } from "react-router-dom";

export default function Upsets() {
  return (
    <div className="homeFull">
      <div className="container">
        <div className="panel" style={{ marginTop: 10 }}>
          <div className="panelHead">
            <div>
              <div style={{ fontWeight: 900 }}>Upset Watch</div>
              <div className="muted" style={{ marginTop: 6 }}>
                Underdog candidates with real win equity (based on today’s model slate).
              </div>
            </div>

            <div className="controls">
              <Link className="btnGhost" to="/">
                Home
              </Link>
              <Link className="btnPrimary" to="/league/nba">
                NBA
              </Link>
              <Link className="btnGhost" to="/league/nhl">
                NHL
              </Link>
            </div>
          </div>

          <div className="list">
            <div className="card">
              <div className="row">
                <div>
                  <div style={{ fontWeight: 900 }}>Coming next</div>
                  <div className="kicker">
                    We’ll mount the real upset table here (filters, confidence bands, and “why” factors).
                  </div>
                </div>
                <div className="muted">v0 placeholder</div>
              </div>
            </div>
          </div>
        </div>

        <div className="footer">
          <div className="footerInner">
            <div className="muted">Sports MVP</div>
            <div className="muted">Upset Watch</div>
          </div>
        </div>
      </div>
    </div>
  );
}
