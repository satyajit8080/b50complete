import cron from "node-cron";
import { historicalSyncQueue, instrumentSyncQueue } from "../workers/queues.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { withLock } from "../lib/distributedLock.js";
import { DhanExchangeSegment, DhanInstrumentType } from "../services/dhan/constants.js";
import { recomputeTopLists } from "../services/market/topLists.js";
import { computeMarketBreadth } from "../services/market/breadth.js";
import { computeSectorStrength } from "../services/market/sectors.js";

/**
 * All cron expressions below are in server-local time. The VPS system
 * timezone must be set to Asia/Kolkata (IST) for these to align with NSE
 * market hours — verify with `timedatectl` on the VPS before relying on
 * this in production.
 *
 * Every job body is wrapped in withLock() so a slow-running job never
 * overlaps with its own next scheduled tick, and so this remains safe if
 * the worker process is ever horizontally scaled.
 */

const NSE_WEEKDAYS = "1-5";

/** 09:00 IST — before market open. Refresh instrument master so the day's
 * trading uses current lot sizes, new listings, and expired contract removal. */
function schedulePreMarketInstrumentSync() {
  cron.schedule(`0 9 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:premarket:instrument-sync", 600, async () => {
      logger.info("Pre-market: enqueuing instrument sync");
      await instrumentSyncQueue.add("pre-market-sync", {}, { jobId: `instrument-sync-${todayKey()}` });
    })
  );
}

/** Every 3 minutes, 09:15–15:30 IST weekdays — NSE's live trading window.
 * Recomputes top lists and market breadth from live quotes. */
function scheduleLiveMarketJobs() {
  cron.schedule(`*/3 9-15 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:live:toplists", 170, async () => {
      const counts = await recomputeTopLists();
      logger.info({ counts }, "Live top lists recomputed");
    })
  );

  cron.schedule(`*/5 9-15 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:live:breadth", 290, async () => {
      const snapshot = await computeMarketBreadth();
      logger.info({ snapshot }, "Live market breadth recomputed");
    })
  );

  cron.schedule(`*/5 9-15 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:live:sectors", 290, async () => {
      const sectors = await computeSectorStrength();
      logger.info({ sectorCount: sectors.length }, "Live sector strength recomputed");
    })
  );
}

/** 15:45 IST weekdays — after market close. Syncs today's daily candle for
 * every active equity instrument. */
function schedulePostMarketCandleSync() {
  cron.schedule(`45 15 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:postmarket:candle-sync", 1800, async () => {
      logger.info("Post-market: starting daily candle sync");

      const instruments = await prisma.instrument.findMany({
        where: { exchangeSegment: DhanExchangeSegment.NSE_EQ, isActive: true },
        select: { securityId: true },
      });

      const today = todayKey();

      for (const { securityId } of instruments) {
        await historicalSyncQueue.add(
          "sync-daily",
          {
            securityId,
            exchangeSegment: DhanExchangeSegment.NSE_EQ,
            instrument: DhanInstrumentType.EQUITY,
            fromDate: today,
            toDate: today,
          },
          { jobId: `daily-${securityId}-${today}` }
        );
      }

      logger.info({ count: instruments.length }, "Daily candle sync jobs enqueued");
    })
  );
}

/** 18:00 IST weekdays — well after close, once exchange bulk/block deal and
 * corporate action announcements for the day have typically been published. */
function schedulePostMarketCorporateActionsSync() {
  cron.schedule(`0 18 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:postmarket:corp-actions", 600, async () => {
      logger.info(
        "Post-market: corporate actions sync triggered (FinEdge endpoint paths pending — see Phase 3 known gaps)"
      );
      // Intentionally not enqueuing yet: corporateActionsSyncQueue worker
      // depends on FinEdge endpoint paths, which are not yet confirmed.
      // The queue and cron wiring are in place so this activates with no
      // further scheduling changes once the FinEdge client is completed.
    })
  );
}

/** 02:00 IST Sunday — weekly maintenance window when there's no risk of
 * colliding with live trading or post-market jobs. */
function scheduleWeeklyMaintenance() {
  cron.schedule("0 2 * * 0", () =>
    withLock("lock:weekly:maintenance", 1800, async () => {
      logger.info("Weekly maintenance: full instrument re-sync");
      await instrumentSyncQueue.add("weekly-full-sync", {}, { jobId: `instrument-sync-weekly-${todayKey()}` });
    })
  );
}

/** 03:00 IST on the 1st of each month — monthly housekeeping (e.g. purging
 * old ApiHealthLog rows). Placeholder body — wire in cleanup logic as
 * retention policy is defined. */
function scheduleMonthlyMaintenance() {
  cron.schedule("0 3 1 * *", () =>
    withLock("lock:monthly:maintenance", 1800, async () => {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const deleted = await prisma.apiHealthLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      logger.info({ deletedCount: deleted.count }, "Monthly maintenance: purged old API health logs");
    })
  );
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function startScheduler() {
  schedulePreMarketInstrumentSync();
  scheduleLiveMarketJobs();
  schedulePostMarketCandleSync();
  schedulePostMarketCorporateActionsSync();
  scheduleWeeklyMaintenance();
  scheduleMonthlyMaintenance();
  logger.info("Cron scheduler started — pre-market, live, post-market, weekly, and monthly jobs registered");
}
