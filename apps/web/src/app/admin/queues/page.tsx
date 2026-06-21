"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi, type QueueStatus, type QueueCounts } from "@/lib/adminApi";
import { Panel, Button, ErrorBanner, StatBlock } from "@/components/admin/Primitives";

const QUEUE_LABELS: Record<keyof QueueStatus, string> = {
  historicalSync: "Historical Sync",
  instrumentSync: "Instrument Sync",
  corporateActionsSync: "Corporate Actions Sync",
};

function QueueCard({ name, counts }: { name: string; counts: QueueCounts }) {
  return (
    <Panel title={name}>
      <div className="grid grid-cols-5 gap-2">
        <StatBlock label="Waiting" value={counts.waiting} />
        <StatBlock label="Active" value={counts.active} tone={counts.active > 0 ? "warn" : "default"} />
        <StatBlock label="Completed" value={counts.completed} tone="up" />
        <StatBlock label="Failed" value={counts.failed} tone={counts.failed > 0 ? "down" : "default"} />
        <StatBlock label="Delayed" value={counts.delayed} />
      </div>
    </Panel>
  );
}

export default function QueuesPage() {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await adminApi.getQueueStatus());
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
          <h1 className="text-lg text-zinc-100">Job Queues</h1>
          <p className="text-xs text-muted mt-1">BullMQ queue depth, by job state.</p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      {status ? (
        <div className="space-y-3">
          {(Object.keys(QUEUE_LABELS) as Array<keyof QueueStatus>).map((key) => (
            <QueueCard key={key} name={QUEUE_LABELS[key]} counts={status[key]} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">{loading ? "Loading…" : "No data"}</p>
      )}
    </div>
  );
}
