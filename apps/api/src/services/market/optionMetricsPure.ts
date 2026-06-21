import type { OptionChainResponse } from "../dhan/types.js";

export interface OptionChainMetrics {
  putCallRatio: number;
  maxPainStrike: number;
  totalCallOi: number;
  totalPutOi: number;
  callOiChange: number;
  putOiChange: number;
  atmIv: number | null;
  ivRank: number | null;
  ivPercentile: number | null;
}

/**
 * Computes derived metrics from a single option chain snapshot. Max Pain
 * is the strike at which option writers (sellers) collectively lose the
 * least — i.e. where total intrinsic value paid out to buyers is minimized.
 *
 * Deliberately a pure function with zero side-effecting imports (no Dhan
 * client, no cache, no DB) so it's testable in isolation — see
 * optionMetrics.test.ts.
 */
export function computeOptionChainMetrics(chain: OptionChainResponse, ivHistory?: number[]): OptionChainMetrics {
  const strikes = Object.entries(chain.data.oc);

  let totalCallOi = 0;
  let totalPutOi = 0;
  let callOiChange = 0;
  let putOiChange = 0;

  for (const [, leg] of strikes) {
    if (leg.ce) {
      totalCallOi += leg.ce.oi;
      callOiChange += leg.ce.oi - leg.ce.previous_oi;
    }
    if (leg.pe) {
      totalPutOi += leg.pe.oi;
      putOiChange += leg.pe.oi - leg.pe.previous_oi;
    }
  }

  // Max pain: for each candidate expiry strike, sum intrinsic value owed
  // to all ITM call and put holders if settlement happened at that strike.
  // The strike minimizing this sum is where option writers face least payout.
  const painByStrike: { strike: number; pain: number }[] = [];
  for (const [candidateStrikeStr] of strikes) {
    const candidateStrike = Number(candidateStrikeStr);
    let totalPain = 0;

    for (const [strikeStr, leg] of strikes) {
      const strike = Number(strikeStr);
      if (leg.ce && candidateStrike > strike) {
        totalPain += (candidateStrike - strike) * leg.ce.oi;
      }
      if (leg.pe && candidateStrike < strike) {
        totalPain += (strike - candidateStrike) * leg.pe.oi;
      }
    }
    painByStrike.push({ strike: candidateStrike, pain: totalPain });
  }

  const maxPainEntry = painByStrike.reduce(
    (min, curr) => (curr.pain < min.pain ? curr : min),
    painByStrike[0] ?? { strike: 0, pain: Infinity }
  );

  // ATM IV: find the strike closest to the underlying's last price, average its CE/PE IV.
  const lastPrice = chain.data.last_price;
  const atmStrike = strikes.reduce<string | undefined>((closest, [strikeStr]) => {
    if (closest === undefined) return strikeStr;
    const strike = Number(strikeStr);
    const closestStrike = Number(closest);
    return Math.abs(strike - lastPrice) < Math.abs(closestStrike - lastPrice) ? strikeStr : closest;
  }, undefined);

  const atmLeg = atmStrike ? chain.data.oc[atmStrike] : undefined;
  const atmIvValues = [atmLeg?.ce?.implied_volatility, atmLeg?.pe?.implied_volatility].filter(
    (v): v is number => typeof v === "number" && v > 0
  );
  const atmIv = atmIvValues.length ? atmIvValues.reduce((a, b) => a + b, 0) / atmIvValues.length : null;

  let ivRank: number | null = null;
  let ivPercentile: number | null = null;
  if (atmIv !== null && ivHistory && ivHistory.length > 0) {
    const min = Math.min(...ivHistory);
    const max = Math.max(...ivHistory);
    ivRank = max > min ? ((atmIv - min) / (max - min)) * 100 : null;
    const below = ivHistory.filter((v) => v <= atmIv).length;
    ivPercentile = (below / ivHistory.length) * 100;
  }

  return {
    putCallRatio: totalCallOi > 0 ? Number((totalPutOi / totalCallOi).toFixed(2)) : 0,
    maxPainStrike: maxPainEntry.strike,
    totalCallOi,
    totalPutOi,
    callOiChange,
    putOiChange,
    atmIv: atmIv !== null ? Number(atmIv.toFixed(2)) : null,
    ivRank: ivRank !== null ? Number(ivRank.toFixed(1)) : null,
    ivPercentile: ivPercentile !== null ? Number(ivPercentile.toFixed(1)) : null,
  };
}
