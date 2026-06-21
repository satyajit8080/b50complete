import { Worker, type Job } from "bullmq";
import { queueConnection, QUEUE_NAMES } from "./queues.js";
import { dhanClient } from "../services/dhan/client.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import type { DhanExchangeSegment, DhanInstrumentType } from "../services/dhan/constants.js";

export interface HistoricalSyncJobData {
  securityId: string;
  exchangeSegment: DhanExchangeSegment;
  instrument: DhanInstrumentType;
  fromDate: string;
  toDate: string;
}

function intervalCodeToEnum(): "DAILY" {
  return "DAILY";
}

async function processHistoricalSync(job: Job<HistoricalSyncJobData>) {
  const { securityId, exchangeSegment, instrument, fromDate, toDate } = job.data;

  const candles = await dhanClient.getHistoricalDaily({
    securityId,
    exchangeSegment,
    instrument,
    fromDate,
    toDate,
    oi: false,
  });

  if (!candles.timestamp?.length) {
    logger.warn({ securityId, fromDate, toDate }, "Historical sync returned no candles");
    return { synced: 0 };
  }

  const rows = candles.timestamp.map((ts, i) => ({
    securityId,
    exchangeSegment,
    interval: intervalCodeToEnum(),
    timestamp: new Date(ts * 1000),
    open: candles.open[i],
    high: candles.high[i],
    low: candles.low[i],
    close: candles.close[i],
    volume: BigInt(candles.volume[i] ?? 0),
    openInterest: candles.oi?.[i] ?? null,
  }));

  // Upsert in a transaction batch to avoid duplicate-key races with overlapping syncs
  await prisma.$transaction(
    rows.map((row) =>
      prisma.historicalCandle.upsert({
        where: {
          securityId_exchangeSegment_interval_timestamp: {
            securityId: row.securityId,
            exchangeSegment: row.exchangeSegment,
            interval: row.interval,
            timestamp: row.timestamp,
          },
        },
        create: row,
        update: { open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume, openInterest: row.openInterest },
      })
    )
  );

  logger.info({ securityId, count: rows.length }, "Historical candles synced");
  return { synced: rows.length };
}

export function startHistoricalSyncWorker() {
  const worker = new Worker<HistoricalSyncJobData>(QUEUE_NAMES.HISTORICAL_SYNC, processHistoricalSync, {
    connection: queueConnection,
    concurrency: 2, // stay well under Dhan's historical data rate limits
  });

  worker.on("completed", (job, result) => {
    logger.info({ jobId: job.id, result }, "Historical sync job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "Historical sync job failed");
  });

  return worker;
}
