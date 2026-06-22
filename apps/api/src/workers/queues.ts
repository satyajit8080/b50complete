import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

export const queueConnection: ConnectionOptions = {
  host: new URL(env.REDIS_URL).hostname,
  port: Number(new URL(env.REDIS_URL).port || 6379),
  maxRetriesPerRequest: null,
};

export const QUEUE_NAMES = {
  HISTORICAL_SYNC:       "historical-sync",
  INSTRUMENT_SYNC:       "instrument-sync",
  CORPORATE_ACTIONS_SYNC:"corporate-actions-sync",
  OPTION_CHAIN_SYNC:     "option-chain-sync",      // NEW
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

export const optionChainSyncQueue = new Queue(QUEUE_NAMES.OPTION_CHAIN_SYNC, {
  connection: queueConnection,
  defaultJobOptions,
});
