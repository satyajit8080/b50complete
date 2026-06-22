"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";

const NAV_ITEMS = [
  { href: "/admin/overview",     label: "Overview" },
  { href: "/admin/credentials",  label: "API Credentials" },   // NEW
  { href: "/admin/market-data",  label: "Market Data" },       // NEW
  { href: "/admin/apis",         label: "Circuit Breakers" },
  { href: "/admin/queues",       label: "Queues" },
  { href: "/admin/instruments",  label: "Instrument Sync" },
  { href: "/admin/sectors",      label: "Sector Mapping" },
  { href: "/admin/fundamentals", label: "Fundamentals" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, fetchMe } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    fetchMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLoading && (!user || (user.role !== "ADMIN" && user.role !== "SUPERADMIN"))) {
      router.replace("/login?next=/admin/overview");
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg font-mono text-sm text-muted">
        Checking access…
      </div>
    );
  }

  if (!user || (user.role !== "ADMIN" && user.role !== "SUPERADMIN")) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-bg font-mono text-sm">
      <aside className="w-56 shrink-0 border-r border-border bg-bg-panel">
        <div className="px-4 py-5 border-b border-border">
          <div className="text-xs tracking-widest text-muted">BULL50</div>
          <div className="text-base text-zinc-100">Admin Console</div>
          <div className="text-xs text-muted mt-1">{user.email}</div>
        </div>
        <nav className="py-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-4 py-2 text-zinc-400 hover:text-zinc-100 hover:bg-bg transition-colors border-l-2 border-transparent hover:border-zinc-500"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6 overflow-x-auto">{children}</main>
    </div>
  );
}
