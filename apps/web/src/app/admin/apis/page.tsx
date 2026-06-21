"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi, type ExternalApiStatus } from "@/lib/adminApi";
import { Panel, Button, ErrorBanner } from "@/components/admin/Primitives";
import { CircuitIndicator } from "@/components/admin/CircuitIndicator";

export default function ExternalApisPage() {
  const [status, setStatus] = useState<ExternalApiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await adminApi.getExternalApiStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg text-zinc-100">External APIs</h1>
          <p className="text-xs text-muted mt-1">DhanHQ and FinEdge circuit breaker state.</p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      <Panel title="Circuit Breakers">
        {status ? (
          <div className="space-y-3">
            <CircuitIndicator state={status.dhan.circuitState} label="DhanHQ" />
            <CircuitIndicator state={status.finedge.circuitState} label="FinEdge" />
          </div>
        ) : (
          <p className="text-xs text-muted">{loading ? "Loading…" : "No data"}</p>
        )}
      </Panel>

      <Panel title="What these states mean">
        <ul className="space-y-1.5 text-xs text-zinc-400">
          <li>
            <span className="text-up">CLOSED</span> — healthy, requests flow normally.
          </li>
          <li>
            <span className="text-warn">HALF_OPEN</span> — recovering from failures, sending limited probe requests.
          </li>
          <li>
            <span className="text-down">OPEN</span> — failing repeatedly, requests rejected without calling the upstream
            for a 30s cooldown.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
