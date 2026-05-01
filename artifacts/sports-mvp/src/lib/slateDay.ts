/**
 * Slate-day helper.
 *
 * The entire backend buckets games and picks by the *Eastern Time*
 * calendar date of the scheduled `commence_time` — see
 * `artifacts/api-server/src/lib/oddsApi.ts` `transformGame()`, which
 * computes the date via
 * `Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })` and
 * embeds it into both `gameKey` and `snapshotDate`. From there it
 * propagates into `scoredPicks.date` and the `gameKey LIKE` filter
 * used by the candidates endpoint.
 *
 * Earlier the dashboard used `format(new Date(), 'yyyy-MM-dd')` —
 * which formats in the *browser's* local timezone — to compute the
 * "today" string sent to those endpoints. For any user whose browser
 * timezone is ahead of ET (UTC, UK, EU, Asia, …), late in the
 * evening ET the browser had already rolled over to "tomorrow" and
 * the dashboard would request games whose ET commence date was the
 * NEXT slate, mislabeling them as "Today's Picks".
 *
 * This helper is the one place the frontend agrees with the server
 * on what "today" means.
 */

/**
 * Returns the current ET-bucket slate day as a `YYYY-MM-DD` string —
 * exactly the format the server stores and queries against. Match
 * this with `transformGame()` in api-server's oddsApi.ts; if you
 * change the timezone here, change it there too.
 *
 * @param now optional reference instant (mostly for tests) — defaults
 *   to `new Date()` so callers can `getSlateDayET()` with no args.
 */
export function getSlateDayET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(now);
}
