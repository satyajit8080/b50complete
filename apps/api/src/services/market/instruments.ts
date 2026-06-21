import { prisma } from "../../lib/prisma.js";
import { cached } from "../../lib/cache.js";

/**
 * Every Dhan market data call requires a numeric securityId, not a human
 * symbol like "RELIANCE". This resolves symbols against the Instrument
 * table (populated by the instrument-sync job — see jobs/syncInstruments.ts).
 */
export async function resolveSecurityId(
  symbol: string,
  exchangeSegment: string
): Promise<{ securityId: string; lotSize: number | null; tickSize: number | null } | null> {
  const key = `instrument:${exchangeSegment}:${symbol.toUpperCase()}`;
  return cached(key, { ttlSeconds: 3600 }, async () => {
    const instrument = await prisma.instrument.findFirst({
      where: { symbol: symbol.toUpperCase(), exchangeSegment, isActive: true },
      select: { securityId: true, lotSize: true, tickSize: true },
    });
    return instrument;
  });
}

export async function searchInstruments(query: string, limit = 10) {
  return prisma.instrument.findMany({
    where: { symbol: { contains: query.toUpperCase() }, isActive: true },
    take: limit,
    orderBy: { symbol: "asc" },
  });
}
