import { cn } from "@client/lib/cn";

/** The speech bubble with the lilac question mark and the leaf as its dot. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path
        d="M14 6h36a10 10 0 0 1 10 10v26a10 10 0 0 1-10 10H26l-12 9v-9h0a10 10 0 0 1-10-10V16A10 10 0 0 1 14 6Z"
        className="fill-[#14295c] dark:fill-[#2c3c7c]"
      />
      <path
        d="M24.5 22.5c.6-4.6 4.3-7.5 8.6-7.5 5 0 8.6 3.2 8.6 7.6 0 3.4-2 5.4-4.6 7-2 1.3-2.9 2.3-2.9 4.4v.8"
        fill="none"
        style={{ stroke: "var(--color-lilac, #b4a3f5)" }}
        strokeWidth="5.2"
        strokeLinecap="round"
      />
      <path d="M29.6 47.6c.6-6.4 6.2-10.3 13.4-9.6-.4 6.9-6.4 10.8-13.4 9.6Z" fill="#7db04a" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-7 shrink-0" />
      {compact ? null : (
        <span className="text-[15.5px] leading-none font-semibold tracking-[-0.03em] text-ink">
          Aula <span className="text-lilac-ink">Socrática</span>
        </span>
      )}
    </span>
  );
}
