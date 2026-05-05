import { db } from "@workspace/db";
import { marketRegistryTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  CALIBRATION_VERSION,
  MARKET_DISABLED,
  MARKET_MODEL_WATCH_ONLY,
  MODEL_VERSION,
} from "../config/scoringModelConfig";

export type RegistryResolutionSource =
  | "market_registry"
  | "config_fallback"
  | "market_registry_empty";

export interface ResolvedMarketRegistryKeys {
  source: RegistryResolutionSource;
  keys: string[];
}

export interface MarketRegistrySyncResult {
  rows: number;
  bySurfaceStatus: Record<string, number>;
}

export type ResolvedSurfaceStatus =
  | "shadow"
  | "model_watch"
  | "official"
  | "suppressed";

export interface ResolvedMarketSurfaceStatuses {
  source: RegistryResolutionSource;
  byMarketKey: Record<string, ResolvedSurfaceStatus>;
}

/**
 * Transitional helper for the rebuild's registry-driven control plane.
 *
 * If the registry has rows for a given surface status, they are the source of
 * truth. If not, we fall back to the legacy config map so the system remains
 * operational while the registry is still being populated.
 */
export async function resolveMarketKeysForSurfaceStatus(
  surfaceStatus: string,
  fallbackKeys: readonly string[],
  options: { requireRegistry?: boolean } = {},
): Promise<ResolvedMarketRegistryKeys> {
  const rows = await db
    .select({
      league: marketRegistryTable.league,
      market: marketRegistryTable.market,
    })
    .from(marketRegistryTable)
    .where(eq(marketRegistryTable.surfaceStatus, surfaceStatus));

  if (rows.length > 0) {
    const keys = rows
      .map((r) => `${r.league}_${r.market}`)
      .sort();
    return { source: "market_registry", keys };
  }

  if (options.requireRegistry) {
    return {
      source: "market_registry_empty",
      keys: [],
    };
  }

  return {
    source: "config_fallback",
    keys: [...fallbackKeys].sort(),
  };
}

const REQUIRED_REBUILD_LEAGUES = [
  "nba",
  "nhl",
  "mlb",
  "nfl",
  "ncaaf",
  "ncaam",
] as const;

const REQUIRED_REBUILD_MARKETS = [
  "moneyline",
  "spread",
  "total",
] as const;

function legacySurfaceStatusForMarket(key: string): string {
  if (MARKET_MODEL_WATCH_ONLY[key]) return "model_watch";
  if (MARKET_DISABLED[key]) return "suppressed";
  return "shadow";
}

/**
 * Transitional helper for migrating scorer decisions off the hard-coded
 * MARKET_MODEL_WATCH_ONLY / MARKET_DISABLED maps.
 *
 * If the registry has any rows for the requested market keys, those rows win
 * on a per-key basis and the legacy config only fills the gaps. If the
 * registry is still empty, the caller gets a full legacy-shaped surface map.
 */
export async function resolveSurfaceStatusesForMarketKeys(
  marketKeys: readonly string[],
): Promise<ResolvedMarketSurfaceStatuses> {
  if (marketKeys.length === 0) {
    return { source: "config_fallback", byMarketKey: {} };
  }

  const rows = await db
    .select({
      league: marketRegistryTable.league,
      market: marketRegistryTable.market,
      surfaceStatus: marketRegistryTable.surfaceStatus,
    })
    .from(marketRegistryTable);

  const byMarketKey: Record<string, ResolvedSurfaceStatus> = {};
  for (const key of marketKeys) {
    byMarketKey[key] = legacySurfaceStatusForMarket(key) as ResolvedSurfaceStatus;
  }

  let registryHits = 0;
  for (const row of rows) {
    const key = `${row.league}_${row.market}`;
    if (!marketKeys.includes(key)) continue;
    byMarketKey[key] = row.surfaceStatus as ResolvedSurfaceStatus;
    registryHits++;
  }

  if (registryHits === 0) {
    return {
      source: "config_fallback",
      byMarketKey,
    };
  }

  return {
    source: "market_registry",
    byMarketKey,
  };
}

/**
 * Controlled bootstrap for the rebuild registry.
 *
 * Seeds all required rebuild league/market combinations from the current
 * legacy config maps. This does NOT change scoring by itself; it gives the
 * rebuild a concrete registry surface to read from while we incrementally
 * migrate behavior off hard-coded maps.
 */
export async function syncMarketRegistryFromLegacyConfig(): Promise<MarketRegistrySyncResult> {
  const rows = REQUIRED_REBUILD_LEAGUES.flatMap((league) =>
    REQUIRED_REBUILD_MARKETS.map((market) => {
      const key = `${league}_${market}`;
      return {
        league,
        market,
        modelVersion: MODEL_VERSION,
        calibrationVersion: CALIBRATION_VERSION,
        surfaceStatus: legacySurfaceStatusForMarket(key),
        closeCaptureRequiredCoverage: "0.8",
        observedCloseCoverage30d: "0",
        eligible: false,
        notes: "Seeded from legacy config during rebuild bootstrap.",
      };
    }),
  );

  const upserted = await db
    .insert(marketRegistryTable)
    .values(rows)
    .onConflictDoUpdate({
      target: [marketRegistryTable.league, marketRegistryTable.market],
      set: {
        modelVersion: sql`EXCLUDED.model_version`,
        calibrationVersion: sql`EXCLUDED.calibration_version`,
        surfaceStatus: sql`EXCLUDED.surface_status`,
        closeCaptureRequiredCoverage: sql`EXCLUDED.close_capture_required_coverage`,
        notes: sql`EXCLUDED.notes`,
        updatedAt: new Date(),
      },
    });

  void upserted;

  const bySurfaceStatus = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.surfaceStatus] = (acc[row.surfaceStatus] ?? 0) + 1;
    return acc;
  }, {});

  return {
    rows: rows.length,
    bySurfaceStatus,
  };
}
