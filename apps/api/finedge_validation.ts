/**
 * Live credential validation for FinEdge.
 * Hits the base URL with the API key to confirm connectivity.
 * Since FinEdge endpoint paths are still TODO, we just verify the key
 * is accepted at all — a 401/403 means bad key, 200/404 means key is valid.
 */
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

const FINEDGE_BASE = "https://data.finedgeapi.com/api/v1";

export interface FinEdgeValidationResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  credentialsMissing?: boolean;
  note?: string;
}

export async function validateFinEdgeCredentials(): Promise<FinEdgeValidationResult> {
  if (!env.FINEDGE_API_KEY) {
    return { ok: false, latencyMs: 0, credentialsMissing: true, error: "FINEDGE_API_KEY not set" };
  }

  const start = Date.now();
  try {
    // Try a lightweight endpoint — 404 is fine (key accepted, path unknown),
    // 401/403 means the key is rejected.
    const url = new URL(`${FINEDGE_BASE}/ping`);
    url.searchParams.set("token", env.FINEDGE_API_KEY);

    const res = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });

    const latencyMs = Date.now() - start;

    if (res.status === 401 || res.status === 403) {
      return { ok: false, latencyMs, error: `Auth rejected: HTTP ${res.status} — check FINEDGE_API_KEY` };
    }

    // Any non-auth response means the key is at least accepted
    logger.info({ latencyMs, status: res.status }, "FinEdge credentials validated (key accepted)");
    return {
      ok: true,
      latencyMs,
      note: res.status === 404
        ? "Key accepted — /ping endpoint not found (normal, endpoint paths are being confirmed)"
        : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
  }
}
