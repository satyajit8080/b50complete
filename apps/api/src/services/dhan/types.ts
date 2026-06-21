import type { DhanExchangeSegment, DhanInstrumentType, DhanInterval } from "./constants.js";

// ---- Market Quote (LTP / OHLC / Quote) ----

/** Request body: { "NSE_EQ": [11536], "NSE_FNO": [49081, 49082] } */
export type MarketFeedRequest = Partial<Record<DhanExchangeSegment, number[]>>;

export interface LtpData {
  last_price: number;
}

export interface OhlcData extends LtpData {
  ohlc: { open: number; high: number; low: number; close: number };
}

export interface QuoteData extends OhlcData {
  net_change: number;
  volume: number;
  oi?: number;
  average_price?: number;
  lower_circuit_limit?: number;
  upper_circuit_limit?: number;
  buy_quantity?: number;
  sell_quantity?: number;
}

export interface MarketFeedResponse<T> {
  data: Partial<Record<DhanExchangeSegment, Record<string, T>>>;
  status: "success" | "failure";
}

// ---- Option Chain ----

export interface OptionChainRequest {
  UnderlyingScrip: number;
  UnderlyingSeg: DhanExchangeSegment;
  Expiry: string; // YYYY-MM-DD
}

export interface OptionLeg {
  greeks: { delta: number; theta: number; gamma: number; vega: number };
  implied_volatility: number;
  last_price: number;
  oi: number;
  previous_oi: number;
  previous_close_price: number;
  previous_volume: number;
  top_ask_price: number;
  top_ask_quantity: number;
  top_bid_price: number;
  top_bid_quantity: number;
  volume: number;
  security_id?: string;
  average_price?: number;
}

export interface OptionChainResponse {
  data: {
    last_price: number;
    oc: Record<string, { ce?: OptionLeg; pe?: OptionLeg }>; // keyed by strike price string
  };
  status: "success" | "failure";
}

export interface ExpiryListResponse {
  data: string[]; // ["2026-06-25", "2026-12-31", ...]
  status: "success" | "failure";
}

// ---- Historical Data ----

export interface HistoricalDailyRequest {
  securityId: string;
  exchangeSegment: DhanExchangeSegment;
  instrument: DhanInstrumentType;
  expiryCode?: 0 | 1 | 2 | 3;
  oi?: boolean;
  fromDate: string; // YYYY-MM-DD
  toDate: string;
}

export interface HistoricalIntradayRequest {
  securityId: string;
  exchangeSegment: DhanExchangeSegment;
  instrument: DhanInstrumentType;
  interval: DhanInterval;
  oi?: boolean;
  fromDate: string; // YYYY-MM-DD HH:mm:ss
  toDate: string;
}

export interface HistoricalCandleResponse {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  timestamp: number[]; // unix epoch seconds
  oi?: number[];
}
