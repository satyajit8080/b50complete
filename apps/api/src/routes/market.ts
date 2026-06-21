import { Router } from "express";
import { z } from "zod";
import { dhanClient } from "../services/dhan/client.js";
import { DhanExchangeSegment, DhanInstrumentType, DhanInterval } from "../services/dhan/constants.js";
import { getIndexOverview } from "../services/market/overview.js";
import { resolveSecurityId, searchInstruments } from "../services/market/instruments.js";
import { finEdgeClient } from "../services/finedge/client.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { getLatestBreadth } from "../services/market/breadth.js";
import { getTopList } from "../services/market/topLists.js";
import { getOptionChainWithMetrics } from "../services/market/optionMetrics.js";
import { generateAiInsight } from "../services/ai/insights.js";
import { getLatestSectorStrength, computeSectorRotation } from "../services/market/sectors.js";
import { getLatestFundamentals, getFundamentalsHistory, getLatestShareholding } from "../services/market/fundamentalsStore.js";
import type { TopListCategory, FundamentalPeriodType } from "@bull50/db";

export const marketRouter = Router();

marketRouter.get(
  "/overview/indices",
  asyncRoute(async (_req, res) => {
    const indices = await getIndexOverview();
    res.json({ indices });
  })
);

marketRouter.get(
  "/instruments/search",
  asyncRoute(async (req, res) => {
    const query = z.string().min(1).max(50).parse(req.query.q ?? "");
    const results = await searchInstruments(query);
    res.json({ results });
  })
);

const quoteQuerySchema = z.object({
  symbol: z.string().min(1),
  segment: z.nativeEnum(DhanExchangeSegment).default(DhanExchangeSegment.NSE_EQ),
});

marketRouter.get(
  "/quote/:symbol",
  asyncRoute(async (req, res) => {
    const parsed = quoteQuerySchema.safeParse({ symbol: req.params.symbol, segment: req.query.segment });
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });

    const { symbol, segment } = parsed.data;
    const instrument = await resolveSecurityId(symbol, segment);
    if (!instrument) return res.status(404).json({ error: `Unknown symbol: ${symbol}` });

    const quote = await dhanClient.getQuote({ [segment]: [Number(instrument.securityId)] });
    res.json({ symbol, quote: quote.data[segment]?.[instrument.securityId] ?? null });
  })
);

const historicalQuerySchema = z.object({
  symbol: z.string().min(1),
  segment: z.nativeEnum(DhanExchangeSegment).default(DhanExchangeSegment.NSE_EQ),
  interval: z.nativeEnum(DhanInterval).optional(), // omit for daily
  fromDate: z.string(),
  toDate: z.string(),
});

marketRouter.get(
  "/historical/:symbol",
  asyncRoute(async (req, res) => {
    const parsed = historicalQuerySchema.safeParse({ ...req.query, symbol: req.params.symbol });
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });

    const { symbol, segment, interval, fromDate, toDate } = parsed.data;
    const instrument = await resolveSecurityId(symbol, segment);
    if (!instrument) return res.status(404).json({ error: `Unknown symbol: ${symbol}` });

    const candles = interval
      ? await dhanClient.getHistoricalIntraday({
          securityId: instrument.securityId,
          exchangeSegment: segment,
          instrument: DhanInstrumentType.EQUITY,
          interval,
          fromDate,
          toDate,
        })
      : await dhanClient.getHistoricalDaily({
          securityId: instrument.securityId,
          exchangeSegment: segment,
          instrument: DhanInstrumentType.EQUITY,
          fromDate,
          toDate,
        });

    res.json({ symbol, candles });
  })
);

const optionChainQuerySchema = z.object({
  symbol: z.string().min(1),
  underlyingScrip: z.coerce.number(),
  segment: z.nativeEnum(DhanExchangeSegment).default(DhanExchangeSegment.IDX_I),
  expiry: z.string().optional(),
});

