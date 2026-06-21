export class ExternalApiError extends Error {
  constructor(
    public source: "DHAN" | "FINEDGE",
    public statusCode: number | null,
    message: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = "ExternalApiError";
  }
}

export class CircuitOpenError extends Error {
  constructor(public source: string) {
    super(`Circuit breaker is OPEN for ${source} — request rejected without calling upstream`);
    this.name = "CircuitOpenError";
  }
}

export class RateLimitExceededError extends Error {
  constructor(public source: string, public retryAfterMs: number) {
    super(`Rate limit exceeded for ${source}, retry after ${retryAfterMs}ms`);
    this.name = "RateLimitExceededError";
  }
}
