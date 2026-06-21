import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker } from "./circuitBreaker.js";

function makeBreaker(overrides: Partial<{ failureThreshold: number; resetTimeoutMs: number; halfOpenMaxAttempts: number }> = {}) {
  return new CircuitBreaker({
    name: "TEST",
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    halfOpenMaxAttempts: 1,
    ...overrides,
  });
}

describe("CircuitBreaker — CLOSED state", () => {
  it("starts CLOSED and allows requests", () => {
    const cb = makeBreaker();
    expect(cb.getState()).toBe("CLOSED");
    expect(cb.canRequest()).toBe(true);
  });

  it("stays CLOSED below the failure threshold", () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    cb.onFailure();
    cb.onFailure();
    expect(cb.getState()).toBe("CLOSED");
    expect(cb.canRequest()).toBe(true);
  });

  it("a success resets the consecutive failure count", () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    cb.onFailure();
    cb.onFailure();
    cb.onSuccess();
    cb.onFailure();
    cb.onFailure();
    // Only 2 consecutive failures since the success reset the counter — still CLOSED
    expect(cb.getState()).toBe("CLOSED");
  });
});

describe("CircuitBreaker — trips to OPEN", () => {
  it("opens after reaching the failure threshold", () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    cb.onFailure();
    cb.onFailure();
    cb.onFailure();
    expect(cb.getState()).toBe("OPEN");
    expect(cb.canRequest()).toBe(false);
  });
});

describe("CircuitBreaker — OPEN to HALF_OPEN transition", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays OPEN before the reset timeout elapses", () => {
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.onFailure();
    expect(cb.getState()).toBe("OPEN");

    vi.advanceTimersByTime(500);
    expect(cb.getState()).toBe("OPEN");
    expect(cb.canRequest()).toBe(false);
  });

  it("transitions to HALF_OPEN once the reset timeout elapses", () => {
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.onFailure();
    expect(cb.getState()).toBe("OPEN");

    vi.advanceTimersByTime(1001);
    expect(cb.getState()).toBe("HALF_OPEN");
  });

  it("allows a probe request in HALF_OPEN", () => {
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, halfOpenMaxAttempts: 1 });
    cb.onFailure();
    vi.advanceTimersByTime(1001);
    expect(cb.canRequest()).toBe(true);
  });
});

describe("CircuitBreaker — HALF_OPEN resolution", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a success in HALF_OPEN fully closes the circuit", () => {
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.onFailure();
    vi.advanceTimersByTime(1001);
    expect(cb.getState()).toBe("HALF_OPEN");

    cb.onSuccess();
    expect(cb.getState()).toBe("CLOSED");
    expect(cb.canRequest()).toBe(true);
  });

  it("a failure in HALF_OPEN re-opens the circuit immediately", () => {
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.onFailure();
    vi.advanceTimersByTime(1001);
    expect(cb.getState()).toBe("HALF_OPEN");

    cb.onFailure();
    expect(cb.getState()).toBe("OPEN");
    expect(cb.canRequest()).toBe(false);
  });

  it("re-opening from HALF_OPEN restarts the full reset timeout", () => {
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.onFailure();
    vi.advanceTimersByTime(1001); // -> HALF_OPEN
    cb.onFailure(); // -> OPEN again, new 1000ms timer starts now

    vi.advanceTimersByTime(999);
    expect(cb.getState()).toBe("OPEN"); // not yet — would fail if the timer hadn't restarted

    vi.advanceTimersByTime(2);
    expect(cb.getState()).toBe("HALF_OPEN");
  });

  /**
   * KNOWN LATENT BUG, documented rather than silently worked around:
   * canRequest() does not itself increment halfOpenAttempts — only
   * onFailure() does. So a caller that checks canRequest() repeatedly
   * without an intervening onSuccess/onFailure call (e.g. two concurrent
   * requests checking the gate before either resolves) will see
   * canRequest() return true more than halfOpenMaxAttempts times in
   * HALF_OPEN. In practice this is low-risk for Bull50's usage (the
   * resilient HTTP client always calls onSuccess/onFailure immediately
   * after each request, serialized per call), but it's a real gap if the
   * breaker is ever read from multiple concurrent call sites before any
   * of them resolve. Flagging here so it isn't silently relied upon as a
   * hard concurrency guarantee.
   */
  it("documents that canRequest() alone does not consume a half-open attempt slot", () => {
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, halfOpenMaxAttempts: 1 });
    cb.onFailure();
    vi.advanceTimersByTime(1001);

    // Checking canRequest() multiple times without resolving any of them
    // does NOT exhaust the half-open attempt budget — this is the gap.
    expect(cb.canRequest()).toBe(true);
    expect(cb.canRequest()).toBe(true);
    expect(cb.canRequest()).toBe(true);
  });
});
