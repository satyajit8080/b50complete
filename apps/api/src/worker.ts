import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { startHistoricalSyncWorker } from "./workers/historicalSyncWorker.js";
import { startInstrumentSyncWorker } from "./workers/instrumentSyncWorker.js";
import { startOptionChainWorker } from "./workers/optionChainWorker.js";
import { startScheduler } from "./jobs/scheduler.js";

async function main() {
  logger.info("Starting Bull50 worker process");

  const historicalWorker  = startHistoricalSyncWorker();
  const instrumentWorker  = startInstrumentSyncWorker();
  const optionChainWorker = startOptionChainWorker();
  startScheduler();

  async function shutdown(signal: string) {
    logger.info(`${signal} received, shutting down worker process`);
    await Promise.allSettled([
      historicalWorker.close(),
      instrumentWorker.close(),
      optionChainWorker.close(),
    ]);
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Worker process failed to start");
  process.exit(1);
});
