import { CircuitBreaker } from "./circuitBreaker.js";
import { ExternalApiError, CircuitOpenError } from "./errors.js";
import { logger } from "./logger.js";

export interface ResilientClientOptions {
  name: "DHAN" | "FINEDGE";
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Set false for endpoints where retrying a non-idempotent action would be unsafe */
  idempotent?: boolean;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  // 429 (rate limited), 502/503/504 (upstream availability) are worth retrying.
  // 4xx other than 429 are client errors — retrying won't help.
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Shared resilient HTTP client used by both the DhanHQ and FinEdge service
 * clients. Handles timeouts, exponential backoff retry, and circuit breaking
 * so each individual service doesn't need to reimplement this.
 */
export class ResilientHttpClient {
  private breaker: CircuitBreaker;
  private timeoutMs: number;
  private maxRetries: number;
  private retryBaseDelayMs: number;

  constructor(private opts: ResilientClientOptions) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 500;
    this.breaker = new CircuitBreaker({
      name: opts.name,
      failureThreshold: opts.circuitFailureThreshold ?? 5,
      resetTimeoutMs: opts.circuitResetMs ?? 30_000,
      halfOpenMaxAttempts: 1,
    });
  }

  getCircuitState() {
    return this.breaker.getState();
  }

  async request<T>(options: RequestOptions): Promise<T> {
    if (!this.breaker.canRequest()) {
      throw new CircuitOpenError(this.opts.name);
    }

    const url = this.buildUrl(options.path, options.query);
    const idempotent = options.idempotent ?? true;
    let lastError: ExternalApiError | null = null;

    const attempts = idempotent ? this.maxRetries + 1 : 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        const delay = this.retryBaseDelayMs * 2 ** (attempt - 1) + Math.random() * 100;
        logger.warn({ source: this.opts.name, attempt, delay }, "Retrying external API call");
        await sleep(delay);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, {
          method: options.method ?? "GET",
          headers: { "Content-Type": "application/json", ...options.headers },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          const retryable = isRetryableStatus(res.status);
          const text = await res.text().catch(() => "");
          lastError = new ExternalApiError(
            this.opts.name,
            res.status,
            `${this.opts.name} API error ${res.status}: ${text.slice(0, 300)}`,
            retryable
          );
          if (!retryable) {
            this.breaker.onFailure();
            throw lastError;
          }
          continue; // retryable — loop again
        }

        this.breaker.onSuccess();
        return (await res.json()) as T;
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof ExternalApiError) throw err;

        const isAbort = err instanceof Error && err.name === "AbortError";
        lastError = new ExternalApiError(
          this.opts.name,
          null,
          isAbort ? `${this.opts.name} request timed out after ${this.timeoutMs}ms` : `${this.opts.name} network error: ${(err as Error).message}`,
          true
        );
        // network/timeout errors are retryable, loop continues
      }
    }

    this.breaker.onFailure();
    throw lastError ?? new ExternalApiError(this.opts.name, null, "Unknown error", false);
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(path.startsWith("http") ? path : `${this.opts.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}
