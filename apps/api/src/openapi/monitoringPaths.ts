import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ErrorResponseSchema, BearerAuth } from "./schemas.js";

const adminSecurity = [{ [BearerAuth]: [] }];
const adminResponses403 = {
  401: { description: "Not authenticated", content: { "application/json": { schema: ErrorResponseSchema } } },
  403: { description: "Not an admin", content: { "application/json": { schema: ErrorResponseSchema } } },
};

const sectorMappingSchema = z.object({
  securityId: z.string().min(1),
  symbol: z.string().min(1),
  sectoralIndex: z.string().min(1).openapi({ example: "NIFTYBANK" }),
  sectoralIndexSecurityId: z.string().optional(),
});

export function registerMonitoringPaths(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/api/monitoring/external-apis",
    tags: ["Admin — Monitoring"],
    summary: "Circuit breaker state for DhanHQ and FinEdge",
    security: adminSecurity,
    responses: {
      200: { description: "Circuit states", content: { "application/json": { schema: z.unknown() } } },
      ...adminResponses403,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/monitoring/queues",
    tags: ["Admin — Monitoring"],
    summary: "BullMQ job counts for all queues (waiting/active/completed/failed/delayed)",
    security: adminSecurity,
    responses: { 200: { description: "Queue stats", content: { "application/json": { schema: z.unknown() } } }, ...adminResponses403 },
  });

  registry.registerPath({
    method: "get",
    path: "/api/monitoring/redis",
    tags: ["Admin — Monitoring"],
    summary: "Redis connection status",
    security: adminSecurity,
    responses: {
      200: { description: "Redis status", content: { "application/json": { schema: z.object({ status: z.string(), connected: z.boolean() }) } } },
      ...adminResponses403,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/monitoring/instrument-sync/trigger",
    tags: ["Admin — Instrument Sync"],
    summary: "Manually trigger an instrument master sync from Dhan's scrip CSV",
    security: adminSecurity,
    responses: {
      202: { description: "Sync enqueued", content: { "application/json": { schema: z.object({ message: z.string(), jobId: z.string() }) } } },
      ...adminResponses403,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/monitoring/instrument-sync/logs",
    tags: ["Admin — Instrument Sync"],
    summary: "Recent instrument sync run history",
    security: adminSecurity,
    request: { query: z.object({ limit: z.coerce.number().min(1).max(100).optional() }) },
    responses: { 200: { description: "Sync logs", content: { "application/json": { schema: z.unknown() } } }, ...adminResponses403 },
  });

  registry.registerPath({
    method: "get",
    path: "/api/monitoring/corporate-actions",
    tags: ["Admin — Corporate Actions"],
    summary: "List stored corporate actions, optionally filtered by symbol",
    description: "Currently always returns an empty list — no sync worker writes to this table yet (depends on pending FinEdge endpoints).",
    security: adminSecurity,
    request: { query: z.object({ limit: z.coerce.number().min(1).max(200).optional(), symbol: z.string().optional() }) },
    responses: { 200: { description: "Corporate actions", content: { "application/json": { schema: z.unknown() } } }, ...adminResponses403 },
  });

  registry.registerPath({
    method: "post",
    path: "/api/monitoring/sector-mapping",
    tags: ["Admin — Sector Mapping"],
    summary: "Seed/update a single stock's sectoral index mapping",
    security: adminSecurity,
    request: { body: { content: { "application/json": { schema: sectorMappingSchema } } } },
    responses: {
      201: { description: "Mapping saved", content: { "application/json": { schema: z.unknown() } } },
      400: { description: "Validation failed", content: { "application/json": { schema: ErrorResponseSchema } } },
      ...adminResponses403,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/monitoring/sector-mapping/bulk",
    tags: ["Admin — Sector Mapping"],
    summary: "Bulk seed/update sector mappings (max 1000 per call)",
    security: adminSecurity,
    request: { body: { content: { "application/json": { schema: z.array(sectorMappingSchema).min(1).max(1000) } } } },
    responses: {
      201: { description: "Mappings saved", content: { "application/json": { schema: z.object({ upserted: z.number() }) } } },
      400: { description: "Validation failed", content: { "application/json": { schema: ErrorResponseSchema } } },
      ...adminResponses403,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/monitoring/sector-mapping",
    tags: ["Admin — Sector Mapping"],
    summary: "List all current sector mappings",
    security: adminSecurity,
    responses: { 200: { description: "Mappings", content: { "application/json": { schema: z.unknown() } } }, ...adminResponses403 },
  });

  const fundamentalsEntrySchema = z.object({
    securityId: z.string().min(1),
    symbol: z.string().min(1),
    periodType: z.enum(["QUARTERLY", "ANNUAL", "TTM"]),
    periodEndDate: z.string().openapi({ example: "2026-03-31", description: "ISO date" }),
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

  registry.registerPath({
    method: "post",
    path: "/api/monitoring/fundamentals/manual-entry",
    tags: ["Admin — Fundamentals"],
    summary: "Manually enter fundamentals for a symbol (bridge until FinEdge endpoints are confirmed)",
    security: adminSecurity,
    request: { body: { content: { "application/json": { schema: fundamentalsEntrySchema } } } },
    responses: {
      201: { description: "Fundamentals saved", content: { "application/json": { schema: z.unknown() } } },
      400: { description: "Validation failed", content: { "application/json": { schema: ErrorResponseSchema } } },
      ...adminResponses403,
    },
  });
}
