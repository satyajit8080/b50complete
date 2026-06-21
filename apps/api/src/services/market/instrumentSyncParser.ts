/**
 * Maps Dhan's documented CSV column names to our normalized field names.
 * Source: https://dhanhq.co/docs/v2/instruments/ and Dhan community docs.
 *
 * NOTE: a small number of column names (exact ISIN/tick-size headers) were
 * not independently confirmed at build time — this parser is defensive: it
 * looks up several known aliases per field and logs (not throws) when a
 * row is missing an expected column, so a header rename upstream degrades
 * gracefully instead of silently corrupting data or crashing the sync.
 *
 * Everything in this file is a pure function with zero side-effecting
 * imports (no DB, no logger, no network) — fully unit-testable in
 * isolation. See instrumentSync.test.ts.
 */
export const COLUMN_ALIASES = {
  securityId: ["SEM_SMST_SECURITY_ID", "SECURITY_ID"],
  exchange: ["SEM_EXM_EXCH_ID", "EXCH_ID"],
  segment: ["SEM_SEGMENT", "SEGMENT"],
  instrumentType: ["SEM_INSTRUMENT_NAME", "SEM_EXCH_INSTRUMENT_TYPE", "INSTRUMENT_TYPE"],
  tradingSymbol: ["SEM_TRADING_SYMBOL", "TRADING_SYMBOL"],
  customSymbol: ["SEM_CUSTOM_SYMBOL", "SEM_TRADING_SYMBOL"],
  isin: ["SEM_ISIN_CODE", "ISIN"],
  expiryDate: ["SEM_EXPIRY_DATE", "EXPIRY_DATE"],
  strikePrice: ["SEM_STRIKE_PRICE", "STRIKE_PRICE"],
  optionType: ["SEM_OPTION_TYPE", "OPTION_TYPE"],
  lotSize: ["SEM_LOT_UNITS", "LOT_SIZE"],
  tickSize: ["SEM_TICK_SIZE", "TICK_SIZE"],
} as const;

export type ParsedRow = Record<string, string>;

export function pick(row: ParsedRow, aliases: readonly string[]): string | undefined {
  for (const key of aliases) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return undefined;
}

/** Minimal CSV parser — Dhan's scrip master has no embedded commas/quotes in practice, but we handle quoted fields defensively. */
export function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    if (values.length !== headers.length) continue; // malformed row — skip rather than misalign columns
    const row: ParsedRow = {};
    headers.forEach((h, idx) => (row[h] = values[idx]));
    rows.push(row);
  }
  return rows;
}

export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Only sync segments Bull50 actually uses — the full file includes BSE
// debt instruments, currency derivatives we don't support yet, etc.
const SUPPORTED_EXCHANGE_SEGMENTS = new Set(["NSE_EQ", "NSE_FNO", "NSE_CURRENCY", "BSE_EQ", "BSE_FNO", "MCX_COMM", "IDX_I"]);

export function normalizeSegment(exchange: string | undefined, segment: string | undefined): string | null {
  if (!exchange || !segment) return null;
  // Dhan's raw values are short codes (E=Equity, D=Derivative, I=Index, C=Currency, M=Commodity).
  // Index instruments use the segment-only "IDX_I" everywhere else in this
  // codebase (see services/dhan/constants.ts) regardless of which exchange
  // they're listed under — handle that case before the generic
  // exchange-prefixed mapping, or "NSE"+"I" would normalize to "NSE_I",
  // which is never in SUPPORTED_EXCHANGE_SEGMENTS and would silently drop
  // every index row during sync.
  if (segment === "I") return SUPPORTED_EXCHANGE_SEGMENTS.has("IDX_I") ? "IDX_I" : null;

  const segMap: Record<string, string> = { E: "EQ", D: "FNO", C: "CURRENCY", M: "COMM" };
  const mapped = segMap[segment] ?? segment;
  const combined = `${exchange}_${mapped}`;
  return SUPPORTED_EXCHANGE_SEGMENTS.has(combined) ? combined : null;
}

export interface NormalizedInstrumentRow {
  securityId: string;
  symbol: string;
  exchangeSegment: string;
  instrumentType: string;
  lotSize: number | null;
  tickSize: number | null;
}

/**
 * Extracts and normalizes one CSV row into the shape instrumentSync.ts
 * writes to the database, or returns null if required fields are missing.
 * Pulled out as its own pure function so the field-extraction logic (which
 * fields are required, how lot/tick size are coerced) is tested
 * independently of the actual DB upsert.
 */
export function normalizeInstrumentRow(row: ParsedRow): NormalizedInstrumentRow | null {
  const securityId = pick(row, COLUMN_ALIASES.securityId);
  const exchange = pick(row, COLUMN_ALIASES.exchange);
  const segment = pick(row, COLUMN_ALIASES.segment);
  const symbol = pick(row, COLUMN_ALIASES.tradingSymbol) ?? pick(row, COLUMN_ALIASES.customSymbol);
  const instrumentType = pick(row, COLUMN_ALIASES.instrumentType) ?? "UNKNOWN";
  const lotSizeRaw = pick(row, COLUMN_ALIASES.lotSize);
  const tickSizeRaw = pick(row, COLUMN_ALIASES.tickSize);

  const exchangeSegment = normalizeSegment(exchange, segment);

  if (!securityId || !symbol || !exchangeSegment) return null;

  return {
    securityId,
    symbol: symbol.toUpperCase(),
    exchangeSegment,
    instrumentType,
    lotSize: lotSizeRaw ? Math.round(Number(lotSizeRaw)) || null : null,
    tickSize: tickSizeRaw ? Number(tickSizeRaw) || null : null,
  };
}
