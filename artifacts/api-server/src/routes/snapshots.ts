import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { gameSnapshotsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  GenerateSnapshotsBody,
  FinalizeClosesBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/snapshots", async (req, res): Promise<void> => {
  const { date, league, status } = req.query as Record<string, string | undefined>;

  let query = db.select().from(gameSnapshotsTable);

  const conditions = [];
  if (date) conditions.push(eq(gameSnapshotsTable.snapshotDate, date));
  if (league) conditions.push(eq(gameSnapshotsTable.league, league));
  if (status) conditions.push(eq(gameSnapshotsTable.status, status));

  const snapshots =
    conditions.length > 0
      ? await db
          .select()
          .from(gameSnapshotsTable)
          .where(and(...conditions))
      : await query;

  res.json(snapshots);
});

router.post("/snapshots/generate", async (req, res): Promise<void> => {
  const parsed = GenerateSnapshotsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { date, games } = parsed.data;
  const errors: string[] = [];
  let count = 0;

  if (!games || games.length === 0) {
    res.json({ success: true, message: "No games provided", count: 0, errors: [] });
    return;
  }

  for (const game of games) {
    try {
      await db
        .insert(gameSnapshotsTable)
        .values({
          gameKey: game.gameKey,
          league: game.league,
          eventStart: new Date(game.eventStart),
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          homePublishMl: String(game.homePublishMl),
          awayPublishMl: String(game.awayPublishMl),
          publishSpread: game.publishSpread != null ? String(game.publishSpread) : undefined,
          publishSpreadLine:
            game.publishSpreadLine != null ? String(game.publishSpreadLine) : undefined,
          publishTotal: game.publishTotal != null ? String(game.publishTotal) : undefined,
          publishOverLine:
            game.publishOverLine != null ? String(game.publishOverLine) : undefined,
          publishUnderLine:
            game.publishUnderLine != null ? String(game.publishUnderLine) : undefined,
          status: "scheduled",
          snapshotDate: date,
        })
        .onConflictDoUpdate({
          target: gameSnapshotsTable.gameKey,
          set: {
            homePublishMl: String(game.homePublishMl),
            awayPublishMl: String(game.awayPublishMl),
            publishSpread: game.publishSpread != null ? String(game.publishSpread) : undefined,
            publishSpreadLine:
              game.publishSpreadLine != null ? String(game.publishSpreadLine) : undefined,
            publishTotal: game.publishTotal != null ? String(game.publishTotal) : undefined,
            publishOverLine:
              game.publishOverLine != null ? String(game.publishOverLine) : undefined,
            publishUnderLine:
              game.publishUnderLine != null ? String(game.publishUnderLine) : undefined,
            updatedAt: new Date(),
          },
        });
      count++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${game.gameKey}: ${message}`);
      req.log.error({ game: game.gameKey, err }, "Failed to insert snapshot");
    }
  }

  res.json({
    success: errors.length === 0,
    message: `Generated ${count} snapshot(s)`,
    count,
    errors,
  });
});

router.post("/snapshots/finalize", async (req, res): Promise<void> => {
  const parsed = FinalizeClosesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { date } = parsed.data;
  const snapshots = await db
    .select()
    .from(gameSnapshotsTable)
    .where(eq(gameSnapshotsTable.snapshotDate, date));

  res.json({
    success: true,
    message: `Finalize called for ${date} — update close lines via direct DB or bulk endpoint`,
    count: snapshots.length,
    errors: [],
  });
});

export default router;
