import { Worker, type Job } from "bullmq";
import { queueConnection, QUEUE_NAMES } from "./queues.js";
import { syncInstrumentMaster } from "../services/market/instrumentSync.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

async function processInstrumentSync(job: Job) {
  const triggeredBy = job.name === "manual-sync" ? "ADMIN:unknown" : "CRON";

  try {
    const result = await syncInstrumentMaster();
    await prisma.instrumentSyncLog.create({
      data: {
        totalRows: result.totalRows,
        upserted: result.upserted,
        skipped: result.skipped,
        durationMs: result.durationMs,
        triggeredBy,
        success: true,
      },
    });
    return result;
  } catch (err) {
    await prisma.instrumentSyncLog.create({
      data: {
        totalRows: 0,
        upserted: 0,
        skipped: 0,
        durationMs: 0,
        triggeredBy,
        success: false,
        errorMessage: (err as Error).message,
      },
    });
    throw err;
  }
}

export function startInstrumentSyncWorker() {
  const worker = new Worker(QUEUE_NAMES.INSTRUMENT_SYNC, processInstrumentSync, {
    connection: queueConnection,
    concurrency: 1, // one sync at a time, it's a full-file operation
  });

  worker.on("completed", (job, result) => {
    logger.info({ jobId: job.id, result }, "Instrument sync job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "Instrument sync job failed");
  });

  return worker;
}
