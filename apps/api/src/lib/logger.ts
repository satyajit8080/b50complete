import pino from "pino";
import { isProd, env } from "../config/env.js";

// pino-pretty's worker-thread transport doesn't resolve reliably when
// loaded through a test runner's module system (Vitest/Jest both can hit
// this) — fall back to plain JSON logging in test, since output
// readability doesn't matter there anyway.
const isTest = env.NODE_ENV === "test";

export const logger = pino({
  level: isTest ? "silent" : isProd ? "info" : "debug",
  transport:
    isProd || isTest
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
});
