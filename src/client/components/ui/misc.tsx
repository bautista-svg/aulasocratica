import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, SearchX, WifiOff } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Button, buttonClass } from "./button";
import { ApiError, errorMessage } from "@client/lib/api";

export function Card({ className, children, as: As = "section" }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" | "li" }) {
  return <As className={cn("rounded-lg border border-line bg-surface shadow-1", className)}>{children}</As>;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5", className)}>
      <div className="min-w-0">
        <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-text-2">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export type Tone = "neutral" | "ink" | "lilac" | "leaf" | "amber" | "rose";
const tones: Record<Tone, string> = {
  neutral: "bg-sunken text-text-2",
  ink: "bg-ink-soft text-ink",
  lilac: "bg-lilac-soft text-lilac-ink",
  leaf: "bg-leaf-soft text-leaf",
  amber: "bg-amber-soft text-amber",
  rose: "bg-rose-soft text-rose",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", tones[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1.5 text-sm font-semibold text-lilac-ink">{eyebrow}</div> : null}
        <h1 className="font-display text-[28px] leading-tight font-semibold text-ink sm:text-[34px]">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[15px] leading-6 text-text-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** `level`: 2 when the empty state sits right under the page's h1 (no section heading in between). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  level = 3,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={cn("flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center", className)}>
      {icon ? <div className="mb-3 text-lilac">{icon}</div> : null}
      <Heading className="font-display text-lg font-semibold text-ink">{title}</Heading>
      {description ? <p className="mt-1.5 max-w-md text-sm leading-6 text-text-2">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Where a teacher can go when something does not exist (anymore): the list that contains it. */
function exitFor(pathname: string): { to: "/app/aulas" | "/app/informes" | "/app" | "/"; label: string } {
  if (/^\/app\/(aulas|actividades|sesiones|alumnos)\//.test(pathname)) return { to: "/app/aulas", label: "Ir a mis aulas" };
  if (pathname.startsWith("/app/informes/")) return { to: "/app/informes", label: "Volver a Informes" };
  if (pathname.startsWith("/app")) return { to: "/app", label: "Ir al inicio" };
  return { to: "/", label: "Ir al inicio" };
}

/**
 * Load error with a way forward. A 404 ("no existe o no tenés acceso") never offers "Reintentar"
 * — retrying cannot help — but a way out instead: `notFoundAction` if given; otherwise, when the
 * caller passed `onRetry`, a link to the list the missing thing belonged to takes its place.
 * A caller that already handles 404 itself (no `onRetry` + its own link) gets no extra link.
 */
export function ErrorState({
  error,
  onRetry,
  className,
  notFoundAction,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  notFoundAction?: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const network = error instanceof ApiError && error.isNetwork;
  const notFound = error instanceof ApiError && error.status === 404;
  const Icon = network ? WifiOff : notFound ? SearchX : AlertTriangle;
  const exit = exitFor(pathname);
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-lg border border-rose/20 bg-rose-soft/50 px-6 py-8 text-center", className)}>
      <Icon className="mb-2 size-6 text-rose" aria-hidden="true" />
      <p className="font-semibold text-text">{network ? "Sin conexión" : notFound ? "No lo encontramos" : "No se pudo cargar"}</p>
      <p className="mt-1 max-w-md text-sm text-text-2">{errorMessage(error)}</p>
      {notFound ? (
        notFoundAction ? (
          <div className="mt-4">{notFoundAction}</div>
        ) : onRetry && notFoundAction === undefined ? (
          <Link to={exit.to} className={buttonClass("secondary", "sm", "mt-4")}>
            {exit.label}
          </Link>
        ) : null
      ) : onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" icon={<RefreshCw className="size-4" />} onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden="true" />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface p-5">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="mt-3 h-4 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function Notice({ tone = "ink", title, children, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg px-4 py-3.5 text-sm sm:flex-row sm:items-center", tones[tone], className)}>
      <div className="min-w-0 flex-1 leading-6">
        {title ? <p className="font-semibold">{title}</p> : null}
        {/* Full-strength color: at 90 % opacity the leaf tone fell to 4.4:1 (WCAG 1.4.3). */}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <div className="text-xs font-semibold text-text-3">{label}</div>
      <div className="tabular mt-1 font-display text-2xl font-semibold text-ink">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-text-3">{hint}</div> : null}
    </div>
  );
}
