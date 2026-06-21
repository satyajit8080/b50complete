import { ResilientHttpClient } from "../../lib/resilientHttpClient.js";
import { cached, CACHE_TTL } from "../../lib/cache.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import type {
  FinEdgeCompanyProfile,
  FinEdgeFinancialStatement,
  FinEdgeRatios,
  FinEdgeShareholdingPattern,
  FinEdgeCorporateAction,
} from "./types.js";

const FINEDGE_BASE_URL = "https://data.finedgeapi.com/api/v1";

/**
 * FinEdge API client — Indian company fundamentals (P&L, Balance Sheet,
 * Cash Flow, Ratios, Shareholding, Corporate Actions).
 *
 * Auth: token passed as a query parameter on every request (per Satya).
 *
 * IMPORTANT: endpoint paths below are scaffolded with the confirmed base
 * URL and auth scheme, but exact paths/response shapes are placeholders
 * (marked TODO) until real endpoint docs are provided. Each method's cache
 * key, TTL, and error handling are already correct — only the `path` and
 * response type need updating per endpoint.
 */
export class FinEdgeClient {
  private http: ResilientHttpClient;

  constructor() {
    if (!env.FINEDGE_API_KEY) {
      logger.warn("FinEdgeClient initialized without FINEDGE_API_KEY — calls will fail until it's set");
    }
    this.http = new ResilientHttpClient({
      name: "FINEDGE",
      baseUrl: FINEDGE_BASE_URL,
      timeoutMs: 10_000,
      maxRetries: 2,
      circuitFailureThreshold: 5,
      circuitResetMs: 30_000,
    });
  }

  getCircuitState() {
    return this.http.getCircuitState();
  }

  private authQuery() {
    return { token: env.FINEDGE_API_KEY ?? "" };
  }

  // TODO: confirm exact path — placeholder based on REST convention
  async getCompanyProfile(symbol: string): Promise<FinEdgeCompanyProfile> {
    const key = `finedge:profile:${symbol}`;
    return cached(key, { ttlSeconds: CACHE_TTL.FUNDAMENTALS }, () =>
      this.http.request<FinEdgeCompanyProfile>({
        method: "GET",
        path: `/company/${symbol}/profile`,
        query: this.authQuery(),
      })
    );
  }

  // TODO: confirm exact path and whether period is quarterly/annual query param
  async getFinancialStatement(
    symbol: string,
    statementType: "profit-loss" | "balance-sheet" | "cash-flow",
    period: "quarterly" | "annual" = "annual"
  ): Promise<FinEdgeFinancialStatement> {
    const key = `finedge:statement:${symbol}:${statementType}:${period}`;
    return cached(key, { ttlSeconds: CACHE_TTL.FUNDAMENTALS }, () =>
      this.http.request<FinEdgeFinancialStatement>({
        method: "GET",
        path: `/company/${symbol}/${statementType}`,
        query: { ...this.authQuery(), period },
      })
    );
  }

  // TODO: confirm exact path
  async getRatios(symbol: string): Promise<FinEdgeRatios> {
    const key = `finedge:ratios:${symbol}`;
    return cached(key, { ttlSeconds: CACHE_TTL.FUNDAMENTALS }, () =>
      this.http.request<FinEdgeRatios>({
        method: "GET",
        path: `/company/${symbol}/ratios`,
        query: this.authQuery(),
      })
    );
  }

  // TODO: confirm exact path
  async getShareholdingPattern(symbol: string): Promise<FinEdgeShareholdingPattern> {
    const key = `finedge:shareholding:${symbol}`;
    return cached(key, { ttlSeconds: CACHE_TTL.FUNDAMENTALS }, () =>
      this.http.request<FinEdgeShareholdingPattern>({
        method: "GET",
        path: `/company/${symbol}/shareholding`,
        query: this.authQuery(),
      })
    );
  }

  // TODO: confirm exact path
  async getCorporateActions(symbol: string): Promise<FinEdgeCorporateAction[]> {
    const key = `finedge:corpactions:${symbol}`;
    return cached(key, { ttlSeconds: CACHE_TTL.CORPORATE_ACTIONS }, () =>
      this.http.request<FinEdgeCorporateAction[]>({
        method: "GET",
        path: `/company/${symbol}/corporate-actions`,
        query: this.authQuery(),
      })
    );
  }

  /**
   * Generic escape hatch: call any FinEdge endpoint by raw path while
   * specific methods above are being filled in with confirmed docs.
   */
  async raw<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const key = `finedge:raw:${path}:${JSON.stringify(query ?? {})}`;
    return cached(key, { ttlSeconds: CACHE_TTL.FUNDAMENTALS }, () =>
      this.http.request<T>({
        method: "GET",
        path,
        query: { ...this.authQuery(), ...query },
      })
    );
  }
}

export const finEdgeClient = new FinEdgeClient();
