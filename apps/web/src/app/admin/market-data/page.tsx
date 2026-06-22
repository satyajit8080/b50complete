"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { Panel, Button, ErrorBanner, StatBlock } from "@/components/admin/Primitives";

interface OptionChainSnapshot {
  underlying:    string;
  expiry:        string;
  lastPrice:     number;
  strikes:       number;
  putCallRatio:  number;
  maxPainStrike: number;
  atmIv:         number | null;
  snapshotAt:    string;
}

interface IndexSnapshot {
  name:          string;
  lastPrice:     number;
  changePercent: number;
  snapshotAt:    string;
}

interface TriggerResult {
  optionChains: { ok: boolean; count?: number; error?: string };
  indices:      { ok: boolean; error?: string };
}

function fmt(n: number, dec = 2) { return n.toFixed(dec); }
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function MarketDataPage() {
  const [chains,    setChains]    = useState<OptionChainSnapshot[]>([]);
  const [indices,   setIndices]   = useState<IndexSnapshot[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [triggering,setTriggering]= useState(false);
  const [result,    setResult]    = useState<TriggerResult | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, i] = await Promise.all([
        apiFetch<{ snapshots: OptionChainSnapshot[] }>("/api/monitoring/option-chain/snapshots"),
        apiFetch<{ snapshots: IndexSnapshot[] }>("/api/monitoring/indices/latest"),
      ]);
      setChains(c.snapshots);
      setIndices(i.snapshots);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load market data");
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleTrigger() {
    setTriggering(true);
    setResult(null);
    setError(null);
    try {
      const r = await apiFetch<TriggerResult>("/api/monitoring/market-data/trigger", { method: "POST" });
      setResult(r);
      setTimeout(load, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trigger failed");
    } finally {
      setTriggering(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg text-zinc-100">Live Market Data</h1>
          <p className="text-xs text-muted mt-1">
            Option chains (Nifty, BankNifty, FinNifty) and index snapshots ingested from DhanHQ.
            Runs automatically every 3 min during market hours — trigger manually to test.
          </p>
        </div>
        <Button onClick={handleTrigger} disabled={triggering}>
          {triggering ? "Fetching…" : "Fetch now"}
        </Button>
      </div>

      {error  && <ErrorBanner message={error} />}
      {result && (
        <div className={`border px-3 py-2 text-xs ${result.optionChains.ok ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down"}`}>
          Option chains: {result.optionChains.ok ? `${result.optionChains.count} ingested` : result.optionChains.error} ·{" "}
          Indices: {result.indices.ok ? "ok" : result.indices.error}
        </div>
      )}

      <Panel title="Index Snapshots">
        {loading ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : indices.length === 0 ? (
          <p className="text-xs text-muted">No index data yet — click "Fetch now" or wait for market hours.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {indices.map((idx) => (
              <div key={idx.name} className="border border-border bg-bg px-3 py-2">
                <div className="text-xs text-muted">{idx.name.replace("_", " ")}</div>
                <div className="text-lg text-zinc-100">{fmt(idx.lastPrice)}</div>
                <div className={`text-xs ${idx.changePercent >= 0 ? "text-up" : "text-down"}`}>
                  {idx.changePercent >= 0 ? "+" : ""}{fmt(idx.changePercent)}%
                </div>
                <div className="text-xs text-zinc-600 mt-1">{fmtTime(idx.snapshotAt)}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Option Chain Snapshots">
        {loading ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : chains.length === 0 ? (
          <p className="text-xs text-muted">No option chain data yet — click "Fetch now" or wait for market hours.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted text-left border-b border-border">
                <th className="py-1 font-normal">Underlying</th>
                <th className="py-1 font-normal">Expiry</th>
                <th className="py-1 font-normal text-right">Last Price</th>
                <th className="py-1 font-normal text-right">Strikes</th>
                <th className="py-1 font-normal text-right">PCR</th>
                <th className="py-1 font-normal text-right">Max Pain</th>
                <th className="py-1 font-normal text-right">ATM IV</th>
                <th className="py-1 font-normal text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {chains.map((c) => (
                <tr key={`${c.underlying}-${c.expiry}`} className="border-b border-border/50">
                  <td className="py-1.5 text-zinc-200 font-bold">{c.underlying}</td>
                  <td className="py-1.5 text-zinc-400">{c.expiry}</td>
                  <td className="py-1.5 text-right text-zinc-300">{fmt(c.lastPrice)}</td>
                  <td className="py-1.5 text-right text-zinc-300">{c.strikes}</td>
                  <td className={`py-1.5 text-right ${c.putCallRatio >= 1 ? "text-up" : "text-down"}`}>
                    {fmt(c.putCallRatio)}
                  </td>
                  <td className="py-1.5 text-right text-zinc-300">{fmt(c.maxPainStrike, 0)}</td>
                  <td className="py-1.5 text-right text-zinc-400">
                    {c.atmIv !== null ? `${fmt(c.atmIv)}%` : "—"}
                  </td>
                  <td className="py-1.5 text-right text-zinc-600">{fmtTime(c.snapshotAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
