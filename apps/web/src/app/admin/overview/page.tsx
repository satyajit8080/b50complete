"use client";

import { useEffect, useState } from "react";
import { adminApi, type ExternalApiStatus, type QueueStatus, type RedisStatus } from "@/lib/adminApi";
import { Panel, StatBlock, ErrorBanner } from "@/components/admin/Primitives";
import { CircuitIndicator } from "@/components/admin/CircuitIndicator";

export default function AdminOverviewPage() {
  const [apis, setApis] = useState<ExternalApiStatus | null>(null);
  const [queues, setQueues] = useState<QueueStatus | null>(null);
  const [redis, setRedis] = useState<RedisStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [a, q, r] = await Promise.all([adminApi.getExternalApiStatus(), adminApi.getQueueStatus(), adminApi.getRedisStatus()]);
        if (!cancelled) {
          setApis(a);
          setQueues(q);
          setRedis(r);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load system status");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 15_000); // light auto-refresh, not aggressive polling
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const totalFailedJobs = queues
    ? queues.historicalSync.failed + queues.instrumentSync.failed + queues.corporateActionsSync.failed
    : 0;
  const totalActiveJobs = queues
    ? queues.historicalSync.active + queues.instrumentSync.active + queues.corporateActionsSync.active
    : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg text-zinc-100">System Overview</h1>
        <p className="text-xs text-muted mt-1">Auto-refreshes every 15s.</p>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-4 gap-3">
        <StatBlock
          label="Redis"
          value={redis ? (redis.connected ? "connected" : redis.status) : loading ? "…" : "—"}
          tone={redis?.connected ? "up" : "down"}
        />
        <StatBlock label="Active Jobs" value={loading ? "…" : totalActiveJobs} />
        <StatBlock label="Failed Jobs" value={loading ? "…" : totalFailedJobs} tone={totalFailedJobs > 0 ? "down" : "default"} />
        <StatBlock
          label="Upstream APIs"
          value={
            apis
              ? apis.dhan.circuitState === "CLOSED" && apis.finedge.circuitState === "CLOSED"
                ? "healthy"
                : "degraded"
              : loading
                ? "…"
                : "—"
          }
          tone={apis ? (apis.dhan.circuitState === "CLOSED" && apis.finedge.circuitState === "CLOSED" ? "up" : "warn") : "default"}
        />
      </div>

      <Panel title="External API Circuit Breakers">
        {apis ? (
          <div className="space-y-2">
            <CircuitIndicator state={apis.dhan.circuitState} label="DhanHQ" />
            <CircuitIndicator state={apis.finedge.circuitState} label="FinEdge" />
          </div>
        ) : (
          <p className="text-xs text-muted">{loading ? "Loading…" : "No data"}</p>
        )}
      </Panel>

      <Panel title="Queue Summary">
        {queues ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted text-left border-b border-border">
                <th className="py-1 font-normal">Queue</th>
                <th className="py-1 font-normal text-right">Waiting</th>
                <th className="py-1 font-normal text-right">Active</th>
                <th className="py-1 font-normal text-right">Completed</th>
                <th className="py-1 font-normal text-right">Failed</th>
                <th className="py-1 font-normal text-right">Delayed</th>
              </tr>
            </thead>
            <tbody>
              {(["historicalSync", "instrumentSync", "corporateActionsSync"] as const).map((key) => (
                <tr key={key} className="border-b border-border/50">
                  <td className="py-1.5 text-zinc-300">{key}</td>
                  <td className="py-1.5 text-right text-zinc-300">{queues[key].waiting}</td>
                  <td className="py-1.5 text-right text-zinc-300">{queues[key].active}</td>
                  <td className="py-1.5 text-right text-zinc-300">{queues[key].completed}</td>
                  <td className={`py-1.5 text-right ${queues[key].failed > 0 ? "text-down" : "text-zinc-300"}`}>
                    {queues[key].failed}
                  </td>
                  <td className="py-1.5 text-right text-zinc-300">{queues[key].delayed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-muted">{loading ? "Loading…" : "No data"}</p>
        )}
      </Panel>
    </div>
  );
}
