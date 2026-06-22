"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";
import { Panel, Button, ErrorBanner } from "@/components/admin/Primitives";

const inputClass =
  "w-full bg-bg border border-border px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono";
const labelClass = "block text-xs text-muted mb-1";

interface KeyStatus {
  DHAN_CLIENT_ID:    boolean;
  DHAN_ACCESS_TOKEN: boolean;
  FINEDGE_API_KEY:   boolean;
  ANTHROPIC_API_KEY: boolean;
}

interface ValidationResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  credentialsMissing?: boolean;
  note?: string;
}

interface ValidationResponse {
  dhan:    ValidationResult;
  finedge: ValidationResult;
}

function StatusDot({ set }: { set: boolean }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full mr-2 ${set ? "bg-up" : "bg-zinc-700"}`} />
  );
}

function ValidationBadge({ result }: { result: ValidationResult | null }) {
  if (!result) return <span className="text-muted text-xs">—</span>;
  if (result.credentialsMissing) return <span className="text-amber-400 text-xs">not configured</span>;
  if (result.ok) return <span className="text-up text-xs">✓ connected ({result.latencyMs}ms){result.note ? ` — ${result.note}` : ""}</span>;
  return <span className="text-down text-xs">✗ {result.error}</span>;
}

export default function CredentialsPage() {
  const [status, setStatus]       = useState<KeyStatus | null>(null);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [message, setMessage]       = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);

  // Form state — kept separate so we never echo back values from the server
  const [dhanClientId,    setDhanClientId]    = useState("");
  const [dhanAccessToken, setDhanAccessToken] = useState("");
  const [finedgeKey,      setFinedgeKey]      = useState("");
  const [anthropicKey,    setAnthropicKey]    = useState("");

  async function loadStatus() {
    try {
      const s = await apiFetch<KeyStatus>("/api/monitoring/api-keys/status");
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load key status");
    }
  }

  async function handleValidate() {
    setValidating(true);
    setError(null);
    try {
      const v = await apiFetch<ValidationResponse>("/api/monitoring/validate-credentials");
      setValidation(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const payload: Record<string, string> = {};
    if (dhanClientId)    payload.DHAN_CLIENT_ID    = dhanClientId;
    if (dhanAccessToken) payload.DHAN_ACCESS_TOKEN = dhanAccessToken;
    if (finedgeKey)      payload.FINEDGE_API_KEY   = finedgeKey;
    if (anthropicKey)    payload.ANTHROPIC_API_KEY = anthropicKey;

    if (!Object.keys(payload).length) {
      setError("Enter at least one key to save");
      setSaving(false);
      return;
    }

    try {
      const res = await apiFetch<{
        message: string;
        validation: { dhan: ValidationResult | null; finedge: ValidationResult | null };
      }>("/api/monitoring/api-keys", { method: "POST", body: JSON.stringify(payload) });

      setMessage(res.message);
      if (res.validation.dhan || res.validation.finedge) {
        setValidation(res.validation as ValidationResponse);
      }
      // Clear fields after save
      setDhanClientId(""); setDhanAccessToken(""); setFinedgeKey(""); setAnthropicKey("");
      loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save keys");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => { loadStatus(); }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg text-zinc-100">API Credentials</h1>
        <p className="text-xs text-muted mt-1">
          Keys are written to the server .env file. Values are never returned — only
          set/unset status is shown. Requires SUPERADMIN role to update.
        </p>
      </div>

      {error   && <ErrorBanner message={error} />}
      {message && <div className="border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">{message}</div>}

      <Panel title="Current Status">
        {status ? (
          <div className="space-y-2 text-xs">
            {(Object.entries(status) as [keyof KeyStatus, boolean][]).map(([key, set]) => (
              <div key={key} className="flex items-center">
                <StatusDot set={set} />
                <span className="font-mono text-zinc-300 w-48">{key}</span>
                <span className={set ? "text-up" : "text-zinc-600"}>{set ? "set" : "not set"}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">Loading…</p>
        )}
      </Panel>

      <Panel title="Live Connection Test">
        <div className="space-y-2">
          {validation ? (
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted w-20">DhanHQ</span>
                <ValidationBadge result={validation.dhan} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted w-20">FinEdge</span>
                <ValidationBadge result={validation.finedge} />
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted mb-2">Run a live ping to confirm credentials work end-to-end.</p>
          )}
          <Button onClick={handleValidate} disabled={validating}>
            {validating ? "Testing…" : "Test connections"}
          </Button>
        </div>
      </Panel>

      <Panel title="Update Keys">
        <form onSubmit={handleSave} className="space-y-3">
          <p className="text-xs text-muted">Leave blank to keep the current value. Only filled fields are written.</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>DHAN_CLIENT_ID</label>
              <input
                className={inputClass}
                type="password"
                placeholder="enter to update"
                value={dhanClientId}
                onChange={(e) => setDhanClientId(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass}>DHAN_ACCESS_TOKEN</label>
              <input
                className={inputClass}
                type="password"
                placeholder="enter to update"
                value={dhanAccessToken}
                onChange={(e) => setDhanAccessToken(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass}>FINEDGE_API_KEY</label>
              <input
                className={inputClass}
                type="password"
                placeholder="enter to update"
                value={finedgeKey}
                onChange={(e) => setFinedgeKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass}>ANTHROPIC_API_KEY</label>
              <input
                className={inputClass}
                type="password"
                placeholder="enter to update"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save keys"}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
