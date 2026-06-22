/**
 * Option chain ingestion — fetches live option chains for major indices
 * and persists them to the OptionChainSnapshot table for analytics.
 *
 * Runs every 3 minutes during market hours via the scheduler.
 * One snapshot per (underlying, expiry) per tick — overwrites stale data
 * rather than accumulating, since only the latest chain matters for
 * real-time analytics. Historical chain data is a future concern.
 */
import { prisma } from "../../lib/prisma.js";
import { dhanClient } from "../dhan/client.js";
import { DhanExchangeSegment, DHAN_INDEX_IDS } from "../dhan/constants.js";
import { logger } from "../../lib/logger.js";
import { computeOptionChainMetrics } from "./optionMetricsPure.js";

// Underlyings to ingest — Nifty 50 and Bank Nifty are the most liquid
const OPTION_CHAIN_UNDERLYINGS = [
  { name: "NIFTY",     scrip: 13,  seg: DhanExchangeSegment.IDX_I },
  { name: "BANKNIFTY", scrip: 25,  seg: DhanExchangeSegment.IDX_I },
  { name: "FINNIFTY",  scrip: 27,  seg: DhanExchangeSegment.IDX_I },
] as const;

export interface OptionChainIngestionResult {
  underlying: string;
  expiry: string;
  strikes: number;
  pcr: number;
  maxPain: number;
  atmIv: number | null;
}

/**
 * Fetches the nearest expiry option chain for each major index,
 * computes metrics, and persists to OptionChainSnapshot.
 */
export async function ingestOptionChains(): Promise<OptionChainIngestionResult[]> {
  const results: OptionChainIngestionResult[] = [];

  for (const underlying of OPTION_CHAIN_UNDERLYINGS) {
    try {
      // Step 1: get expiry list, pick nearest expiry
      const expiryRes = await dhanClient.getExpiryList(underlying.scrip, underlying.seg);
      if (!expiryRes.data?.length) {
        logger.warn({ underlying: underlying.name }, "No expiries returned from Dhan");
        continue;
      }

      // Sort ascending and pick the nearest future expiry
      const today = new Date().toISOString().slice(0, 10);
      const nearestExpiry = expiryRes.data
        .filter((e) => e >= today)
        .sort()[0];

      if (!nearestExpiry) {
        logger.warn({ underlying: underlying.name }, "No future expiry found");
        continue;
      }

      // Step 2: fetch option chain
      const chain = await dhanClient.getOptionChain({
        UnderlyingScrip: underlying.scrip,
        UnderlyingSeg: underlying.seg,
        Expiry: nearestExpiry,
      });

      if (!chain.data?.oc) {
        logger.warn({ underlying: underlying.name, expiry: nearestExpiry }, "Empty option chain response");
        continue;
      }

      // Step 3: compute metrics
      const metrics = computeOptionChainMetrics(chain);
      const strikeCount = Object.keys(chain.data.oc).length;

      // Step 4: persist snapshot
      await prisma.optionChainSnapshot.upsert({
        where: {
          underlying_expiry: {
            underlying: underlying.name,
            expiry: nearestExpiry,
          },
        },
        create: {
          underlying: underlying.name,
          underlyingScrip: underlying.scrip,
          expiry: nearestExpiry,
          lastPrice: chain.data.last_price,
          strikes: strikeCount,
          putCallRatio: metrics.putCallRatio,
          maxPainStrike: metrics.maxPainStrike,
          totalCallOi: metrics.totalCallOi,
          totalPutOi: metrics.totalPutOi,
          callOiChange: metrics.callOiChange,
          putOiChange: metrics.putOiChange,
          atmIv: metrics.atmIv,
          rawChain: chain.data.oc as object,
          snapshotAt: new Date(),
        },
        update: {
          lastPrice: chain.data.last_price,
          strikes: strikeCount,
          putCallRatio: metrics.putCallRatio,
          maxPainStrike: metrics.maxPainStrike,
          totalCallOi: metrics.totalCallOi,
          totalPutOi: metrics.totalPutOi,
          callOiChange: metrics.callOiChange,
          putOiChange: metrics.putOiChange,
          atmIv: metrics.atmIv,
          rawChain: chain.data.oc as object,
          snapshotAt: new Date(),
        },
      });

      results.push({
        underlying: underlying.name,
        expiry: nearestExpiry,
        strikes: strikeCount,
        pcr: metrics.putCallRatio,
        maxPain: metrics.maxPainStrike,
        atmIv: metrics.atmIv,
      });

      logger.info(
        { underlying: underlying.name, expiry: nearestExpiry, strikes: strikeCount, pcr: metrics.putCallRatio },
        "Option chain ingested"
      );
    } catch (err) {
      logger.error({ underlying: underlying.name, err: (err as Error).message }, "Option chain ingestion failed");
    }
  }

  return results;
}

/**
 * Fetches live LTP for all major NSE indices and persists to IndexSnapshot.
 */
export async function ingestIndexSnapshots(): Promise<void> {
  try {
    const indexIds = Object.values(DHAN_INDEX_IDS).map(Number);

    const response = await dhanClient.getOhlc({
      [DhanExchangeSegment.IDX_I]: indexIds,
    });

    const segmentData = response.data[DhanExchangeSegment.IDX_I] ?? {};
    const now = new Date();

    for (const [name, id] of Object.entries(DHAN_INDEX_IDS)) {
      const tick = segmentData[id];
      if (!tick) continue;

      const changePercent = tick.ohlc.close
        ? ((tick.last_price - tick.ohlc.close) / tick.ohlc.close) * 100
        : 0;

      await prisma.indexSnapshot.upsert({
        where: { name_snapshotAt: { name, snapshotAt: roundToMinute(now) } },
        create: {
          name,
          securityId: id,
          lastPrice: tick.last_price,
          open: tick.ohlc.open,
          high: tick.ohlc.high,
          low: tick.ohlc.low,
          prevClose: tick.ohlc.close,
          changePercent: Number(changePercent.toFixed(2)),
          snapshotAt: roundToMinute(now),
        },
        update: {
          lastPrice: tick.last_price,
          open: tick.ohlc.open,
          high: tick.ohlc.high,
          low: tick.ohlc.low,
          prevClose: tick.ohlc.close,
          changePercent: Number(changePercent.toFixed(2)),
        },
      });
    }

    logger.info({ count: Object.keys(segmentData).length }, "Index snapshots ingested");
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Index snapshot ingestion failed");
  }
}

function roundToMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}
