import { prisma } from "../../lib/prisma.js";
import { dhanClient } from "../dhan/client.js";
import { DhanExchangeSegment } from "../dhan/constants.js";
import { logger } from "../../lib/logger.js";
import { cached, CACHE_TTL } from "../../lib/cache.js";

export interface BreadthSnapshot {
  advances: number;
  declines: number;
  unchanged: number;
  newHighs: number;
  newLows: number;
  totalVolume: string; // bigint serialized as string for JSON safety
  timestamp: string;
}

/**
 * Computes market breadth across all active NSE_EQ instruments. Batches
 * Dhan OHLC calls in groups of 1000 (Dhan's per-request instrument limit)
 * rather than one call per stock, which would both be slow and blow the
 * 1 req/sec rate limit almost immediately for a market with 1900+ listed
 * equities.
 */
export async function computeMarketBreadth(): Promise<BreadthSnapshot> {
  const instruments = await prisma.instrument.findMany({
    where: { exchangeSegment: DhanExchangeSegment.NSE_EQ, isActive: true },
    select: { securityId: true },
  });

  if (instruments.length === 0) {
    logger.warn("No NSE_EQ instruments in database — breadth calculation skipped. Run instrument sync first.");
    return emptySnapshot();
  }

  const BATCH_SIZE = 1000;
  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  let totalVolume = 0n;

  for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
    const batch = instruments.slice(i, i + BATCH_SIZE).map((x) => Number(x.securityId));
    const response = await dhanClient.getOhlc({ [DhanExchangeSegment.NSE_EQ]: batch });
    const data = response.data[DhanExchangeSegment.NSE_EQ] ?? {};

    for (const tick of Object.values(data)) {
      const change = tick.last_price - tick.ohlc.close;
      if (change > 0) advances++;
      else if (change < 0) declines++;
      else unchanged++;
    }
  }

  // 52-week high/low counts come from persisted history, not a live call —
  // computing this from Dhan directly would mean a historical call per stock.
  const { newHighs, newLows } = await count52WeekExtremes(instruments.map((i) => i.securityId));

  const snapshot: BreadthSnapshot = {
    advances,
    declines,
    unchanged,
    newHighs,
    newLows,
    totalVolume: totalVolume.toString(),
    timestamp: new Date().toISOString(),
  };

  await prisma.marketBreadthSnapshot.upsert({
    where: {
      exchangeSegment_timestamp: {
        exchangeSegment: DhanExchangeSegment.NSE_EQ,
        timestamp: roundToMinute(new Date()),
      },
    },
    create: {
      exchangeSegment: DhanExchangeSegment.NSE_EQ,
      timestamp: roundToMinute(new Date()),
      advances,
      declines,
      unchanged,
      newHighs,
      newLows,
      totalVolume,
    },
    update: { advances, declines, unchanged, newHighs, newLows, totalVolume },
  });

  return snapshot;
}

async function count52WeekExtremes(securityIds: string[]): Promise<{ newHighs: number; newLows: number }> {
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  // For each instrument, compare today's close against the max/min close
  // over the trailing year. Done as one grouped query rather than N queries.
  const extremes = await prisma.historicalCandle.groupBy({
    by: ["securityId"],
    where: {
      securityId: { in: securityIds },
      interval: "DAILY",
      timestamp: { gte: oneYearAgo },
    },
    _max: { high: true },
    _min: { low: true },
  });

  const latestCandles = await prisma.historicalCandle.findMany({
    where: { securityId: { in: securityIds }, interval: "DAILY" },
    orderBy: { timestamp: "desc" },
    distinct: ["securityId"],
    take: securityIds.length,
  });

  const extremesBySecu = new Map(extremes.map((e) => [e.securityId, e]));
  let newHighs = 0;
  let newLows = 0;

  for (const candle of latestCandles) {
    const range = extremesBySecu.get(candle.securityId);
    if (!range) continue;
    if (range._max.high !== null && candle.close >= range._max.high) newHighs++;
    if (range._min.low !== null && candle.close <= range._min.low) newLows++;
  }

  return { newHighs, newLows };
}

function roundToMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

function emptySnapshot(): BreadthSnapshot {
  return { advances: 0, declines: 0, unchanged: 0, newHighs: 0, newLows: 0, totalVolume: "0", timestamp: new Date().toISOString() };
}

export async function getLatestBreadth(): Promise<BreadthSnapshot | null> {
  return cached("market:breadth:latest", { ttlSeconds: CACHE_TTL.MARKET_BREADTH }, async () => {
    const snapshot = await prisma.marketBreadthSnapshot.findFirst({
      where: { exchangeSegment: DhanExchangeSegment.NSE_EQ },
      orderBy: { timestamp: "desc" },
    });
    if (!snapshot) return null;
    return {
      advances: snapshot.advances,
      declines: snapshot.declines,
      unchanged: snapshot.unchanged,
      newHighs: snapshot.newHighs,
      newLows: snapshot.newLows,
      totalVolume: snapshot.totalVolume.toString(),
      timestamp: snapshot.timestamp.toISOString(),
    };
  });
}
