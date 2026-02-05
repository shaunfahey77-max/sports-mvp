// apps/web/src/components/UpsetPickOfTheDay.jsx
import React from "react";

/**
 * Confidence badge system
 * - Keep it simple (3 tiers) and deterministic.
 * - Optionally allow numeric score -> tier mapping.
 */
export function getConfidenceTier(confidence) {
  // Accept: "Low" | "Medium" | "High" | number (0-100)
  if (typeof confidence === "number") {
    if (confidence >= 75) return "High";
    if (confidence >= 45) return "Medium";
    return "Low";
  }
  const c = String(confidence || "").toLowerCase();
  if (c.includes("high")) return "High";
  if (c.includes("med")) return "Medium";
  return "Low";
}

export function ConfidenceBadge({ confidence }) {
  const tier = getConfidenceTier(confidence);

  const meta = {
    Low: { label: "Low", className: "badge badge--low" },
    Medium: { label: "Medium", className: "badge badge--med" },
    High: { label: "High", className: "badge badge--high" },
  }[tier];

  return (
    <span className={meta.className} title={`Confidence: ${meta.label}`}>
      <span className="badge__dot" aria-hidden="true" />
      {meta.label} confidence
    </span>
  );
}

/**
 * UpsetPickOfTheDay
 *
 * Props:
 * - pick: {
 *    date?: string,
 *    league?: string,
 *    gameTime?: string,
 *    underdog: { name: string, abbr?: string },
 *    favorite: { name: string, abbr?: string },
 *    odds?: string,             // "+165"
 *    confidence?: "Low"|"Medium"|"High"|number,
 *    reasons?: string[],        // bullet list
 *    modelEdge?: string,        // "+3.2" optional
 *    note?: string              // short note
 *  }
 * - isPro: boolean
 * - onViewBreakdown: () => void
 * - onUpgrade: () => void
 * - onSeeAll: () => void
 */
export default function UpsetPickOfTheDay({
  pick,
  isPro = false,
  onViewBreakdown,
  onUpgrade,
  onSeeAll,
}) {
  if (!pick) return null;

  const tier = getConfidenceTier(pick.confidence);

  const headerKicker = "Upset Pick of the Day";
  const title = `${pick.underdog?.name} vs ${pick.favorite?.name}`;
  const sublineParts = [
    pick.league ? pick.league : null,
    pick.gameTime ? pick.gameTime : null,
    pick.date ? pick.date : null,
  ].filter(Boolean);

  // FREE vs PAID behavior:
  // - Free users: show matchup, odds, confidence tier, and 1 reason max (teaser).
  // - Pro users: show all reasons + model edge + deeper note.
  const reasons = Array.isArray(pick.reasons) ? pick.reasons : [];
  const visibleReasons = isPro ? reasons : reasons.slice(0, 1);

  const showLockedBits = !isPro;

  return (
    <section className="upset" aria-label="Upset pick of the day">
      <div className="upset__card">
        <div className="upset__top">
          <div className="upset__kicker">
            <span className="upset__icon" aria-hidden="true">⚡</span>
            <span>{headerKicker}</span>
          </div>

          <div className="upset__metaRow">
            <ConfidenceBadge confidence={pick.confidence} />
            {pick.odds ? <span className="pill">ML {pick.odds}</span> : null}
            {isPro && pick.modelEdge ? <span className="pill pill--edge">Edge {pick.modelEdge}</span> : null}
          </div>
        </div>

        <div className="upset__body">
          <h2 className="upset__title">{title}</h2>

          {sublineParts.length ? (
            <p className="upset__subline">
              {sublineParts.join(" • ")}
            </p>
          ) : null}

          <div className="upset__why">
            <div className="upset__whyHeader">
              <h3 className="upset__whyTitle">Why this can hit</h3>
              {!isPro ? (
                <span className="lockHint" aria-label="More details locked">
                  🔒 More insights in Pro
                </span>
              ) : null}
            </div>

            {visibleReasons.length ? (
              <ul className="upset__reasons">
                {visibleReasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="upset__muted">No notes yet — check back closer to tip/puck drop.</p>
            )}

            {isPro && pick.note ? (
              <p className="upset__note">{pick.note}</p>
            ) : null}

            {showLockedBits && reasons.length > 1 ? (
              <div className="upset__fade">
                <div className="upset__fadeInner" />
              </div>
            ) : null}
          </div>
        </div>

        <div className="upset__actions">
          <button
            className="btn btn--primary"
            onClick={isPro ? onViewBreakdown : onUpgrade}
            type="button"
          >
            {isPro ? "View breakdown →" : "Unlock full breakdown →"}
          </button>

          <button className="btn btn--ghost" onClick={onSeeAll} type="button">
            See all picks
          </button>
        </div>

        {/* subtle tier-driven accent */}
        <div className={`upset__accent upset__accent--${tier.toLowerCase()}`} aria-hidden="true" />
      </div>
    </section>
  );
}
