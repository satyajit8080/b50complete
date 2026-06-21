import Redis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on("error", (err) => logger.error({ err }, "Redis connection error"));
redis.on("connect", () => logger.info("Redis connected"));
