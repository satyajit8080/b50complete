import { apiFetch } from "./api";

// Types mirror apps/api/src/openapi/monitoringPaths.ts and the actual
// Prisma models — kept in sync by hand since the web app doesn't share a
// package with the API's zod schemas. If a backend response shape changes,
// this is the file to update.

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ExternalApiStatus {
  dhan: { circuitState: CircuitState };
  finedge: { circuitState: CircuitState };
}

export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface QueueStatus {
  historicalSync: QueueCounts;
  instrumentSync: QueueCounts;
  corporateActionsSync: QueueCounts;
}

export interface RedisStatus {
  status: string;
  connected: boolean;
}

export interface InstrumentSyncLog {
  id: string;
  totalRows: number;
  upserted: number;
  skipped: number;
  durationMs: number;
  triggeredBy: string;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface SectorMapping {
  id: string;
  securityId: string;
  symbol: string;
  sectoralIndex: string;
  sectoralIndexSecurityId: string | null;
  updatedAt: string;
}

export interface FundamentalsManualEntry {
  securityId: string;
  symbol: string;
  periodType: "QUARTERLY" | "ANNUAL" | "TTM";
  periodEndDate: string;
  marketCap?: number;
  enterpriseValue?: number;
  peRatio?: number;
  pbRatio?: number;
  bookValue?: number;
  eps?: number;
  roe?: number;
  roce?: number;
  debtToEquity?: number;
}

export const adminApi = {
  getExternalApiStatus: () => apiFetch<ExternalApiStatus>("/api/monitoring/external-apis"),
  getQueueStatus: () => apiFetch<QueueStatus>("/api/monitoring/queues"),
  getRedisStatus: () => apiFetch<RedisStatus>("/api/monitoring/redis"),

  triggerInstrumentSync: () =>
    apiFetch<{ message: string; jobId: string }>("/api/monitoring/instrument-sync/trigger", { method: "POST" }),
  getInstrumentSyncLogs: (limit = 20) =>
    apiFetch<{ logs: InstrumentSyncLog[] }>(`/api/monitoring/instrument-sync/logs?limit=${limit}`),

  getSectorMappings: () => apiFetch<{ mappings: SectorMapping[] }>("/api/monitoring/sector-mapping"),
  upsertSectorMapping: (input: { securityId: string; symbol: string; sectoralIndex: string; sectoralIndexSecurityId?: string }) =>
    apiFetch<{ mapping: SectorMapping }>("/api/monitoring/sector-mapping", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  submitFundamentals: (input: FundamentalsManualEntry) =>
    apiFetch<{ fundamentals: unknown }>("/api/monitoring/fundamentals/manual-entry", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
