import { Router } from "express";
import type { Queue as BullQueue } from "bullmq";
import { z } from "zod";
import { dhanClient } from "../services/dhan/client.js";
import { finEdgeClient } from "../services/finedge/client.js";
import { historicalSyncQueue, instrumentSyncQueue, corporateActionsSyncQueue } from "../workers/queues.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { upsertFundamentals } from "../services/market/fundamentalsStore.js";

export const monitoringRouter = Router();

/**
 * Admin-only: surfaces circuit breaker state for each upstream API and
 * queue depth/failure counts. Feeds the Admin Panel's API Monitoring
 * section (Phase 10) but useful standalone for debugging now.
 */
monitoringRouter.get(
  "/external-apis",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    res.json({
      dhan: { circuitState: dhanClient.getCircuitState() },
      finedge: { circuitState: finEdgeClient.getCircuitState() },
    });
  })
);

monitoringRouter.get(
  "/queues",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (_req, res) => {
    const [historical, instrument, corpActions] = await Promise.all([
      queueSummary(historicalSyncQueue),
      queueSummary(instrumentSyncQueue),
      queueSummary(corporateActionsSyncQueue),
    ]);

    res.json({ historicalSync: historical, instrumentSync: instrument, corporateActionsSync: corpActions });
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

// ---- Instrument Sync admin controls (Phase 3) ----

monitoringRouter.post(
  "/instrument-sync/trigger",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (req, res) => {
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

// ---- Corporate Actions admin listing (Phase 3) ----

monitoringRouter.get(
  "/corporate-actions",
  requireAuth,
  requireRole("ADMIN", "SUPERADMIN"),
  asyncRoute(async (req, res) => {
    const limit = z.coerce.number().min(1).max(200).default(50).parse(req.query.limit ?? 50);
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
    const actions = await prisma.corporateAction.findMany({
      where: symbol ? { symbol } : undefined,
      orderBy: { announcedDate: "desc" },
      take: limit,
    });
    res.json({ actions });
  })
);

// ---- Sector Mapping admin controls (Phase 3b) ----
// Seeds SectorMapping since NSE's classification is proprietary and no
// confirmed free API exists — admin enters NIFTY sectoral index membership
// per stock manually or via bulk upload.

const sectorMappingSchema = z.object({
  securityId: z.string().min(1),
  symbol: z.string().min(1),
  sectoralIndex: z.string().min(1),
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

// ---- Fundamentals admin entry (Phase 3b) ----
// Manual entry path while FinEdge endpoints are pending confirmation.

const fundamentalsEntrySchema = z.object({
  securityId: z.string().min(1),
  symbol: z.string().min(1),
  periodType: z.enum(["QUARTERLY", "ANNUAL", "TTM"]),
  periodEndDate: z.string(), // ISO date
  marketCap: z.number().optional(),
  enterpriseValue: z.number().optional(),
  peRatio: z.number().optional(),
  pbRatio: z.number().optional(),
  bookValue: z.number().optional(),
  eps: z.number().optional(),
  roe: z.number().optional(),
  roce: z.number().optional(),
  debtToEquity: z.number().optional(),
  profitLoss: z.record(z.unknown()).optional(),
  balanceSheet: z.record(z.unknown()).optional(),
  cashFlow: z.record(z.unknown()).optional(),
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
      symbol: parsed.data.symbol.toUpperCase(),
      periodEndDate: new Date(parsed.data.periodEndDate),
      source: "MANUAL",
    });
    res.status(201).json({ fundamentals: result });
  })
);

async function queueSummary(queue: BullQueue) {
  return queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
}
