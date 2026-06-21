import { describe, it, expect } from "vitest";
import { computeOptionChainMetrics } from "./optionMetricsPure.js";
import type { OptionChainResponse, OptionLeg } from "../dhan/types.js";

function leg(overrides: Partial<OptionLeg> = {}): OptionLeg {
  return {
    greeks: { delta: 0, theta: 0, gamma: 0, vega: 0 },
    implied_volatility: 0,
    last_price: 0,
    oi: 0,
    previous_oi: 0,
    previous_close_price: 0,
    previous_volume: 0,
    top_ask_price: 0,
    top_ask_quantity: 0,
    top_bid_price: 0,
    top_bid_quantity: 0,
    volume: 0,
    ...overrides,
  };
}

function buildChain(
  lastPrice: number,
  oc: Record<string, { ce?: Partial<OptionLeg>; pe?: Partial<OptionLeg> }>
): OptionChainResponse {
  const fullOc: OptionChainResponse["data"]["oc"] = {};
  for (const [strike, { ce, pe }] of Object.entries(oc)) {
    fullOc[strike] = {
      ce: ce ? leg(ce) : undefined,
      pe: pe ? leg(pe) : undefined,
    };
  }
  return { status: "success", data: { last_price: lastPrice, oc: fullOc } };
}

describe("computeOptionChainMetrics — Put Call Ratio", () => {
  it("computes PCR as totalPutOi / totalCallOi", () => {
    const chain = buildChain(100, {
      "100": { ce: { oi: 1000 }, pe: { oi: 1500 } },
      "110": { ce: { oi: 2000 }, pe: { oi: 500 } },
    });
    const metrics = computeOptionChainMetrics(chain);
    // totalCallOi = 3000, totalPutOi = 2000 -> PCR = 0.6667 -> 0.67
    expect(metrics.totalCallOi).toBe(3000);
    expect(metrics.totalPutOi).toBe(2000);
    expect(metrics.putCallRatio).toBeCloseTo(0.67, 2);
  });

  it("returns 0 PCR when there is no call OI, instead of dividing by zero", () => {
    const chain = buildChain(100, { "100": { pe: { oi: 500 } } });
    const metrics = computeOptionChainMetrics(chain);
    expect(metrics.putCallRatio).toBe(0);
  });
});

describe("computeOptionChainMetrics — OI change", () => {
  it("sums (oi - previous_oi) across all strikes per leg type", () => {
    const chain = buildChain(100, {
      "100": { ce: { oi: 1200, previous_oi: 1000 }, pe: { oi: 800, previous_oi: 900 } },
      "110": { ce: { oi: 500, previous_oi: 400 }, pe: { oi: 300, previous_oi: 300 } },
    });
    const metrics = computeOptionChainMetrics(chain);
    expect(metrics.callOiChange).toBe(300); // (1200-1000) + (500-400)
    expect(metrics.putOiChange).toBe(-100); // (800-900) + (300-300)
  });
});

describe("computeOptionChainMetrics — Max Pain", () => {
  it("picks the strike minimizing total payout to ITM option holders — simple symmetric case", () => {
    // Single strike with both CE and PE OI: max pain must be that strike
    // (settling exactly at the only strike means zero intrinsic value paid
    // to either side, which is trivially the minimum).
    const chain = buildChain(100, {
      "100": { ce: { oi: 1000 }, pe: { oi: 1000 } },
    });
    const metrics = computeOptionChainMetrics(chain);
    expect(metrics.maxPainStrike).toBe(100);
  });

  it("matches a hand-computed result for a 3-strike chain", () => {
    // Strikes: 90, 100, 110
    // CE OI:    0,  500, 1000   (writers want price low)
    // PE OI: 1000,  500,   0    (writers want price high)
    //
    // Pain at 90:  CE: 0 (no ITM calls) + PE: (100-90)*500 + (110-90)*0 = 5000
    // Pain at 100: CE: (100-90)*0=0     + PE: (110-100)*0 = 0           -> total 0
    // Pain at 110: CE: (110-90)*0 + (110-100)*500 = 5000 + PE: 0        -> total 5000
    //
    // Minimum total pain is at strike 100.
    const chain = buildChain(100, {
      "90": { ce: { oi: 0 }, pe: { oi: 1000 } },
      "100": { ce: { oi: 500 }, pe: { oi: 500 } },
      "110": { ce: { oi: 1000 }, pe: { oi: 0 } },
    });
    const metrics = computeOptionChainMetrics(chain);
    expect(metrics.maxPainStrike).toBe(100);
  });

  it("does not crash on a single-strike chain with only a call leg", () => {
    const chain = buildChain(100, { "100": { ce: { oi: 500 } } });
    const metrics = computeOptionChainMetrics(chain);
    expect(metrics.maxPainStrike).toBe(100);
  });
});

describe("computeOptionChainMetrics — ATM IV", () => {
  it("averages CE and PE IV at the strike closest to last_price", () => {
    const chain = buildChain(103, {
      "100": { ce: { implied_volatility: 20 }, pe: { implied_volatility: 22 } },
      "105": { ce: { implied_volatility: 18 }, pe: { implied_volatility: 16 } }, // closest to 103
      "110": { ce: { implied_volatility: 30 }, pe: { implied_volatility: 28 } },
    });
    const metrics = computeOptionChainMetrics(chain);
    expect(metrics.atmIv).toBeCloseTo(17, 1); // avg(18, 16)
  });

  it("returns null IV when no leg has a usable implied_volatility", () => {
    const chain = buildChain(100, { "100": { ce: { implied_volatility: 0 }, pe: { implied_volatility: 0 } } });
    const metrics = computeOptionChainMetrics(chain);
    expect(metrics.atmIv).toBeNull();
  });
});

describe("computeOptionChainMetrics — IV Rank & Percentile", () => {
  it("computes rank as the position of current IV within the historical min/max range", () => {
    const chain = buildChain(100, { "100": { ce: { implied_volatility: 20 }, pe: { implied_volatility: 20 } } });
    // History range 10-30, current ATM IV = 20 -> rank should be 50%
    const metrics = computeOptionChainMetrics(chain, [10, 15, 20, 25, 30]);
    expect(metrics.ivRank).toBeCloseTo(50, 0);
  });

  it("computes percentile as the fraction of history at or below current IV", () => {
    const chain = buildChain(100, { "100": { ce: { implied_volatility: 20 }, pe: { implied_volatility: 20 } } });
    // 3 of 5 history values (10, 15, 20) are <= 20 -> 60th percentile
    const metrics = computeOptionChainMetrics(chain, [10, 15, 20, 25, 30]);
    expect(metrics.ivPercentile).toBeCloseTo(60, 0);
  });

  it("returns null rank/percentile when no IV history is supplied", () => {
    const chain = buildChain(100, { "100": { ce: { implied_volatility: 20 }, pe: { implied_volatility: 20 } } });
    const metrics = computeOptionChainMetrics(chain);
    expect(metrics.ivRank).toBeNull();
    expect(metrics.ivPercentile).toBeNull();
  });
});
