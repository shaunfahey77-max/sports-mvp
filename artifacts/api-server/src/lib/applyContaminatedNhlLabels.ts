import { and, inArray, isNull } from "drizzle-orm";
import {
  candidateBetsTable,
  db,
  scoredPicksTable,
} from "@workspace/db";
import { logger } from "./logger";
import { DATA_QUALITY_CONTAMINATED_INGEST } from "../config/scoringModelConfig";

/**
 * The four NHL game_keys whose contaminated NHL ingest produced
 * stale-quote picks/candidates (see DATA_QUALITY_CONTAMINATED_INGEST in
 * scoringModelConfig.ts for context). The user-facing decision was:
 * NO date cutoff, NO row deletion — surgical row-level labels only.
 *
 * The label was originally applied via a one-off SQL UPDATE in the dev
 * workspace. The autoscale production deployment has its own database
 * (separate primary keys, separate row populations), so the same label
 * has to be re-applied at production deploy time.
 *
 * Wiring: this function is invoked from runMigrations() so that every
 * deploy (and every cold start) brings the production data set in line
 * with the labelled state the read-side filters in routes/picks.ts and
 * routes/performance.ts expect. The UPDATE is gated on
 * `data_quality IS NULL`, which makes it a strict no-op once the rows
 * are labeled — safe to run on every instance startup, safe across
 * concurrent autoscale boots (Postgres serializes per-row UPDATE locks).
 */
const CONTAMINATED_NHL_GAME_KEYS: readonly string[] = [
  "nhl_2026-04-14_col_cgy",
  "nhl_2026-04-14_wpg_mamm",
  "nhl_2026-04-14_wsh_cbj",
  "nhl_2026-04-15_sjs_chi",
];

export async function applyContaminatedNhlLabels(): Promise<void> {
  const keys = [...CONTAMINATED_NHL_GAME_KEYS];
  const label = DATA_QUALITY_CONTAMINATED_INGEST;

  const sp = await db
    .update(scoredPicksTable)
    .set({ dataQuality: label })
    .where(
      and(
        isNull(scoredPicksTable.dataQuality),
        inArray(scoredPicksTable.gameKey, keys),
      ),
    )
    .returning({ id: scoredPicksTable.id });

  const cb = await db
    .update(candidateBetsTable)
    .set({ dataQuality: label })
    .where(
      and(
        isNull(candidateBetsTable.dataQuality),
        inArray(candidateBetsTable.gameKey, keys),
      ),
    )
    .returning({ id: candidateBetsTable.id });

  if (sp.length > 0 || cb.length > 0) {
    logger.warn(
      {
        scoredPicks: sp.length,
        candidateBets: cb.length,
        gameKeys: keys,
        label,
      },
      "Applied contaminated_ingest labels to NHL rows on startup",
    );
  } else {
    logger.info(
      { label, gameKeys: keys.length },
      "contaminated_ingest NHL labels already applied (no-op)",
    );
  }
}