marketRouter.get(
  "/options/:symbol/expiries",
  asyncRoute(async (req, res) => {
    const parsed = optionChainQuerySchema
      .pick({ underlyingScrip: true, segment: true })
      .safeParse({ underlyingScrip: req.query.underlyingScrip, segment: req.query.segment });
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });

    const { underlyingScrip, segment } = parsed.data;
    const expiries = await dhanClient.getExpiryList(underlyingScrip, segment);
    res.json(expiries);
  })
);

marketRouter.get(
  "/options/:symbol/chain",
  asyncRoute(async (req, res) => {
    const parsed = optionChainQuerySchema.safeParse({ ...req.query, symbol: req.params.symbol });
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    if (!parsed.data.expiry) return res.status(400).json({ error: "expiry query param is required" });

    const { underlyingScrip, segment, expiry } = parsed.data;
    const chain = await dhanClient.getOptionChain({
      UnderlyingScrip: underlyingScrip,
      UnderlyingSeg: segment,
      Expiry: expiry,
    });
    res.json(chain);
  })
);

// ---- Fundamentals (FinEdge) ----

marketRouter.get(
  "/fundamentals/:symbol/profile",
  asyncRoute(async (req, res) => {
    const profile = await finEdgeClient.getCompanyProfile(req.params.symbol);
    res.json({ symbol: req.params.symbol, profile });
  })
);

marketRouter.get(
  "/fundamentals/:symbol/ratios",
  asyncRoute(async (req, res) => {
    const ratios = await finEdgeClient.getRatios(req.params.symbol);
    res.json({ symbol: req.params.symbol, ratios });
  })
);

// ---- Market Breadth (Phase 3) ----

marketRouter.get(
  "/breadth",
  asyncRoute(async (_req, res) => {
    const breadth = await getLatestBreadth();
    if (!breadth) return res.status(404).json({ error: "No breadth data yet — scheduler has not run" });
    res.json(breadth);
  })
);

// ---- Top Lists (Phase 3) ----

const topListCategorySchema = z.enum([
  "TOP_GAINERS",
  "TOP_LOSERS",
  "MOST_ACTIVE",
  "VOLUME_SHOCKERS",
  "BREAKOUT",
  "BREAKDOWN",
  "WEEK_52_HIGH",
  "WEEK_52_LOW",
  "GAP_UP",
  "GAP_DOWN",
  "UPPER_CIRCUIT",
  "LOWER_CIRCUIT",
]);

marketRouter.get(
  "/top-lists/:category",
  asyncRoute(async (req, res) => {
    const parsedCategory = topListCategorySchema.safeParse(req.params.category);
    if (!parsedCategory.success) {
      return res.status(400).json({ error: `Unknown category: ${req.params.category}` });
    }
    const limit = z.coerce.number().min(1).max(100).default(20).parse(req.query.limit ?? 20);
    const entries = await getTopList(parsedCategory.data as TopListCategory, limit);
    res.json({ category: parsedCategory.data, entries });
  })
);

// ---- Option Chain Metrics (Phase 3 — PCR, Max Pain, IV) ----

marketRouter.get(
  "/options/:symbol/metrics",
  asyncRoute(async (req, res) => {
    const parsed = optionChainQuerySchema.safeParse({ ...req.query, symbol: req.params.symbol });
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    if (!parsed.data.expiry) return res.status(400).json({ error: "expiry query param is required" });

    const { underlyingScrip, segment, expiry } = parsed.data;
    const { chain, metrics } = await getOptionChainWithMetrics(underlyingScrip, segment, expiry);
    res.json({ symbol: req.params.symbol, expiry, underlyingLastPrice: chain.data.last_price, metrics });
  })
);

// ---- AI Data Layer (Phase 3) ----
// Every AI endpoint consumes Bull50's own structured/computed data, not
// raw upstream payloads — see services/ai/insights.ts.

