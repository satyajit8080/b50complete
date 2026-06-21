import { ResilientHttpClient } from "../../lib/resilientHttpClient.js";
import { cached, CACHE_TTL } from "../../lib/cache.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import type {
  MarketFeedRequest,
  MarketFeedResponse,
  LtpData,
  OhlcData,
  QuoteData,
  OptionChainRequest,
  OptionChainResponse,
  ExpiryListResponse,
  HistoricalDailyRequest,
  HistoricalIntradayRequest,
  HistoricalCandleResponse,
} from "./types.js";

const DHAN_BASE_URL = "https://api.dhan.co/v2";

/**
 * DhanHQ v2 API client.
 * Docs: https://dhanhq.co/docs/v2/
 *
 * Rate limits enforced by Dhan (not just us):
 *  - Market Quote (LTP/OHLC/Quote): 1 request/second, up to 1000 instruments per call
 *  - Option Chain: 1 request per 3 seconds per unique (underlying, expiry)
 *  - Historical: max 90-day window per intraday call
 */
export class DhanClient {
  private http: ResilientHttpClient;

  constructor() {
    if (!env.DHAN_CLIENT_ID || !env.DHAN_ACCESS_TOKEN) {
      logger.warn("DhanClient initialized without credentials — calls will fail until DHAN_CLIENT_ID/DHAN_ACCESS_TOKEN are set");
    }
    this.http = new ResilientHttpClient({
      name: "DHAN",
      baseUrl: DHAN_BASE_URL,
      timeoutMs: 8000,
      maxRetries: 2,
      circuitFailureThreshold: 5,
      circuitResetMs: 30_000,
    });
  }

  private authHeaders(): Record<string, string> {
    return {
      "access-token": env.DHAN_ACCESS_TOKEN ?? "",
      "client-id": env.DHAN_CLIENT_ID ?? "",
    };
  }

  getCircuitState() {
    return this.http.getCircuitState();
  }

  // ---- Market Quote ----

  async getLtp(segments: MarketFeedRequest): Promise<MarketFeedResponse<LtpData>> {
    const key = `dhan:ltp:${JSON.stringify(segments)}`;
    return cached(key, { ttlSeconds: CACHE_TTL.LTP }, () =>
      this.http.request<MarketFeedResponse<LtpData>>({
        method: "POST",
        path: "/marketfeed/ltp",
        headers: this.authHeaders(),
        body: segments,
      })
    );
  }

  async getOhlc(segments: MarketFeedRequest): Promise<MarketFeedResponse<OhlcData>> {
    const key = `dhan:ohlc:${JSON.stringify(segments)}`;
    return cached(key, { ttlSeconds: CACHE_TTL.LTP }, () =>
      this.http.request<MarketFeedResponse<OhlcData>>({
        method: "POST",
        path: "/marketfeed/ohlc",
        headers: this.authHeaders(),
        body: segments,
      })
    );
  }

  async getQuote(segments: MarketFeedRequest): Promise<MarketFeedResponse<QuoteData>> {
    const key = `dhan:quote:${JSON.stringify(segments)}`;
    return cached(key, { ttlSeconds: CACHE_TTL.QUOTE }, () =>
      this.http.request<MarketFeedResponse<QuoteData>>({
        method: "POST",
        path: "/marketfeed/quote",
        headers: this.authHeaders(),
        body: segments,
      })
    );
  }

  // ---- Option Chain ----

  async getOptionChain(req: OptionChainRequest): Promise<OptionChainResponse> {
    const key = `dhan:optionchain:${req.UnderlyingScrip}:${req.UnderlyingSeg}:${req.Expiry}`;
    return cached(key, { ttlSeconds: CACHE_TTL.OPTION_CHAIN }, () =>
      this.http.request<OptionChainResponse>({
        method: "POST",
        path: "/optionchain",
        headers: this.authHeaders(),
        body: req,
      })
    );
  }

  async getExpiryList(underlyingScrip: number, underlyingSeg: string): Promise<ExpiryListResponse> {
    const key = `dhan:expirylist:${underlyingScrip}:${underlyingSeg}`;
    return cached(key, { ttlSeconds: 3600 }, () =>
      this.http.request<ExpiryListResponse>({
        method: "POST",
        path: "/optionchain/expirylist",
        headers: this.authHeaders(),
        body: { UnderlyingScrip: underlyingScrip, UnderlyingSeg: underlyingSeg },
      })
    );
  }

  // ---- Historical Data ----

  async getHistoricalDaily(req: HistoricalDailyRequest): Promise<HistoricalCandleResponse> {
    const key = `dhan:hist:daily:${req.securityId}:${req.exchangeSegment}:${req.fromDate}:${req.toDate}`;
    return cached(key, { ttlSeconds: CACHE_TTL.HISTORICAL_DAILY }, () =>
      this.http.request<HistoricalCandleResponse>({
        method: "POST",
        path: "/charts/historical",
        headers: this.authHeaders(),
        body: req,
      })
    );
  }

  async getHistoricalIntraday(req: HistoricalIntradayRequest): Promise<HistoricalCandleResponse> {
    const key = `dhan:hist:intraday:${req.securityId}:${req.interval}:${req.fromDate}:${req.toDate}`;
    return cached(key, { ttlSeconds: CACHE_TTL.HISTORICAL_INTRADAY }, () =>
      this.http.request<HistoricalCandleResponse>({
        method: "POST",
        path: "/charts/intraday",
        headers: this.authHeaders(),
        body: req,
      })
    );
  }
}

export const dhanClient = new DhanClient();
