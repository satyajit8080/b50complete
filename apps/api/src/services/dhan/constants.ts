/** DhanHQ exchange segment identifiers, as used in API request bodies */
export const DhanExchangeSegment = {
  NSE_EQ: "NSE_EQ",
  NSE_FNO: "NSE_FNO",
  NSE_CURRENCY: "NSE_CURRENCY",
  BSE_EQ: "BSE_EQ",
  BSE_FNO: "BSE_FNO",
  MCX_COMM: "MCX_COMM",
  IDX_I: "IDX_I", // indices (Nifty, Sensex, Bank Nifty, etc.)
} as const;
export type DhanExchangeSegment = (typeof DhanExchangeSegment)[keyof typeof DhanExchangeSegment];

export const DhanInstrumentType = {
  EQUITY: "EQUITY",
  FUTIDX: "FUTIDX",
  OPTIDX: "OPTIDX",
  FUTSTK: "FUTSTK",
  OPTSTK: "OPTSTK",
  INDEX: "INDEX",
} as const;
export type DhanInstrumentType = (typeof DhanInstrumentType)[keyof typeof DhanInstrumentType];

export const DhanInterval = {
  ONE_MIN: "1",
  FIVE_MIN: "5",
  FIFTEEN_MIN: "15",
  TWENTY_FIVE_MIN: "25",
  SIXTY_MIN: "60",
} as const;
export type DhanInterval = (typeof DhanInterval)[keyof typeof DhanInterval];

/** Well-known index security IDs on NSE (IDX_I segment) */
export const DHAN_INDEX_IDS = {
  NIFTY_50: "13",
  NIFTY_BANK: "25",
  NIFTY_FIN_SERVICE: "27",
  NIFTY_MIDCAP_SELECT: "442",
  INDIA_VIX: "21",
} as const;
