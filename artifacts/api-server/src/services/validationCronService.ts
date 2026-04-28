/**
 * ============================================================================
 * PARKED — DO NOT WIRE INTO WORKFLOW UNTIL APPROVED
 * ============================================================================
 *
 * This service is the parked-but-implementation-ready scaffold for the
 * validation cron described in `.local/validation-cron-proposal.md`. It is
 * intentionally NOT imported by `src/index.ts` — wiring it on is a one-line
 * change inside the existing `if (!cronDisabled)` block of `bootstrap()`.
 *
 * Hold contract (active until the 2026-05-05 watch read clears it):
 *   - This file MUST NOT be imported by any production code path.
 *   - The exported `startValidationCron` MUST NOT be called from anywhere
 *     other than a future, explicit greenlight commit.
 *   - The function body below is structurally complete (schedule string,
 *     proposal list, retention math) so that the greenlight commit is
 *     small and reviewable.
 *
 * Greenlight checklist before unparking — see proposal §7:
 *   1. May 5 watch-read verdict file exists and recommends promote/hold.
 *   2. User explicitly approves the schedule and alert sink.
 *   3. `validation_alerts` table schema is migrated.
 *   4. The wire-up commit also moves the disk-write path from
 *      `.local/validation_dryruns/` to a database-backed sink, OR the
 *      operator confirms file-only output is acceptable.
 *
 * Until those four conditions are met, this file is a typecheck-clean
 * stub. The `_unused` underscore prefixes on the schedule constants
 * keep the file lint-clean while the wire-up is parked.
 */

import { logger } from "../lib/logger";

/**
 * Cron expression for the weekly run. Sunday 04:00 ET — after
 * runNightlyValidation (3:30 AM) has finalized the previous night's
 * settlements, so the replay's window includes them.
 */
const _UNUSED_WEEKLY_SCHEDULE = "0 4 * * 0";

/**
 * Proposals the weekly job should replay against. Mirrors the proposal
 * map in `scripts/validateGateChange.ts`. Add a new id here when a new
 * proposal lands; do not remove ids that have been promoted to live
 * config (the replay value of a no-op proposal is "did anything in the
 * post-promotion window contradict the original lift?").
 */
const _UNUSED_ACTIVE_PROPOSALS = ["R1", "R2"] as const;

/**
 * Disk retention: keep the latest N JSON reports per proposal. At
 * weekly cadence, 26 ≈ six months of history. The greenlight commit
 * may move this to a DB-backed sink instead of trimming disk.
 */
const _UNUSED_REPORTS_PER_PROPOSAL_TO_KEEP = 26;

/**
 * The window the replay should use on each tick. End at yesterday so
 * settlements have all run; start 30 days back so the cohort is large
 * enough for the alerting logic to be defensible.
 */
const _UNUSED_WINDOW_DAYS = 30;

/**
 * Parked. Calling this is a no-op that logs a single warning so that
 * if anyone wires it on by accident before the greenlight, the warning
 * lands in the cron logs and they can back it out.
 *
 * The full implementation (cron.schedule, child-process spawn of the
 * replay tsx command, JSON diff logic, optional DB writeback) lives
 * inline in the proposal file rather than here, because keeping it
 * here would (a) silently extend the runtime surface area of the
 * paused service and (b) require imports that the typecheck would
 * pull into the active build. The greenlight commit re-introduces
 * those imports in one place and reviewers see the entire delta.
 */
export function startValidationCron(): void {
  logger.warn(
    {
      schedule: _UNUSED_WEEKLY_SCHEDULE,
      proposals: _UNUSED_ACTIVE_PROPOSALS,
      windowDays: _UNUSED_WINDOW_DAYS,
      reportsKept: _UNUSED_REPORTS_PER_PROPOSAL_TO_KEEP,
    },
    "validation-cron: startValidationCron() invoked while service is PARKED — see .local/validation-cron-proposal.md before unparking",
  );
}
