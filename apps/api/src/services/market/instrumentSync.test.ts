import { describe, it, expect } from "vitest";
import { parseCsv, splitCsvLine, pick, normalizeSegment, COLUMN_ALIASES } from "./instrumentSyncParser.js";

describe("splitCsvLine", () => {
  it("splits a simple comma-separated line", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace around fields", () => {
    expect(splitCsvLine(" a , b ,c ")).toEqual(["a", "b", "c"]);
  });

  it("handles an empty trailing field", () => {
    expect(splitCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });

  it("keeps commas inside quoted fields intact", () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("handles a line with only one field", () => {
    expect(splitCsvLine("onlyfield")).toEqual(["onlyfield"]);
  });
});

describe("parseCsv", () => {
  it("parses a header row plus data rows into objects", () => {
    const csv = "SEM_SMST_SECURITY_ID,SEM_TRADING_SYMBOL\n1333,HDFCBANK\n11536,RELIANCE";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ SEM_SMST_SECURITY_ID: "1333", SEM_TRADING_SYMBOL: "HDFCBANK" });
    expect(rows[1]).toEqual({ SEM_SMST_SECURITY_ID: "11536", SEM_TRADING_SYMBOL: "RELIANCE" });
  });

  it("returns an empty array for a header-only file (no data rows)", () => {
    expect(parseCsv("SEM_SMST_SECURITY_ID,SEM_TRADING_SYMBOL")).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("skips a malformed row whose field count doesn't match the header — does not misalign columns", () => {
    const csv = "A,B,C\n1,2,3\n4,5\n7,8,9"; // middle row has only 2 fields, should be dropped entirely
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ A: "1", B: "2", C: "3" });
    expect(rows[1]).toEqual({ A: "7", B: "8", C: "9" });
  });

  it("handles both LF and CRLF line endings identically", () => {
    const csvUnix = "A,B\n1,2\n3,4";
    const csvWindows = "A,B\r\n1,2\r\n3,4";
    expect(parseCsv(csvUnix)).toEqual(parseCsv(csvWindows));
  });

  it("ignores blank lines (e.g. trailing newline at end of file)", () => {
    const csv = "A,B\n1,2\n\n";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
  });
});

describe("pick — column alias resolution", () => {
  it("returns the value for the matching column", () => {
    const row = { SEM_SMST_SECURITY_ID: "1333" };
    expect(pick(row, COLUMN_ALIASES.securityId)).toBe("1333");
  });

  it("falls through to a secondary alias if the primary column is absent", () => {
    const row = { SECURITY_ID: "999" }; // only the fallback alias is present
    expect(pick(row, COLUMN_ALIASES.securityId)).toBe("999");
  });

  it("treats an empty string value as missing, not as a valid value", () => {
    const row = { SEM_SMST_SECURITY_ID: "", SECURITY_ID: "999" };
    expect(pick(row, COLUMN_ALIASES.securityId)).toBe("999");
  });

  it("returns undefined when no alias matches", () => {
    const row = { SOME_OTHER_COLUMN: "x" };
    expect(pick(row, COLUMN_ALIASES.securityId)).toBeUndefined();
  });
});

describe("normalizeSegment", () => {
  it("maps NSE equity short code to NSE_EQ", () => {
    expect(normalizeSegment("NSE", "E")).toBe("NSE_EQ");
  });

  it("maps NSE derivative short code to NSE_FNO", () => {
    expect(normalizeSegment("NSE", "D")).toBe("NSE_FNO");
  });

  it("maps BSE equity short code to BSE_EQ", () => {
    expect(normalizeSegment("BSE", "E")).toBe("BSE_EQ");
  });

  it("maps commodity short code to MCX_COMM", () => {
    expect(normalizeSegment("MCX", "M")).toBe("MCX_COMM");
  });

  it("maps currency short code to NSE_CURRENCY", () => {
    expect(normalizeSegment("NSE", "C")).toBe("NSE_CURRENCY");
  });

  /**
   * Regression test for a real bug found while writing these tests: index
   * rows ("I" segment) were being combined with the exchange prefix
   * (producing "NSE_I"), which never matches SUPPORTED_EXCHANGE_SEGMENTS —
   * only the segment-only "IDX_I" is in that set, matching how indices are
   * keyed everywhere else in the codebase (services/dhan/constants.ts).
   * Before the fix, every index instrument would have silently failed to
   * sync. normalizeSegment now special-cases "I" to always return "IDX_I"
   * regardless of exchange.
   */
  it("normalizes the index segment to IDX_I regardless of exchange (regression test)", () => {
    expect(normalizeSegment("NSE", "I")).toBe("IDX_I");
    expect(normalizeSegment("BSE", "I")).toBe("IDX_I");
  });

  it("returns null for an unsupported exchange+segment combination rather than guessing", () => {
    expect(normalizeSegment("NSE", "X")).toBeNull();
  });

  it("BSE derivative short code maps to BSE_FNO (supported)", () => {
    expect(normalizeSegment("BSE", "D")).toBe("BSE_FNO");
  });

  it("returns null when exchange or segment is missing", () => {
    expect(normalizeSegment(undefined, "E")).toBeNull();
    expect(normalizeSegment("NSE", undefined)).toBeNull();
    expect(normalizeSegment(undefined, undefined)).toBeNull();
  });

  it("returns null for a genuinely unsupported exchange/segment pair (e.g. NSE debt)", () => {
    expect(normalizeSegment("NSE", "G")).toBeNull(); // no short-code mapping for "G", and "NSE_G" isn't supported either
  });
});
