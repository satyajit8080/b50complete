import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { prisma } from "./lib/prisma.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { authRouter } from "./routes/auth.js";
import { marketRouter } from "./routes/market.js";
import { monitoringRouter } from "./routes/monitoring.js";
import { ExternalApiError, CircuitOpenError } from "./lib/errors.js";

// openapi.json is only ever written to src/openapi/ by the generator
// script (never copied into dist/ by the build), so resolve it from the
// project root via cwd rather than from this file's own location — works
// identically whether running via tsx (src/server.ts) or compiled
// (dist/server.js), since cwd is the apps/api package root either way per
// the npm scripts and PM2 config in SETUP.md.
const projectRoot = process.cwd();
const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redisOk = redis.status === "ready";
    res.json({ status: "ok", db: "ok", redis: redisOk ? "ok" : redis.status, uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: "degraded", error: (err as Error).message });
  }
});

// API docs — generated from openapi/generate.ts (run `npm run openapi:generate`).
// Loaded lazily/defensively so a missing spec file doesn't crash server boot.
const openapiSpecPath = path.resolve(projectRoot, "src", "openapi", "openapi.json");
if (existsSync(openapiSpecPath)) {
  const openapiDocument = JSON.parse(readFileSync(openapiSpecPath, "utf-8"));
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));
  app.get("/api-docs.json", (_req, res) => res.json(openapiDocument));
} else {
  logger.warn(
    `OpenAPI spec not found at ${openapiSpecPath} — /api-docs is unavailable. Run "npm run openapi:generate" to create it.`
  );
}

app.use("/api", apiLimiter);
app.use("/api/auth", authRouter);
app.use("/api/market", marketRouter);
app.use("/api/monitoring", monitoringRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof CircuitOpenError) {
    logger.warn({ source: err.source, path: req.path }, "Request rejected — circuit breaker open");
    return res.status(503).json({ error: `${err.source} is temporarily unavailable, please try again shortly` });
  }

  if (err instanceof ExternalApiError) {
    logger.error({ source: err.source, statusCode: err.statusCode, path: req.path }, err.message);
    const status = err.retryable ? 502 : err.statusCode && err.statusCode < 500 ? err.statusCode : 502;
    return res.status(status).json({ error: `Upstream ${err.source} error: ${err.message}` });
  }

  logger.error({ err, path: req.path }, "Unhandled error");
  res.status(500).json({ error: env.NODE_ENV === "production" ? "Internal server error" : err.message });
});

const server = app.listen(env.PORT, () => {
  logger.info(`Bull50 API listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
