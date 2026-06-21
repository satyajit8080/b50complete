import { logger } from "./logger.js";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number; // consecutive failures before opening
  resetTimeoutMs: number; // how long to stay OPEN before trying again
  halfOpenMaxAttempts: number; // probe requests allowed in HALF_OPEN
}

/**
 * Per-API circuit breaker. When an upstream (DhanHQ/FinEdge) starts failing
 * repeatedly, this stops sending requests for a cooldown period instead of
 * piling up timeouts, then sends a few probe requests to check recovery.
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private nextAttemptAt = 0;
  private halfOpenAttempts = 0;

  constructor(private opts: CircuitBreakerOptions) {}

  getState(): CircuitState {
    if (this.state === "OPEN" && Date.now() >= this.nextAttemptAt) {
      this.state = "HALF_OPEN";
      this.halfOpenAttempts = 0;
      logger.warn({ circuit: this.opts.name }, "Circuit breaker entering HALF_OPEN");
    }
    return this.state;
  }

  canRequest(): boolean {
    const state = this.getState();
    if (state === "CLOSED") return true;
    if (state === "HALF_OPEN") return this.halfOpenAttempts < this.opts.halfOpenMaxAttempts;
    return false; // OPEN
  }

  onSuccess() {
    if (this.state === "HALF_OPEN") {
      logger.info({ circuit: this.opts.name }, "Circuit breaker recovered — closing");
    }
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.halfOpenAttempts = 0;
  }

  onFailure() {
    if (this.state === "HALF_OPEN") {
      this.halfOpenAttempts++;
      this.trip();
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.opts.failureThreshold) {
      this.trip();
    }
  }

  private trip() {
    this.state = "OPEN";
    this.nextAttemptAt = Date.now() + this.opts.resetTimeoutMs;
    logger.error(
      { circuit: this.opts.name, resetAt: new Date(this.nextAttemptAt).toISOString() },
      "Circuit breaker OPEN — upstream API failing repeatedly"
    );
  }
}
