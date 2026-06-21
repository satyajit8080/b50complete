"use client";

import { useState, type FormEvent } from "react";
import { adminApi } from "@/lib/adminApi";
import { Panel, Button, ErrorBanner } from "@/components/admin/Primitives";

const inputClass = "w-full bg-bg border border-border px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500";
const labelClass = "block text-xs text-muted mb-1";

interface NumericField {
  key: "marketCap" | "enterpriseValue" | "peRatio" | "pbRatio" | "bookValue" | "eps" | "roe" | "roce" | "debtToEquity";
  label: string;
  placeholder: string;
}

const NUMERIC_FIELDS: NumericField[] = [
  { key: "marketCap", label: "Market Cap (\u20b9 Cr)", placeholder: "1250000" },
  { key: "enterpriseValue", label: "Enterprise Value (\u20b9 Cr)", placeholder: "1280000" },
  { key: "peRatio", label: "P/E Ratio", placeholder: "18.5" },
  { key: "pbRatio", label: "P/B Ratio", placeholder: "3.2" },
  { key: "bookValue", label: "Book Value (\u20b9)", placeholder: "450" },
  { key: "eps", label: "EPS (\u20b9)", placeholder: "68.2" },
  { key: "roe", label: "ROE (%)", placeholder: "17.2" },
  { key: "roce", label: "ROCE (%)", placeholder: "19.8" },
  { key: "debtToEquity", label: "Debt/Equity", placeholder: "0.4" },
];

export default function FundamentalsPage() {
  const [securityId, setSecurityId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [periodType, setPeriodType] = useState<"QUARTERLY" | "ANNUAL" | "TTM">("QUARTERLY");
  const [periodEndDate, setPeriodEndDate] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setValue(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const numericPayload: Record<string, number> = {};
      for (const field of NUMERIC_FIELDS) {
        const raw = values[field.key];
        if (raw !== undefined && raw !== "") {
          const parsed = Number(raw);
          if (!Number.isNaN(parsed)) numericPayload[field.key] = parsed;
        }
      }

      await adminApi.submitFundamentals({
        securityId,
        symbol,
        periodType,
        periodEndDate,
        ...numericPayload,
      });

      setMessage(`Saved fundamentals for ${symbol.toUpperCase()} \u2014 ${periodType} period ending ${periodEndDate}`);
      setValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save fundamentals");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg text-zinc-100">Fundamentals — Manual Entry</h1>
        <p className="text-xs text-muted mt-1">
          Bridge path while FinEdge endpoint integration is pending. Writes to Bull50&apos;s own source-agnostic
          fundamentals storage — same table FinEdge will populate once wired up.
        </p>
      </div>

      {message && <div className="border border-up/40 bg-up/10 px-3 py-2 text-xs text-up">{message}</div>}
      {error && <ErrorBanner message={error} />}

      <Panel title="New Entry">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className={labelClass}>Security ID (Dhan)</label>
              <input className={inputClass} value={securityId} onChange={(e) => setSecurityId(e.target.value)} required />
            </div>
            <div>
              <label className={labelClass}>Symbol</label>
              <input className={inputClass} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="HDFCBANK" required />
            </div>
            <div>
              <label className={labelClass}>Period Type</label>
              <select
                className={inputClass}
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as "QUARTERLY" | "ANNUAL" | "TTM")}
              >
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUAL">Annual</option>
                <option value="TTM">TTM</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Period End Date</label>
              <input
                type="date"
                className={inputClass}
                value={periodEndDate}
                onChange={(e) => setPeriodEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted mb-2">All fields below are optional — leave blank if unknown.</p>
            <div className="grid grid-cols-3 gap-3">
              {NUMERIC_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className={labelClass}>{field.label}</label>
                  <input
                    className={inputClass}
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    inputMode="decimal"
                  />
                </div>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save fundamentals"}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
