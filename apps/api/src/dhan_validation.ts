/**
 * Live credential validation for DhanHQ.
 * Pings a lightweight endpoint (expiry list for Nifty) to confirm
 * DHAN_CLIENT_ID + DHAN_ACCESS_TOKEN are accepted by the API.
 * Returns structured result — never throws — so callers decide how to surface it.
 */
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

const DHAN_BASE = "https://api.dhan.co/v2";

export interface DhanValidationResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  credentialsMissing?: boolean;
}

export async function validateDhanCredentials(): Promise<DhanValidationResult> {
  if (!env.DHAN_CLIENT_ID || !env.DHAN_ACCESS_TOKEN) {
    return { ok: false, latencyMs: 0, credentialsMissing: true, error: "DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not set" };
  }

  const start = Date.now();
  try {
    const res = await fetch(`${DHAN_BASE}/optionchain/expirylist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "access-token": env.DHAN_ACCESS_TOKEN,
        "client-id": env.DHAN_CLIENT_ID,
      },
      // Nifty 50 index — always exists
      body: JSON.stringify({ UnderlyingScrip: 13, UnderlyingSeg: "IDX_I" }),
      signal: AbortSignal.timeout(8000),
    });

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, body: text.slice(0, 200) }, "Dhan credential validation failed");
      return { ok: false, latencyMs, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json() as { status?: string; data?: unknown };
    if (data.status === "failure") {
      return { ok: false, latencyMs, error: "Dhan returned status:failure — token may be expired" };
    }

    logger.info({ latencyMs }, "Dhan credentials validated successfully");
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
  }
}
