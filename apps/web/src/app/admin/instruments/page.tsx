"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi, type InstrumentSyncLog } from "@/lib/adminApi";
import { Panel, Button, ErrorBanner, EmptyState, StatBlock } from "@/components/admin/Primitives";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function InstrumentSyncPage() {
  const [logs, setLogs] = useState<InstrumentSyncLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { logs } = await adminApi.getInstrumentSyncLogs(20);
      setLogs(logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sync logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  async function handleTrigger() {
    setTriggering(true);
    setTriggerMessage(null);
    setError(null);
    try {
      const result = await adminApi.triggerInstrumentSync();
      setTriggerMessage(
        `Enqueued (job ${result.jobId}). The worker process picks this up — check back in a few minutes for the result below.`
      );
      setTimeout(loadLogs, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger sync");
    } finally {
      setTriggering(false);
    }
  }

  const latestSuccess = logs?.find((l) => l.success);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg text-zinc-100">Instrument Sync</h1>
          <p className="text-xs text-muted mt-1">
            Downloads Dhan&apos;s public scrip master and upserts into the Instrument table. Runs automatically at
            09:00 IST on weekdays, plus a full re-sync Sunday 02:00 IST.
          </p>
        </div>
        <Button onClick={handleTrigger} disabled={triggering}>
          {triggering ? "Enqueuing…" : "Run sync now"}
        </Button>
      </div>

      {triggerMessage && <div className="border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">{triggerMessage}</div>}
      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-3 gap-3">
        <StatBlock label="Last successful sync" value={latestSuccess ? formatTimestamp(latestSuccess.createdAt) : "—"} />
        <StatBlock label="Instruments upserted" value={latestSuccess ? latestSuccess.upserted : "—"} />
        <StatBlock
          label="Rows skipped"
          value={latestSuccess ? latestSuccess.skipped : "—"}
          tone={latestSuccess && latestSuccess.skipped > 0 ? "warn" : "default"}
        />
      </div>

      <Panel title="Sync History">
        {loading ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : !logs || logs.length === 0 ? (
          <EmptyState message="No sync runs yet. Trigger one above, or wait for the 09:00 IST scheduled run." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted text-left border-b border-border">
                <th className="py-1 font-normal">Time</th>
                <th className="py-1 font-normal">Triggered By</th>
                <th className="py-1 font-normal text-right">Total Rows</th>
                <th className="py-1 font-normal text-right">Upserted</th>
                <th className="py-1 font-normal text-right">Skipped</th>
                <th className="py-1 font-normal text-right">Duration</th>
                <th className="py-1 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-border/50">
                  <td className="py-1.5 text-zinc-300">{formatTimestamp(log.createdAt)}</td>
                  <td className="py-1.5 text-zinc-400">{log.triggeredBy}</td>
                  <td className="py-1.5 text-right text-zinc-300">{log.totalRows.toLocaleString("en-IN")}</td>
                  <td className="py-1.5 text-right text-zinc-300">{log.upserted.toLocaleString("en-IN")}</td>
                  <td className="py-1.5 text-right text-zinc-300">{log.skipped.toLocaleString("en-IN")}</td>
                  <td className="py-1.5 text-right text-zinc-300">{formatDuration(log.durationMs)}</td>
                  <td className="py-1.5">
                    {log.success ? (
                      <span className="text-up">ok</span>
                    ) : (
                      <span className="text-down" title={log.errorMessage ?? undefined}>
                        failed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
