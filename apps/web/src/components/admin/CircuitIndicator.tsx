import type { CircuitState } from "@/lib/adminApi";

const STATES: CircuitState[] = ["CLOSED", "HALF_OPEN", "OPEN"];

const STATE_COLOR: Record<CircuitState, string> = {
  CLOSED: "bg-up",
  HALF_OPEN: "bg-warn",
  OPEN: "bg-down",
};

/**
 * Three squares, one per circuit breaker state, with the active one
 * filled and the others dim outlines. Encodes the actual state machine
 * (CLOSED -> HALF_OPEN -> OPEN) rather than a single colored dot, so the
 * shape itself communicates "this is a 3-state system" at a glance.
 */
export function CircuitIndicator({ state, label }: { state: CircuitState; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-zinc-300 w-20">{label}</span>
      <div className="flex gap-1">
        {STATES.map((s) => (
          <div
            key={s}
            title={s}
            className={`h-3 w-3 ${s === state ? STATE_COLOR[s] : "bg-transparent border border-border"}`}
          />
        ))}
      </div>
      <span className="text-xs font-mono text-muted">{state}</span>
    </div>
  );
}
