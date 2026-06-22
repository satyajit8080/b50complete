import cron from "node-cron";
import { historicalSyncQueue, instrumentSyncQueue, optionChainSyncQueue } from "../workers/queues.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { withLock } from "../lib/distributedLock.js";
import { DhanExchangeSegment, DhanInstrumentType } from "../services/dhan/constants.js";
import { recomputeTopLists } from "../services/market/topLists.js";
import { computeMarketBreadth } from "../services/market/breadth.js";
import { computeSectorStrength } from "../services/market/sectors.js";
import { ingestOptionChains, ingestIndexSnapshots } from "../services/market/optionChainIngestion.js";

const NSE_WEEKDAYS = "1-5";

/**
 * Guard: returns true only between 09:15 and 15:30 IST on weekdays.
 * VPS timezone MUST be Asia/Kolkata for this to be correct.
 */
function isMarketOpen(): boolean {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  return (h > 9 || (h === 9 && m >= 15)) && (h < 15 || (h === 15 && m <= 30));
}

function schedulePreMarketInstrumentSync() {
  cron.schedule(`0 9 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:premarket:instrument-sync", 600, async () => {
      logger.info("Pre-market: enqueuing instrument sync");
      await instrumentSyncQueue.add("pre-market-sync", {}, { jobId: `instrument-sync-${todayKey()}` });
    })
  );
}

function scheduleLiveMarketJobs() {
  // Top lists — every 3 min during market hours
  cron.schedule(`*/3 9-15 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:live:toplists", 170, async () => {
      if (!isMarketOpen()) return;
      const counts = await recomputeTopLists();
      logger.info({ counts }, "Live top lists recomputed");
    })
  );

  // Market breadth + sectors — every 5 min
  cron.schedule(`*/5 9-15 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:live:breadth", 290, async () => {
      if (!isMarketOpen()) return;
      const snapshot = await computeMarketBreadth();
      logger.info({ snapshot }, "Live market breadth recomputed");
    })
  );

  cron.schedule(`*/5 9-15 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:live:sectors", 290, async () => {
      if (!isMarketOpen()) return;
      const sectors = await computeSectorStrength();
      logger.info({ sectorCount: sectors.length }, "Live sector strength recomputed");
    })
  );

  // Option chains — every 3 min during market hours (Dhan rate-limits to 1/3s per chain)
  cron.schedule(`*/3 9-15 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:live:optionchain", 170, async () => {
      if (!isMarketOpen()) return;
      const results = await ingestOptionChains();
      logger.info({ count: results.length }, "Live option chains ingested");
    })
  );

  // Index snapshots — every 1 min during market hours
  cron.schedule(`* 9-15 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:live:indices", 55, async () => {
      if (!isMarketOpen()) return;
      await ingestIndexSnapshots();
    })
  );
}

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

function schedulePostMarketCorporateActionsSync() {
  cron.schedule(`0 18 * * ${NSE_WEEKDAYS}`, () =>
    withLock("lock:postmarket:corp-actions", 600, async () => {
      logger.info("Post-market: corporate actions sync (FinEdge endpoints pending)");
    })
  );
}

function scheduleWeeklyMaintenance() {
  cron.schedule("0 2 * * 0", () =>
    withLock("lock:weekly:maintenance", 1800, async () => {
      logger.info("Weekly maintenance: full instrument re-sync");
      await instrumentSyncQueue.add("weekly-full-sync", {}, { jobId: `instrument-sync-weekly-${todayKey()}` });
    })
  );
}

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
  logger.info("Cron scheduler started — option chain, indices, breadth, top lists, candle sync registered");
}