marketRouter.get(
  "/ai/market-movement",
  asyncRoute(async (_req, res) => {
    const breadth = await getLatestBreadth();
    if (!breadth) return res.status(404).json({ error: "No breadth data yet" });

    const insight = await generateAiInsight({
      type: "MARKET_MOVEMENT",
      data: { ...breadth },
      cacheKeySuffix: breadth.timestamp,
    });
    res.json({ insight, basedOn: breadth });
  })
);

marketRouter.get(
  "/ai/options-explain/:symbol",
  asyncRoute(async (req, res) => {
    const parsed = optionChainQuerySchema.safeParse({ ...req.query, symbol: req.params.symbol });
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    if (!parsed.data.expiry) return res.status(400).json({ error: "expiry query param is required" });

    const { underlyingScrip, segment, expiry } = parsed.data;
    const { metrics } = await getOptionChainWithMetrics(underlyingScrip, segment, expiry);

    const insight = await generateAiInsight({
      type: "OPTION_CHAIN_EXPLAIN",
      data: { symbol: req.params.symbol, expiry, ...metrics },
      cacheKeySuffix: `${req.params.symbol}:${expiry}`,
    });
    res.json({ insight, basedOn: metrics });
  })
);

// ---- Sector Strength & Rotation (Phase 3b) ----
// Sector proxy is NIFTY sectoral index membership (see SectorMapping) —
// NSE's own industry classification is proprietary with no confirmed free
// API, so this is intentionally empty until SectorMapping is seeded.

marketRouter.get(
  "/sectors/strength",
  asyncRoute(async (_req, res) => {
    const strength = await getLatestSectorStrength();
    res.json({ sectors: strength, note: strength.length === 0 ? "SectorMapping table is empty — see admin panel to seed sector mappings" : undefined });
  })
);

marketRouter.get(
  "/sectors/rotation",
  asyncRoute(async (req, res) => {
    const hoursAgo = z.coerce.number().min(1).max(720).default(24).parse(req.query.hoursAgo ?? 24);
    const rotation = await computeSectorRotation(hoursAgo);
    res.json({ rotation, compareWindowHours: hoursAgo });
  })
);

// ---- Fundamentals — Bull50's own storage (Phase 3b) ----
// Source-agnostic: populated by FinEdge once endpoints are confirmed, or
// by manual/admin entry in the meantime. See services/market/fundamentalsStore.ts.

const periodTypeSchema = z.enum(["QUARTERLY", "ANNUAL", "TTM"]);

marketRouter.get(
  "/fundamentals/:symbol/stored",
  asyncRoute(async (req, res) => {
    const periodType = periodTypeSchema.default("QUARTERLY").parse(req.query.periodType ?? "QUARTERLY");
    const instrument = await resolveSecurityId(req.params.symbol, DhanExchangeSegment.NSE_EQ);
    if (!instrument) return res.status(404).json({ error: `Unknown symbol: ${req.params.symbol}` });

    const [latest, shareholding] = await Promise.all([
      getLatestFundamentals(instrument.securityId, periodType as FundamentalPeriodType),
      getLatestShareholding(instrument.securityId),
    ]);

    if (!latest) {
      return res.status(404).json({
        error: `No stored fundamentals for ${req.params.symbol} yet — pending FinEdge integration or manual entry`,
      });
    }
    res.json({ symbol: req.params.symbol, fundamentals: latest, shareholding });
  })
);

marketRouter.get(
  "/fundamentals/:symbol/history",
  asyncRoute(async (req, res) => {
    const periodType = periodTypeSchema.default("QUARTERLY").parse(req.query.periodType ?? "QUARTERLY");
    const limit = z.coerce.number().min(1).max(40).default(8).parse(req.query.limit ?? 8);
    const instrument = await resolveSecurityId(req.params.symbol, DhanExchangeSegment.NSE_EQ);
    if (!instrument) return res.status(404).json({ error: `Unknown symbol: ${req.params.symbol}` });

    const history = await getFundamentalsHistory(instrument.securityId, periodType as FundamentalPeriodType, limit);
    res.json({ symbol: req.params.symbol, periodType, history });
  })
);
