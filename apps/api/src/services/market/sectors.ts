import { prisma } from "../../lib/prisma.js";
import { dhanClient } from "../dhan/client.js";
import { DhanExchangeSegment } from "../dhan/constants.js";
import { logger } from "../../lib/logger.js";
import { cached } from "../../lib/cache.js";

export interface SectorStrength {
  sectoralIndex: string;
  changePercent: number;
  rank: number;
}

export interface SectorRotation {
  sectoralIndex: string;
  /** Change in rank vs. the comparison snapshot — positive means the
   * sector has moved UP in relative strength (rotation into it). */
  rankChange: number;
  currentChangePercent: number;
  previousChangePercent: number;
}

/**
 * Pulls live OHLC for every sectoral index that has at least one mapped
 * constituent (see SectorMapping), ranks them by today's % change, and
 * persists a snapshot for later rotation comparison.
 *
 * Returns an empty array (not an error) if SectorMapping is unpopulated —
 * this is an expected, documented state until sector mapping is seeded.
 */
export async function computeSectorStrength(): Promise<SectorStrength[]> {
  const mappings = await prisma.sectorMapping.findMany({
    where: { sectoralIndexSecurityId: { not: null } },
    select: { sectoralIndex: true, sectoralIndexSecurityId: true },
    distinct: ["sectoralIndex"],
  });

  if (mappings.length === 0) {
    logger.warn("No SectorMapping rows with an index securityId — sector strength skipped. Seed SectorMapping first.");
    return [];
  }

  const indexIds = mappings.map((m) => Number(m.sectoralIndexSecurityId));
  const response = await dhanClient.getOhlc({ [DhanExchangeSegment.IDX_I]: indexIds });
  const data = response.data[DhanExchangeSegment.IDX_I] ?? {};

  const results: SectorStrength[] = [];
  const now = roundToMinute(new Date());

  for (const mapping of mappings) {
    const tick = data[mapping.sectoralIndexSecurityId!];
    if (!tick) continue;

    const changePercent = tick.ohlc.close !== 0 ? ((tick.last_price - tick.ohlc.close) / tick.ohlc.close) * 100 : 0;

    results.push({ sectoralIndex: mapping.sectoralIndex, changePercent: Number(changePercent.toFixed(2)), rank: 0 });

    await prisma.sectorPerformanceSnapshot.upsert({
      where: { sectoralIndex_timestamp: { sectoralIndex: mapping.sectoralIndex, timestamp: now } },
      create: { sectoralIndex: mapping.sectoralIndex, timestamp: now, lastPrice: tick.last_price, changePercent },
      update: { lastPrice: tick.last_price, changePercent },
    });
  }

  results.sort((a, b) => b.changePercent - a.changePercent);
  results.forEach((r, idx) => (r.rank = idx + 1));

  return results;
}

/**
 * Compares current sector ranking against a snapshot from `hoursAgo` to
 * surface rotation — which sectors are gaining or losing relative
 * strength, not just which are up or down in absolute terms.
 */
export async function computeSectorRotation(hoursAgo = 24): Promise<SectorRotation[]> {
  const current = await computeSectorStrength();
  if (current.length === 0) return [];

  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

  const previousSnapshots = await Promise.all(
    current.map((c) =>
      prisma.sectorPerformanceSnapshot.findFirst({
        where: { sectoralIndex: c.sectoralIndex, timestamp: { lte: cutoff } },
        orderBy: { timestamp: "desc" },
      })
    )
  );

  const previousRanked = previousSnapshots
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.changePercent - a.changePercent)
    .map((s, idx) => ({ ...s, rank: idx + 1 }));
  const previousRankMap = new Map(previousRanked.map((s) => [s.sectoralIndex, s]));

  return current
    .map((c) => {
      const prev = previousRankMap.get(c.sectoralIndex);
      if (!prev) return null;
      return {
        sectoralIndex: c.sectoralIndex,
        rankChange: prev.rank - c.rank,
        currentChangePercent: c.changePercent,
        previousChangePercent: prev.changePercent,
      };
    })
    .filter((r): r is SectorRotation => r !== null)
    .sort((a, b) => b.rankChange - a.rankChange);
}

export async function getLatestSectorStrength(): Promise<SectorStrength[]> {
  return cached("market:sector:strength", { ttlSeconds: 60 }, () => computeSectorStrength());
}

function roundToMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}
