import { cn } from "@client/lib/cn";

/** The speech bubble with the lilac question mark and the leaf as its dot. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d="M14 6h36a10 10 0 0 1 10 10v26a10 10 0 0 1-10 10H26l-12 9v-9h0a10 10 0 0 1-10-10V16A10 10 0 0 1 14 6Z" fill="#14295c" />
      <path
        d="M24.5 22.5c.6-4.6 4.3-7.5 8.6-7.5 5 0 8.6 3.2 8.6 7.6 0 3.4-2 5.4-4.6 7-2 1.3-2.9 2.3-2.9 4.4v.8"
        fill="none"
        stroke="#a996ec"
        strokeWidth="5.2"
        strokeLinecap="round"
      />
      <path d="M34.2 38.6c3.9-.4 6.6 1.4 7.4 4.6-3.9.6-6.7-1-7.4-4.6Z" fill="#7db04a" />
      <path d="M34.2 38.6c-1.4 2.6-1.6 5-.8 7.1" fill="none" stroke="#7db04a" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-8 shrink-0" />
      {compact ? null : (
        <span className="font-display text-[19px] leading-none font-semibold tracking-tight text-ink">
          Aula <span className="italic font-medium text-lilac-ink">Socrática</span>
        </span>
      )}
    </span>
  );
}
