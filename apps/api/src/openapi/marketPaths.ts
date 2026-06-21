import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ErrorResponseSchema, DhanExchangeSegmentSchema, TopListCategorySchema } from "./schemas.js";

const symbolParam = { params: z.object({ symbol: z.string().openapi({ example: "RELIANCE" }) }) };

export function registerMarketPaths(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: "get",
    path: "/api/market/overview/indices",
    tags: ["Market — Overview"],
    summary: "Live snapshot of major NSE indices (Nifty 50, Bank Nifty, India VIX, etc.)",
    responses: {
      200: { description: "Index snapshot", content: { "application/json": { schema: z.object({ indices: z.array(z.unknown()) }) } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/instruments/search",
    tags: ["Market — Overview"],
    summary: "Search instruments by symbol",
    request: { query: z.object({ q: z.string().min(1).max(50) }) },
    responses: {
      200: { description: "Matching instruments", content: { "application/json": { schema: z.object({ results: z.array(z.unknown()) }) } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/quote/{symbol}",
    tags: ["Market — Quotes"],
    summary: "Live quote for a symbol (LTP, OHLC, volume, OI)",
    request: { ...symbolParam, query: z.object({ segment: DhanExchangeSegmentSchema.optional() }) },
    responses: {
      200: { description: "Quote", content: { "application/json": { schema: z.object({ symbol: z.string(), quote: z.unknown().nullable() }) } } },
      404: { description: "Unknown symbol", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/historical/{symbol}",
    tags: ["Market — Quotes"],
    summary: "Historical OHLCV candles (daily, or intraday if `interval` is given)",
    description: "Omit `interval` for daily candles. Dhan limits intraday requests to a 90-day window per call.",
    request: {
      ...symbolParam,
      query: z.object({
        segment: DhanExchangeSegmentSchema.optional(),
        interval: z.enum(["1", "5", "15", "25", "60"]).optional().openapi({ description: "Minutes. Omit for daily candles." }),
        fromDate: z.string().openapi({ example: "2026-01-01" }),
        toDate: z.string().openapi({ example: "2026-06-21" }),
      }),
    },
    responses: {
      200: { description: "Candle data", content: { "application/json": { schema: z.object({ symbol: z.string(), candles: z.unknown() }) } } },
      404: { description: "Unknown symbol", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/options/{symbol}/expiries",
    tags: ["Market — Options"],
    summary: "Available expiry dates for an underlying",
    request: { ...symbolParam, query: z.object({ underlyingScrip: z.coerce.number(), segment: DhanExchangeSegmentSchema.optional() }) },
    responses: { 200: { description: "Expiry list", content: { "application/json": { schema: z.unknown() } } } },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/options/{symbol}/chain",
    tags: ["Market — Options"],
    summary: "Full option chain for an expiry (raw Dhan response — Greeks, OI, IV per strike)",
    request: {
      ...symbolParam,
      query: z.object({ underlyingScrip: z.coerce.number(), segment: DhanExchangeSegmentSchema.optional(), expiry: z.string() }),
    },
    responses: {
      200: { description: "Option chain", content: { "application/json": { schema: z.unknown() } } },
      400: { description: "Missing expiry", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/options/{symbol}/metrics",
    tags: ["Market — Options"],
    summary: "Derived option chain metrics: PCR, Max Pain, ATM IV, IV Rank/Percentile, OI change",
    request: {
      ...symbolParam,
      query: z.object({ underlyingScrip: z.coerce.number(), segment: DhanExchangeSegmentSchema.optional(), expiry: z.string() }),
    },
    responses: {
      200: {
        description: "Computed metrics",
        content: {
          "application/json": {
            schema: z.object({ symbol: z.string(), expiry: z.string(), underlyingLastPrice: z.number(), metrics: z.unknown() }),
          },
        },
      },
      400: { description: "Missing expiry", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  // ---- Fundamentals: live FinEdge pass-through (endpoint paths pending — see Phase 2/3 known gaps) ----

  registry.registerPath({
    method: "get",
    path: "/api/market/fundamentals/{symbol}/profile",
    tags: ["Market — Fundamentals (FinEdge, pending)"],
    summary: "Company profile (live FinEdge pass-through)",
    description:
      "NOT YET FUNCTIONAL — FinEdge endpoint path is a placeholder pending confirmed API docs. Returns an upstream error until wired up.",
    request: symbolParam,
    responses: { 200: { description: "Profile", content: { "application/json": { schema: z.unknown() } } } },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/fundamentals/{symbol}/ratios",
    tags: ["Market — Fundamentals (FinEdge, pending)"],
    summary: "Financial ratios (live FinEdge pass-through)",
    description:
      "NOT YET FUNCTIONAL — FinEdge endpoint path is a placeholder pending confirmed API docs. Returns an upstream error until wired up.",
    request: symbolParam,
    responses: { 200: { description: "Ratios", content: { "application/json": { schema: z.unknown() } } } },
  });

  // ---- Fundamentals: Bull50's own storage (works today, source-agnostic) ----

  registry.registerPath({
    method: "get",
    path: "/api/market/fundamentals/{symbol}/stored",
    tags: ["Market — Fundamentals (Bull50 storage)"],
    summary: "Latest stored fundamentals + shareholding for a symbol",
    description:
      "Reads from Bull50's own CompanyFundamentals table — populated via FinEdge (pending) or admin manual entry. Returns 404 until populated.",
    request: { ...symbolParam, query: z.object({ periodType: z.enum(["QUARTERLY", "ANNUAL", "TTM"]).optional() }) },
    responses: {
      200: { description: "Stored fundamentals", content: { "application/json": { schema: z.unknown() } } },
      404: { description: "No data yet for this symbol", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/fundamentals/{symbol}/history",
    tags: ["Market — Fundamentals (Bull50 storage)"],
    summary: "Historical fundamentals series for a symbol",
    request: {
      ...symbolParam,
      query: z.object({
        periodType: z.enum(["QUARTERLY", "ANNUAL", "TTM"]).optional(),
        limit: z.coerce.number().min(1).max(40).optional(),
      }),
    },
    responses: { 200: { description: "History", content: { "application/json": { schema: z.unknown() } } } },
  });

  // ---- Market Breadth & Top Lists ----

  registry.registerPath({
    method: "get",
    path: "/api/market/breadth",
    tags: ["Market — Breadth"],
    summary: "Latest market breadth snapshot (advances/declines, new highs/lows)",
    description: "Computed by the scheduler every 5 min during market hours. Returns 404 if the scheduler hasn't run yet.",
    responses: {
      200: { description: "Breadth snapshot", content: { "application/json": { schema: z.unknown() } } },
      404: { description: "No breadth data yet", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/top-lists/{category}",
    tags: ["Market — Breadth"],
    summary: "Top list for a category (gainers, losers, 52w high/low, etc.)",
    description:
      "9 of 12 categories are computed (TOP_GAINERS, TOP_LOSERS, MOST_ACTIVE, GAP_UP, GAP_DOWN, UPPER_CIRCUIT, LOWER_CIRCUIT, WEEK_52_HIGH, WEEK_52_LOW). VOLUME_SHOCKERS, BREAKOUT, BREAKDOWN are accepted but return an empty list — see known gaps.",
    request: {
      params: z.object({ category: TopListCategorySchema }),
      query: z.object({ limit: z.coerce.number().min(1).max(100).optional() }),
    },
    responses: {
      200: {
        description: "Ranked list",
        content: { "application/json": { schema: z.object({ category: z.string(), entries: z.array(z.unknown()) }) } },
      },
      400: { description: "Unknown category", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  // ---- Sectors ----

  registry.registerPath({
    method: "get",
    path: "/api/market/sectors/strength",
    tags: ["Market — Sectors"],
    summary: "Current sector strength ranking (NIFTY sectoral index proxy)",
    description: "Returns an empty array with a note until SectorMapping is seeded via the admin endpoints — see known gaps.",
    responses: {
      200: {
        description: "Ranked sectors",
        content: { "application/json": { schema: z.object({ sectors: z.array(z.unknown()), note: z.string().optional() }) } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/sectors/rotation",
    tags: ["Market — Sectors"],
    summary: "Sector rotation vs. N hours ago (default 24h)",
    request: { query: z.object({ hoursAgo: z.coerce.number().min(1).max(720).optional() }) },
    responses: { 200: { description: "Rotation", content: { "application/json": { schema: z.unknown() } } } },
  });

  // ---- AI Data Layer ----

  registry.registerPath({
    method: "get",
    path: "/api/market/ai/market-movement",
    tags: ["Market — AI"],
    summary: "AI-generated explanation of today's market movement",
    description: "Generated by Claude from Bull50's own breadth data (never raw upstream payloads). Requires ANTHROPIC_API_KEY to be configured.",
    responses: {
      200: { description: "Insight", content: { "application/json": { schema: z.object({ insight: z.string(), basedOn: z.unknown() }) } } },
      404: { description: "No breadth data yet", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/market/ai/options-explain/{symbol}",
    tags: ["Market — AI"],
    summary: "AI-generated explanation of option chain positioning",
    description: "Generated by Claude from Bull50's own computed option metrics (PCR, Max Pain, IV) — never the raw Dhan payload.",
    request: {
      ...symbolParam,
      query: z.object({ underlyingScrip: z.coerce.number(), segment: DhanExchangeSegmentSchema.optional(), expiry: z.string() }),
    },
    responses: {
      200: { description: "Insight", content: { "application/json": { schema: z.object({ insight: z.string(), basedOn: z.unknown() }) } } },
      400: { description: "Missing expiry", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });
}
