"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/auth";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace(searchParams.get("next") ?? "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg font-mono text-sm">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded border border-border bg-bg-panel p-6">
        <div>
          <div className="text-xs tracking-widest text-muted">BULL50</div>
          <h1 className="text-base text-zinc-100">Sign in</h1>
        </div>

        {error && (
          <div className="rounded border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">{error}</div>
        )}

        <div className="space-y-1">
          <label className="block text-xs text-muted" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-border bg-bg px-3 py-2 text-zinc-100 outline-none focus:border-zinc-500"
            autoComplete="email"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs text-muted" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-border bg-bg px-3 py-2 text-zinc-100 outline-none focus:border-zinc-500"
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-zinc-100 px-3 py-2 text-bg font-medium hover:bg-white disabled:opacity-50 transition-colors"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary in the app router
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
