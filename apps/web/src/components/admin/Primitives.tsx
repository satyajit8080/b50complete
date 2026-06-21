export function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="border border-border bg-bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-zinc-200">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function StatBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "up" | "down" | "warn" | "default";
}) {
  const toneClass = { up: "text-up", down: "text-down", warn: "text-warn", default: "text-zinc-100" }[tone ?? "default"];
  return (
    <div className="border border-border px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-lg ${toneClass}`}>{value}</div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  type?: "button" | "submit";
}) {
  const base = "px-3 py-1.5 text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "border-zinc-500 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
      : "border-border text-zinc-400 hover:text-zinc-100 hover:border-zinc-500";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">{message}</div>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="border border-dashed border-border px-3 py-6 text-center text-xs text-muted">{message}</div>;
}
