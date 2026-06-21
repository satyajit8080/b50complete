import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { startHistoricalSyncWorker } from "./workers/historicalSyncWorker.js";
import { startInstrumentSyncWorker } from "./workers/instrumentSyncWorker.js";
import { startScheduler } from "./jobs/scheduler.js";

/**
 * Runs as a separate PM2 process from the API server (see PM2 ecosystem
 * config). Keeping workers out of the request-handling process means a
 * slow sync job never blocks an HTTP response, and either process can be
 * restarted independently.
 */
async function main() {
  logger.info("Starting Bull50 worker process");

  const historicalWorker = startHistoricalSyncWorker();
  const instrumentWorker = startInstrumentSyncWorker();
  startScheduler();

  async function shutdown(signal: string) {
    logger.info(`${signal} received, shutting down worker process`);
    await historicalWorker.close();
    await instrumentWorker.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Worker process failed to start");
  process.exit(1);
});
