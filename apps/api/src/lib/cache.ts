import { redis } from "./redis.js";
import { logger } from "./logger.js";

interface CacheOptions {
  ttlSeconds: number;
}

/**
 * Cache-aside helper: try Redis first, fall back to the fetcher function,
 * then populate the cache. Used for every external API call so repeated
 * requests for the same data (e.g. LTP for a popular stock) don't hit
 * DhanHQ/FinEdge rate limits.
 */
export async function cached<T>(key: string, options: CacheOptions, fetcher: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) {
      return JSON.parse(hit) as T;
    }
  } catch (err) {
    // Redis being down should never break the app — just skip the cache.
    logger.warn({ err, key }, "Cache read failed, falling through to fetcher");
  }

  const fresh = await fetcher();

  try {
    await redis.set(key, JSON.stringify(fresh), "EX", options.ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, "Cache write failed");
  }

  return fresh;
}

export async function invalidateCache(keyOrPrefix: string, isPrefix = false): Promise<void> {
  if (!isPrefix) {
    await redis.del(keyOrPrefix);
    return;
  }
  const stream = redis.scanStream({ match: `${keyOrPrefix}*`, count: 100 });
  const keys: string[] = [];
  for await (const batch of stream) {
    keys.push(...(batch as string[]));
  }
  if (keys.length) await redis.del(...keys);
}

/** Standard TTLs by data volatility, in seconds */
export const CACHE_TTL = {
  LTP: 3, // changes every tick
  QUOTE: 5,
  OPTION_CHAIN: 5, // Dhan itself rate-limits this to 1 req/3s
  HISTORICAL_DAILY: 3600, // closes don't change once the day is done
  HISTORICAL_INTRADAY: 60,
  FUNDAMENTALS: 86400, // financial statements change quarterly at most
  CORPORATE_ACTIONS: 3600,
  MARKET_BREADTH: 15,
} as const;
