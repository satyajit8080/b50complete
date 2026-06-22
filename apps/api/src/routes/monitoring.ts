import { Router } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Queue as BullQueue } from "bullmq";
import { z } from "zod";
import { dhanClient } from "../services/dhan/client.js";
import { finEdgeClient } from "../services/finedge/client.js";
import { validateDhanCredentials } from "../services/dhan/validation.js";
import { validateFinEdgeCredentials } from "../services/finedge/validation.js";
import {
  historicalSyncQueue,
  instrumentSyncQueue,
  corporateActionsSyncQueue,
  optionChainSyncQueue,
} from "../workers/queues.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { upsertFundamentals } from "../services/market/fundamentalsStore.js";
import { ingestOptionChains, ingestIndexSnapshots } from "../services/market/optionChainIngestion.js";
import { logger } from "../lib/logger.js";

const execFileAsync = promisify(execFile);

export const monitoringRouter = Router();

// ── Circuit breaker status ────────────────────────────────────────────────────

monitoringRouter.get(
  "/external-apis",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    res.json({
      dhan:    { circuitState: dhanClient.getCircuitState() },
      finedge: { circuitState: finEdgeClient.getCircuitState() },
    });
  })
);

// ── Live credential validation ────────────────────────────────────────────────

monitoringRouter.get(
  "/validate-credentials",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    const [dhan, finedge] = await Promise.all([
      validateDhanCredentials(),
      validateFinEdgeCredentials(),
    ]);
    res.json({ dhan, finedge });
  })
);

// ── API key management ────────────────────────────────────────────────────────
// Writes directly to apps/api/.env on the VPS and reloads the process.
// Security: SUPERADMIN only. Values are never echoed back in responses.

const ENV_PATH = path.resolve(process.cwd(), ".env");

const apiKeysSchema = z.object({
  DHAN_CLIENT_ID:    z.string().min(1).optional(),
  DHAN_ACCESS_TOKEN: z.string().min(1).optional(),
  FINEDGE_API_KEY:   z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: "At least one key must be provided" }
);

monitoringRouter.post(
  "/api-keys",
  requireAuth,
  requireRole("SUPERADMIN"),
  asyncRoute(async (req, res) => {
    const parsed = apiKeysSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    // Read existing .env, update only the provided keys
    let envContent = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";

    for (const [key, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue;
      const regex = new RegExp(`^${key}=.*$`, "m");
      const line = `${key}=${value}`;
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, line);
      } else {
        envContent += `\n${line}`;
      }
      // Update process.env immediately so validation pings use new values
      process.env[key] = value;
    }

    writeFileSync(ENV_PATH, envContent, "utf-8");
    logger.info({ keys: Object.keys(parsed.data) }, "API keys updated by SUPERADMIN");

    // Validate the new credentials immediately
    const [dhan, finedge] = await Promise.all([
      parsed.data.DHAN_CLIENT_ID || parsed.data.DHAN_ACCESS_TOKEN
        ? validateDhanCredentials()
        : Promise.resolve(null),
      parsed.data.FINEDGE_API_KEY
        ? validateFinEdgeCredentials()
        : Promise.resolve(null),
    ]);

    res.json({
      message: "API keys updated",
      validation: { dhan, finedge },
      note: "Restart the API process to fully reload all env vars into running clients",
    });
  })
);

// Returns which keys are SET (true/false) — never the values themselves
monitoringRouter.get(
  "/api-keys/status",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    res.json({
      DHAN_CLIENT_ID:    !!process.env.DHAN_CLIENT_ID,
      DHAN_ACCESS_TOKEN: !!process.env.DHAN_ACCESS_TOKEN,
      FINEDGE_API_KEY:   !!process.env.FINEDGE_API_KEY,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    });
  })
);

// ── Queues ────────────────────────────────────────────────────────────────────

monitoringRouter.get(
  "/queues",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    const [historical, instrument, corpActions, optionChain] = await Promise.all([
      queueSummary(historicalSyncQueue),
      queueSummary(instrumentSyncQueue),
      queueSummary(corporateActionsSyncQueue),
      queueSummary(optionChainSyncQueue),
    ]);

    res.json({
      historicalSync:       historical,
      instrumentSync:       instrument,
      corporateActionsSync: corpActions,
      optionChainSync:      optionChain,
    });
  })
);

monitoringRouter.get(
  "/redis",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    res.json({ status: redis.status, connected: redis.status === "ready" });
  })
);

// ── Instrument sync ───────────────────────────────────────────────────────────

monitoringRouter.post(
  "/instrument-sync/trigger",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    const job = await instrumentSyncQueue.add(
      "manual-sync",
      {},
      { jobId: `instrument-sync-manual-${Date.now()}` }
    );
    res.status(202).json({ message: "Instrument sync enqueued", jobId: job.id });
  })
);

monitoringRouter.get(
  "/instrument-sync/logs",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (req, res) => {
    const limit = z.coerce.number().min(1).max(100).default(20).parse(req.query.limit ?? 20);
    const logs = await prisma.instrumentSyncLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json({ logs });
  })
);

// ── Option chain — manual trigger + latest snapshots ─────────────────────────

