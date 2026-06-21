import { prisma } from "../../lib/prisma.js";
import { dhanClient } from "../dhan/client.js";
import { DhanExchangeSegment } from "../dhan/constants.js";
import { logger } from "../../lib/logger.js";
import { cached } from "../../lib/cache.js";
import type { TopListCategory } from "@bull50/db";

interface RankedStock {
  securityId: string;
  symbol: string;
  value: number;
  lastPrice: number;
}

const TOP_N = 50; // matches typical "Top 50" UI lists across the screener pages

/**
 * Recomputes every top-list category from a single batched market data
 * pull, then overwrites the TopListEntry table. Designed to run on the
 * scheduler's "live" cadence (every few minutes during market hours) —
 * NOT per-request, since iterating ~1900 NSE equities per request would be
 * far too slow and would burn through Dhan's rate limit immediately.
 */
export async function recomputeTopLists(): Promise<Record<string, number>> {
  const instruments = await prisma.instrument.findMany({
    where: { exchangeSegment: DhanExchangeSegment.NSE_EQ, isActive: true },
    select: { securityId: true, symbol: true },
  });

  if (instruments.length === 0) {
    logger.warn("No instruments found — skipping top list computation. Run instrument sync first.");
    return {};
  }

  const symbolMap = new Map(instruments.map((i) => [i.securityId, i.symbol]));
  const BATCH_SIZE = 1000;

  const quotes: Array<{ securityId: string; lastPrice: number; prevClose: number; open: number; volume: number }> = [];

  for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
    const batchIds = instruments.slice(i, i + BATCH_SIZE).map((x) => Number(x.securityId));
    const response = await dhanClient.getQuote({ [DhanExchangeSegment.NSE_EQ]: batchIds });
    const data = response.data[DhanExchangeSegment.NSE_EQ] ?? {};

    for (const [securityId, tick] of Object.entries(data)) {
      quotes.push({
        securityId,
        lastPrice: tick.last_price,
        prevClose: tick.ohlc.close,
        open: tick.ohlc.open,
        volume: tick.volume,
      });
    }
  }

  const gainers = rank(quotes, (q) => pctChange(q.lastPrice, q.prevClose), symbolMap, "desc");
  const losers = rank(quotes, (q) => pctChange(q.lastPrice, q.prevClose), symbolMap, "asc");
  const mostActive = rank(quotes, (q) => q.volume, symbolMap, "desc");
  const gapUp = rank(
    quotes.filter((q) => q.open > q.prevClose),
    (q) => pctChange(q.open, q.prevClose),
    symbolMap,
    "desc"
  );
  const gapDown = rank(
    quotes.filter((q) => q.open < q.prevClose),
    (q) => pctChange(q.open, q.prevClose),
    symbolMap,
    "asc"
  );
  const upperCircuit = rank(
    quotes.filter((q) => pctChange(q.lastPrice, q.prevClose) >= 19.5),
    (q) => pctChange(q.lastPrice, q.prevClose),
    symbolMap,
    "desc"
  );
  const lowerCircuit = rank(
    quotes.filter((q) => pctChange(q.lastPrice, q.prevClose) <= -19.5),
    (q) => pctChange(q.lastPrice, q.prevClose),
    symbolMap,
    "asc"
  );

  const { week52High, week52Low } = await compute52WeekLists(quotes, symbolMap);

  const categories: Record<string, RankedStock[]> = {
    TOP_GAINERS: gainers,
    TOP_LOSERS: losers,
    MOST_ACTIVE: mostActive,
    GAP_UP: gapUp,
    GAP_DOWN: gapDown,
    UPPER_CIRCUIT: upperCircuit,
    LOWER_CIRCUIT: lowerCircuit,
    WEEK_52_HIGH: week52High,
    WEEK_52_LOW: week52Low,
  };

  const counts: Record<string, number> = {};

  for (const [category, list] of Object.entries(categories)) {
    await persistTopList(category as TopListCategory, list);
    counts[category] = list.length;
  }

  return counts;
}

function pctChange(current: number, base: number): number {
  return base !== 0 ? ((current - base) / base) * 100 : 0;
}

function rank<T extends { securityId: string; lastPrice: number }>(
  quotes: T[],
  valueFn: (q: T) => number,
  symbolMap: Map<string, string>,
  direction: "asc" | "desc"
): RankedStock[] {
  return quotes
    .map((q) => ({
      securityId: q.securityId,
      symbol: symbolMap.get(q.securityId) ?? q.securityId,
      value: valueFn(q),
      lastPrice: q.lastPrice,
    }))
    .sort((a, b) => (direction === "desc" ? b.value - a.value : a.value - b.value))
    .slice(0, TOP_N);
}

async function compute52WeekLists(
  quotes: Array<{ securityId: string; lastPrice: number }>,
  symbolMap: Map<string, string>
): Promise<{ week52High: RankedStock[]; week52Low: RankedStock[] }> {
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const securityIds = quotes.map((q) => q.securityId);

  const ranges = await prisma.historicalCandle.groupBy({
    by: ["securityId"],
    where: { securityId: { in: securityIds }, interval: "DAILY", timestamp: { gte: oneYearAgo } },
    _max: { high: true },
    _min: { low: true },
  });
  const rangeMap = new Map(ranges.map((r) => [r.securityId, r]));

  const week52High: RankedStock[] = [];
  const week52Low: RankedStock[] = [];

  for (const q of quotes) {
    const range = rangeMap.get(q.securityId);
    if (!range) continue;
    const symbol = symbolMap.get(q.securityId) ?? q.securityId;
    if (range._max.high !== null && q.lastPrice >= range._max.high) {
      week52High.push({ securityId: q.securityId, symbol, value: q.lastPrice, lastPrice: q.lastPrice });
    }
    if (range._min.low !== null && q.lastPrice <= range._min.low) {
      week52Low.push({ securityId: q.securityId, symbol, value: q.lastPrice, lastPrice: q.lastPrice });
    }
  }

  return {
    week52High: week52High.sort((a, b) => b.value - a.value).slice(0, TOP_N),
    week52Low: week52Low.sort((a, b) => a.value - b.value).slice(0, TOP_N),
  };
}

async function persistTopList(category: TopListCategory, list: RankedStock[]) {
  // Delete stale entries for this category, then bulk-insert the fresh
  // ranking. Simpler and faster than per-row upsert + separate "remove
  // entries that fell off the list" pass.
  await prisma.$transaction([
    prisma.topListEntry.deleteMany({ where: { category } }),
    ...(list.length
      ? [
          prisma.topListEntry.createMany({
            data: list.map((item, idx) => ({
              category,
              securityId: item.securityId,
              symbol: item.symbol,
              rank: idx + 1,
              value: item.value,
              lastPrice: item.lastPrice,
            })),
          }),
        ]
      : []),
  ]);
}

export async function getTopList(category: TopListCategory, limit = 20) {
  return cached(`toplist:${category}:${limit}`, { ttlSeconds: 60 }, () =>
    prisma.topListEntry.findMany({
      where: { category },
      orderBy: { rank: "asc" },
      take: limit,
    })
  );
}
