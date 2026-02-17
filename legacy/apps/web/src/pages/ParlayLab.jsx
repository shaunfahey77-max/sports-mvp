// apps/web/src/pages/ParlayLab.jsx
import ParlayResultsCard from "../components/ParlayResultsCard";

export default function ParlayLab() {
  const starter = {
    id: "starter-2026-02-06",
    date: "2026-02-06",
    sportsbook: "DraftKings",
    betType: "Parlay",
    stake: 25,
    notes: "2-leg NBA parlay (test entry)",
    legs: [
      {
        id: "leg-1",
        league: "NBA",
        team: "Celtics",
        pickType: "SPREAD",
        line: "-6.5",
        odds: null,
        result: "LOSS",
      },
      {
        id: "leg-2",
        league: "NBA",
        team: "Milwaukee",
        pickType: "ML",
        line: null,
        odds: "+102",
        result: "WIN",
      },
    ],
  };

  return (
    <div className="pl-page">
      <header className="pl-head">
        <div>
          <div className="pl-kicker">MVP Sports</div>
          <h1 className="pl-title">Parlay Lab</h1>
          <p className="pl-sub">
            Log nightly parlays, track hit rate, and learn what pick types are actually working.
          </p>
        </div>
      </header>

      <div className="pl-grid">
        <div className="pl-main">
          <ParlayResultsCard parlay={starter} />
        </div>

        <aside className="pl-side">
          <div className="pl-panel">
            <div className="pl-panelTitle">What this feeds</div>
            <ul className="pl-list">
              <li>League hit rate (NBA vs NHL)</li>
              <li>Pick type hit rate (ML vs Spread)</li>
              <li>Parlay performance over time (saved history)</li>
              <li>Future: “Confidence-weighted” predictions</li>
            </ul>
          </div>

          <div className="pl-panel">
            <div className="pl-panelTitle">Tonight’s workflow</div>
            <ol className="pl-list">
              <li>New Parlay</li>
              <li>Add legs + results</li>
              <li>Save</li>
              <li>Tomorrow: Edit results if needed</li>
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