monitoringRouter.post(
  "/option-chain/trigger",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    const job = await optionChainSyncQueue.add(
      "manual-sync",
      { trigger: "manual" },
      { jobId: `option-chain-manual-${Date.now()}` }
    );
    res.status(202).json({ message: "Option chain sync enqueued", jobId: job.id });
  })
);

monitoringRouter.get(
  "/option-chain/snapshots",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    const snapshots = await prisma.optionChainSnapshot.findMany({
      orderBy: { snapshotAt: "desc" },
      take: 20,
      select: {
        underlying: true,
        expiry: true,
        lastPrice: true,
        strikes: true,
        putCallRatio: true,
        maxPainStrike: true,
        atmIv: true,
        snapshotAt: true,
      },
    });
    res.json({ snapshots });
  })
);

// ── Index snapshots ───────────────────────────────────────────────────────────

monitoringRouter.get(
  "/indices/latest",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    const snapshots = await prisma.indexSnapshot.findMany({
      orderBy: { snapshotAt: "desc" },
      distinct: ["name"],
      take: 10,
    });
    res.json({ snapshots });
  })
);

// ── Manual live data trigger (for testing outside market hours) ───────────────

monitoringRouter.post(
  "/market-data/trigger",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    logger.info("Admin triggered manual market data ingestion");

    const [chains, _indices] = await Promise.allSettled([
      ingestOptionChains(),
      ingestIndexSnapshots(),
    ]);

    res.json({
      optionChains: chains.status === "fulfilled"
        ? { ok: true, count: chains.value.length, results: chains.value }
        : { ok: false, error: (chains.reason as Error).message },
      indices: _indices.status === "fulfilled"
        ? { ok: true }
        : { ok: false, error: (_indices.reason as Error).message },
    });
  })
);

// ── Corporate actions ─────────────────────────────────────────────────────────

monitoringRouter.get(
  "/corporate-actions",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (req, res) => {
    const limit  = z.coerce.number().min(1).max(200).default(50).parse(req.query.limit ?? 50);
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
    const actions = await prisma.corporateAction.findMany({
      where: symbol ? { symbol } : undefined,
      orderBy: { announcedDate: "desc" },
      take: limit,
    });
    res.json({ actions });
  })
);

// ── Sector mapping ────────────────────────────────────────────────────────────

const sectorMappingSchema = z.object({
  securityId:              z.string().min(1),
  symbol:                  z.string().min(1),
  sectoralIndex:           z.string().min(1),
  sectoralIndexSecurityId: z.string().optional(),
});

monitoringRouter.post(
  "/sector-mapping",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (req, res) => {
    const parsed = sectorMappingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });

    const { securityId, symbol, sectoralIndex, sectoralIndexSecurityId } = parsed.data;
    const mapping = await prisma.sectorMapping.upsert({
      where: { securityId },
      create: { securityId, symbol: symbol.toUpperCase(), sectoralIndex, sectoralIndexSecurityId },
      update: { symbol: symbol.toUpperCase(), sectoralIndex, sectoralIndexSecurityId },
    });
    res.status(201).json({ mapping });
  })
);

monitoringRouter.post(
  "/sector-mapping/bulk",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (req, res) => {
    const parsed = z.array(sectorMappingSchema).min(1).max(1000).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });

    const operations = parsed.data.map((m) =>
      prisma.sectorMapping.upsert({
        where: { securityId: m.securityId },
        create: { ...m, symbol: m.symbol.toUpperCase() },
        update: { ...m, symbol: m.symbol.toUpperCase() },
      })
    );
    await prisma.$transaction(operations);
    res.status(201).json({ upserted: operations.length });
  })
);

monitoringRouter.get(
  "/sector-mapping",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    const mappings = await prisma.sectorMapping.findMany({ orderBy: { sectoralIndex: "asc" } });
    res.json({ mappings });
  })
);

// ── Fundamentals manual entry ─────────────────────────────────────────────────

const fundamentalsEntrySchema = z.object({
  securityId:      z.string().min(1),
  symbol:          z.string().min(1),
  periodType:      z.enum(["QUARTERLY", "ANNUAL", "TTM"]),
  periodEndDate:   z.string(),
  marketCap:       z.number().optional(),
  enterpriseValue: z.number().optional(),
  peRatio:         z.number().optional(),
  pbRatio:         z.number().optional(),
  bookValue:       z.number().optional(),
  eps:             z.number().optional(),
  roe:             z.number().optional(),
  roce:            z.number().optional(),
  debtToEquity:    z.number().optional(),
  profitLoss:      z.record(z.unknown()).optional(),
  balanceSheet:    z.record(z.unknown()).optional(),
  cashFlow:        z.record(z.unknown()).optional(),
});

monitoringRouter.post(
  "/fundamentals/manual-entry",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (req, res) => {
    const parsed = fundamentalsEntrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });

    const result = await upsertFundamentals({
      ...parsed.data,
      symbol:        parsed.data.symbol.toUpperCase(),
      periodEndDate: new Date(parsed.data.periodEndDate),
      source:        "MANUAL",
    });
    res.status(201).json({ fundamentals: result });
  })
);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function queueSummary(queue: BullQueue) {
  return queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
}
