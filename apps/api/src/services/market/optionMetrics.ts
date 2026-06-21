import { dhanClient } from "../dhan/client.js";
import type { OptionChainResponse } from "../dhan/types.js";
import { cached, CACHE_TTL } from "../../lib/cache.js";
import { computeOptionChainMetrics, type OptionChainMetrics } from "./optionMetricsPure.js";

// Re-exported so existing imports of `{ computeOptionChainMetrics, OptionChainMetrics }
// from "./optionMetrics.js"` keep working unchanged — the pure computation
// itself now lives in optionMetricsPure.ts (zero side-effecting imports,
// fully unit-testable without env/Redis/Dhan setup).
export { computeOptionChainMetrics, type OptionChainMetrics };

export async function getOptionChainWithMetrics(
  underlyingScrip: number,
  underlyingSeg: string,
  expiry: string
): Promise<{ chain: OptionChainResponse; metrics: OptionChainMetrics }> {
  const key = `market:optionmetrics:${underlyingScrip}:${underlyingSeg}:${expiry}`;
  return cached(key, { ttlSeconds: CACHE_TTL.OPTION_CHAIN }, async () => {
    const chain = await dhanClient.getOptionChain({
      UnderlyingScrip: underlyingScrip,
      UnderlyingSeg: underlyingSeg as Parameters<typeof dhanClient.getOptionChain>[0]["UnderlyingSeg"],
      Expiry: expiry,
    });
    const metrics = computeOptionChainMetrics(chain);
    return { chain, metrics };
  });
}
