import { dhanClient } from "../dhan/client.js";
import { DhanExchangeSegment, DHAN_INDEX_IDS } from "../dhan/constants.js";
import { logger } from "../../lib/logger.js";

export interface IndexSnapshot {
  name: string;
  securityId: string;
  lastPrice: number;
  change: number;
  changePercent: number;
}

/**
 * Fetches LTP for all major NSE indices in a single batched Dhan call
 * (Market Quote API supports up to 1000 instruments per request).
 */
export async function getIndexOverview(): Promise<IndexSnapshot[]> {
  const indexIds = Object.values(DHAN_INDEX_IDS).map(Number);
  const names = Object.keys(DHAN_INDEX_IDS);

  const response = await dhanClient.getOhlc({
    [DhanExchangeSegment.IDX_I]: indexIds,
  });

  const segmentData = response.data[DhanExchangeSegment.IDX_I] ?? {};

  return Object.entries(DHAN_INDEX_IDS).map(([name, id]) => {
    const tick = segmentData[id];
    if (!tick) {
      logger.warn({ index: name, securityId: id }, "No data returned for index");
      return { name, securityId: id, lastPrice: 0, change: 0, changePercent: 0 };
    }
    const change = tick.last_price - tick.ohlc.close;
    const changePercent = tick.ohlc.close ? (change / tick.ohlc.close) * 100 : 0;
    return {
      name,
      securityId: id,
      lastPrice: tick.last_price,
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
    };
  });
}
