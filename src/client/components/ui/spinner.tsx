import { cn } from "@client/lib/cn";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center gap-2">
      <svg className={cn("size-5 animate-spin text-current", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="text-sm text-text-2">{label}</span> : null}
    </span>
  );
}

export function PageSpinner({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-ink">
      <Spinner label={label} />
    </div>
  );
}
