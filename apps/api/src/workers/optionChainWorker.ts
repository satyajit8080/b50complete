/**
 * BullMQ worker for on-demand option chain ingestion.
 * The scheduler also calls ingestOptionChains() directly for cron-based
 * ingestion — this worker handles manual triggers from the admin panel.
 */
import { Worker, type Job } from "bullmq";
import { queueConnection, QUEUE_NAMES } from "./queues.js";
import { ingestOptionChains, ingestIndexSnapshots } from "../services/market/optionChainIngestion.js";
import { logger } from "../lib/logger.js";

export interface OptionChainSyncJobData {
  trigger: "manual" | "cron";
}

async function processOptionChainSync(job: Job<OptionChainSyncJobData>) {
  logger.info({ trigger: job.data.trigger }, "Option chain sync job started");

  const [chainResults] = await Promise.allSettled([
    ingestOptionChains(),
    ingestIndexSnapshots(),
  ]);

  if (chainResults.status === "rejected") {
    throw chainResults.reason as Error;
  }

  return { ingested: chainResults.value.length, results: chainResults.value };
}

export function startOptionChainWorker() {
  const worker = new Worker<OptionChainSyncJobData>(
    QUEUE_NAMES.OPTION_CHAIN_SYNC,
    processOptionChainSync,
    { connection: queueConnection, concurrency: 1 }
  );

  worker.on("completed", (job, result) => {
    logger.info({ jobId: job.id, result }, "Option chain sync completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "Option chain sync failed");
  });

  return worker;
}
