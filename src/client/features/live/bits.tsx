// Small presentational pieces shared by the live panel, the session page and the lists.
import { Link } from "@tanstack/react-router";
import { Check, MessageSquareText, RotateCcw, X } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Badge } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { fmtRelative } from "@client/lib/format";
import { LIVE_STATUS_LABELS, STAGE_LABELS, type LiveStatus, type Stage } from "@shared/domain/live-monitor";
import { ALERT_CATEGORY_LABELS, ALERT_SEVERITY_LABELS, type AlertCategory } from "@shared/domain/alerts";
import type { AlertStatus } from "@shared/contracts/live";

const DOT: Record<LiveStatus, string> = {
  active: "bg-leaf-bright",
  idle: "bg-amber",
  abandoned: "bg-text-3",
  completed: "bg-ink",
};

export function LiveStatusLabel({ status, endedByTeacher, className }: { status: LiveStatus; endedByTeacher?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex flex-col text-sm", className)}>
      <span className="inline-flex items-center gap-2 font-semibold text-text">
        <span className={cn("size-2.5 shrink-0 rounded-full", DOT[status], status === "active" && "animate-pulse-dot")} aria-hidden="true" />
        {LIVE_STATUS_LABELS[status]}
      </span>
      {status === "completed" && endedByTeacher ? <span className="pl-[18px] text-xs text-text-3">Lo terminaste vos</span> : null}
    </span>
  );
}

export function stageLabel(stage: Stage | "done"): string {
  return stage === "done" ? "Terminó" : STAGE_LABELS[stage];
}

/** Segmented progress bar (2 or 3 steps) with an accessible name. */
export function StageProgress({ stage, done, total, className }: { stage: Stage | "done"; done: number; total: number; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate font-medium text-text">{stageLabel(stage)}</span>
        <span className="tabular shrink-0 text-xs text-text-3" aria-hidden="true">
          {done}/{total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`Progreso: ${done} de ${total} pasos`}
        className="mt-1.5 flex gap-1"
      >
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < done ? (done === total ? "bg-leaf" : "bg-lilac-ink") : "bg-sunken")} />
        ))}
      </div>
    </div>
  );
}

export function WorkStatusBadge({ status, endedByTeacher }: { status: string; endedByTeacher?: boolean }) {
  if (status === "completed") return <Badge tone="leaf">{endedByTeacher ? "Terminado por vos" : "Terminó"}</Badge>;
  return (
    <Badge tone="ink" dot>
      En curso
    </Badge>
  );
}

export interface AlertLike {
  id: string;
  sessionId: string;
  studentName?: string;
  name: string;
  category: string;
  severity: "review" | "immediate";
  origin: "ai" | "observed";
  evidence: string;
  reason: string;
  status: AlertStatus;
  createdAt: string;
}

/** One alert with its evidence and the review actions. Immediate-attention alerts stand out. */
export function AlertItem({
  alert,
  onStatus,
  busy,
  showStudent = true,
  showConversationLink = true,
}: {
  alert: AlertLike;
  onStatus: (status: AlertStatus) => void;
  busy?: boolean;
  showStudent?: boolean;
  showConversationLink?: boolean;
}) {
  const immediate = alert.severity === "immediate";
  const open = alert.status === "open";
  return (
    <li
      className={cn(
        "rounded-md border px-4 py-3.5",
        open && immediate ? "border-rose/40 border-l-4 border-l-rose bg-rose-soft/60" : "border-line bg-surface",
        !open && "opacity-80",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={immediate ? "rose" : "amber"}>{ALERT_SEVERITY_LABELS[alert.severity]}</Badge>
        <Badge tone="neutral">{ALERT_CATEGORY_LABELS[alert.category as AlertCategory] ?? alert.category}</Badge>
        <Badge tone={alert.origin === "ai" ? "lilac" : "neutral"}>{alert.origin === "ai" ? "Detectada por IA" : "Observada"}</Badge>
        {!open ? <Badge tone="neutral">{alert.status === "reviewed" ? "Revisada" : "Descartada"}</Badge> : null}
      </div>
      <p className="mt-2 text-[15px] font-semibold text-text">
        {showStudent && alert.studentName ? (
          <>
            <Link to="/app/sesiones/$sessionId" params={{ sessionId: alert.sessionId }} className="text-ink underline-offset-4 hover:underline">
              {alert.studentName}
            </Link>
            <span className="font-normal text-text-3"> · </span>
          </>
        ) : null}
        {alert.name}
        <span className="ml-2 text-xs font-normal text-text-3">{fmtRelative(alert.createdAt)}</span>
      </p>
      {alert.evidence ? (
        <blockquote className="mt-1.5 border-l-2 border-lilac pl-3 text-sm text-text-2 italic">«{alert.evidence}»</blockquote>
      ) : null}
      {alert.reason ? <p className="mt-1.5 text-sm text-text-2">{alert.reason}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {open ? (
          <>
            <Button size="sm" variant="secondary" icon={<Check className="size-4" />} loading={busy} onClick={() => onStatus("reviewed")}>
              Revisada
            </Button>
            <Button size="sm" variant="ghost" icon={<X className="size-4" />} disabled={busy} onClick={() => onStatus("dismissed")}>
              Descartar
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} loading={busy} onClick={() => onStatus("open")}>
            Reabrir
          </Button>
        )}
        {showConversationLink ? (
          <Link
            to="/app/sesiones/$sessionId"
            params={{ sessionId: alert.sessionId }}
            search={{ tab: "conversacion" }}
            className="inline-flex h-9 items-center gap-2 rounded-sm px-3 text-sm font-semibold text-ink hover:bg-sunken"
          >
            <MessageSquareText className="size-4" aria-hidden="true" />
            Ver conversación
          </Link>
        ) : null}
      </div>
    </li>
  );
}
