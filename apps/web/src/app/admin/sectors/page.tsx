"use client";

import { useEffect, useState, useCallback, type FormEvent } from "react";
import { adminApi, type SectorMapping } from "@/lib/adminApi";
import { Panel, Button, ErrorBanner, EmptyState } from "@/components/admin/Primitives";

const inputClass = "w-full bg-bg border border-border px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500";
const labelClass = "block text-xs text-muted mb-1";

export default function SectorMappingPage() {
  const [mappings, setMappings] = useState<SectorMapping[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const [securityId, setSecurityId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [sectoralIndex, setSectoralIndex] = useState("");
  const [sectoralIndexSecurityId, setSectoralIndexSecurityId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { mappings } = await adminApi.getSectorMappings();
      setMappings(mappings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sector mappings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMessage(null);
    setError(null);
    try {
      await adminApi.upsertSectorMapping({
        securityId,
        symbol,
        sectoralIndex,
        sectoralIndexSecurityId: sectoralIndexSecurityId || undefined,
      });
      setSubmitMessage(`Saved ${symbol.toUpperCase()} \u2192 ${sectoralIndex}`);
      setSecurityId("");
      setSymbol("");
      setSectoralIndex("");
      setSectoralIndexSecurityId("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mapping");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg text-zinc-100">Sector Mapping</h1>
        <p className="text-xs text-muted mt-1">
          NSE&apos;s industry classification is proprietary, so sector strength/rotation uses NIFTY sectoral index
          membership as a proxy. Map each stock to its sectoral index here.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <Panel title="Add / Update Mapping">
        <form onSubmit={handleSubmit} className="grid grid-cols-4 gap-3 items-end">
          <div>
            <label className={labelClass}>Security ID (Dhan)</label>
            <input className={inputClass} value={securityId} onChange={(e) => setSecurityId(e.target.value)} placeholder="1333" required />
          </div>
          <div>
            <label className={labelClass}>Symbol</label>
            <input className={inputClass} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="HDFCBANK" required />
          </div>
          <div>
            <label className={labelClass}>Sectoral Index</label>
            <input
              className={inputClass}
              value={sectoralIndex}
              onChange={(e) => setSectoralIndex(e.target.value)}
              placeholder="NIFTYBANK"
              required
            />
          </div>
          <div>
            <label className={labelClass}>Index Security ID (optional)</label>
            <input
              className={inputClass}
              value={sectoralIndexSecurityId}
              onChange={(e) => setSectoralIndexSecurityId(e.target.value)}
              placeholder="25"
            />
          </div>
          <div className="col-span-4">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save mapping"}
            </Button>
          </div>
        </form>
        {submitMessage && <p className="mt-2 text-xs text-up">{submitMessage}</p>}
        <p className="mt-3 text-xs text-muted">
          Index Security ID is the Dhan securityId for the sectoral index itself (IDX_I segment) — required for
          sector strength calculations to pull live data for that index. Find it via Instrument search.
        </p>
      </Panel>

      <Panel title="Current Mappings">
        {loading ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : !mappings || mappings.length === 0 ? (
          <EmptyState message="No sector mappings yet. Add one above to start populating sector strength/rotation data." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted text-left border-b border-border">
                <th className="py-1 font-normal">Symbol</th>
                <th className="py-1 font-normal">Security ID</th>
                <th className="py-1 font-normal">Sectoral Index</th>
                <th className="py-1 font-normal">Index Security ID</th>
                <th className="py-1 font-normal">Updated</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id} className="border-b border-border/50">
                  <td className="py-1.5 text-zinc-200">{m.symbol}</td>
                  <td className="py-1.5 text-zinc-400">{m.securityId}</td>
                  <td className="py-1.5 text-zinc-300">{m.sectoralIndex}</td>
                  <td className="py-1.5 text-zinc-400">{m.sectoralIndexSecurityId ?? "—"}</td>
                  <td className="py-1.5 text-muted">{new Date(m.updatedAt).toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
