import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { invalidateCache } from "../../lib/cache.js";
import { parseCsv, normalizeInstrumentRow } from "./instrumentSyncParser.js";

// Re-exported so existing imports of these from "./instrumentSync.js" keep
// working unchanged — the actual parsing logic now lives in
// instrumentSyncParser.ts (zero side-effecting imports, fully
// unit-testable without DB/Redis setup).
export { parseCsv, splitCsvLine, pick, normalizeSegment, COLUMN_ALIASES } from "./instrumentSyncParser.js";

const SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv";

export interface InstrumentSyncResult {
  totalRows: number;
  upserted: number;
  skipped: number;
  durationMs: number;
}

export async function syncInstrumentMaster(): Promise<InstrumentSyncResult> {
  const start = Date.now();
  logger.info("Starting instrument master sync");

  const res = await fetch(SCRIP_MASTER_URL);
  if (!res.ok) {
    throw new Error(`Failed to download Dhan scrip master: HTTP ${res.status}`);
  }
  const csvText = await res.text();
  const rows = parseCsv(csvText);

  logger.info({ totalRows: rows.length }, "Scrip master downloaded and parsed");

  let upserted = 0;
  let skipped = 0;
  const BATCH_SIZE = 500;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const operations = [];

    for (const row of batch) {
      const normalized = normalizeInstrumentRow(row);
      if (!normalized) {
        skipped++;
        continue;
      }

      const { securityId, symbol, exchangeSegment, instrumentType, lotSize, tickSize } = normalized;

      operations.push(
        prisma.instrument.upsert({
          where: { securityId },
          create: { securityId, symbol, exchangeSegment, instrumentType, lotSize, tickSize, isActive: true },
          update: { symbol, exchangeSegment, instrumentType, lotSize, tickSize, isActive: true },
        })
      );
    }

    if (operations.length) {
      await prisma.$transaction(operations);
      upserted += operations.length;
    }
  }

  // Symbol search/lookup cache is now stale for anything that changed — clear it.
  await invalidateCache("instrument:", true);

  const result: InstrumentSyncResult = {
    totalRows: rows.length,
    upserted,
    skipped,
    durationMs: Date.now() - start,
  };

  logger.info(result, "Instrument master sync complete");
  return result;
}
