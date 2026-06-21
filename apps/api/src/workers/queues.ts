import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

// BullMQ needs a raw ioredis-compatible connection config, not a client
// instance with our app-level retry wrapping — keep this separate from lib/redis.ts.
export const queueConnection: ConnectionOptions = {
  host: new URL(env.REDIS_URL).hostname,
  port: Number(new URL(env.REDIS_URL).port || 6379),
  maxRetriesPerRequest: null, // required by BullMQ workers
};

export const QUEUE_NAMES = {
  HISTORICAL_SYNC: "historical-sync",
  INSTRUMENT_SYNC: "instrument-sync",
  CORPORATE_ACTIONS_SYNC: "corporate-actions-sync",
} as const;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

export const historicalSyncQueue = new Queue(QUEUE_NAMES.HISTORICAL_SYNC, {
  connection: queueConnection,
  defaultJobOptions,
});

export const instrumentSyncQueue = new Queue(QUEUE_NAMES.INSTRUMENT_SYNC, {
  connection: queueConnection,
  defaultJobOptions,
});

export const corporateActionsSyncQueue = new Queue(QUEUE_NAMES.CORPORATE_ACTIONS_SYNC, {
  connection: queueConnection,
  defaultJobOptions,
});
