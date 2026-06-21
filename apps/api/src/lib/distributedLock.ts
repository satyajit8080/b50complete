import { redis } from "./redis.js";
import { logger } from "./logger.js";

/**
 * Acquires a short-lived Redis lock before running a scheduled job body.
 * Prevents two problems node-cron alone doesn't solve: (1) a job that runs
 * longer than its own interval firing again before the previous run
 * finished, and (2) if the worker process is ever scaled to >1 instance,
 * both instances firing the same cron tick simultaneously.
 */
export async function withLock(lockKey: string, ttlSeconds: number, fn: () => Promise<void>): Promise<void> {
  const acquired = await redis.set(lockKey, "1", "EX", ttlSeconds, "NX");
  if (!acquired) {
    logger.debug({ lockKey }, "Skipping job — already running (lock held)");
    return;
  }

  try {
    await fn();
  } finally {
    await redis.del(lockKey);
  }
}
