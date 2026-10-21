// Small presentational pieces shared by the live panel, the session page and the lists.
import { Link } from "@tanstack/react-router";
import { Check, MessageSquareText, RotateCcw, X } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Badge } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { fmtRelative } from "@client/lib/format";
import { LIVE_STATUS_HELP, LIVE_STATUS_LABELS, STAGE_LABELS, liveStatus, stageNumber, type LiveStatus, type Stage } from "@shared/domain/live-monitor";
import { ALERT_CATEGORY_LABELS, ALERT_SEVERITY_LABELS, type AlertCategory } from "@shared/domain/alerts";
import type { AlertStatus } from "@shared/contracts/live";

const DOT: Record<LiveStatus, string> = {
  active: "bg-leaf-bright",
  idle: "bg-amber",
  abandoned: "bg-text-3",
  completed: "bg-ink",
};

/** Activo / Sin actividad / Abandonada / Terminó — the same words on every screen (D19). */
export function LiveStatusLabel({ status, endedByTeacher, className }: { status: LiveStatus; endedByTeacher?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex flex-col text-sm", className)} title={LIVE_STATUS_HELP[status]}>
      <span className="inline-flex items-center gap-2 font-semibold text-text">
        <span className={cn("size-2.5 shrink-0 rounded-full", DOT[status], status === "active" && "animate-pulse-dot")} aria-hidden="true" />
        {LIVE_STATUS_LABELS[status]}
      </span>
      {status === "completed" && endedByTeacher ? <span className="pl-[18px] text-xs text-text-2">Lo terminaste vos</span> : null}
    </span>
  );
}

/** Live state of a work from its row data (lists without events use the last activity time). */
export function workLiveStatus(status: string, lastActivityAt: string, now = Date.now()): LiveStatus {
  if (status === "completed") return "completed";
  return liveStatus({ status, initialAnswer: null, startedAt: lastActivityAt, lastActivityAt, completedAt: null }, new Date(lastActivityAt).getTime(), now);
}

export function workStatusLabel(status: string, lastActivityAt: string, endedByTeacher = false): string {
  const s = workLiveStatus(status, lastActivityAt);
  return s === "completed" && endedByTeacher ? "Terminó (lo terminaste vos)" : LIVE_STATUS_LABELS[s];
}

/**
 * Where the student is, numbered like the student sees it ("Paso 2 de 3" ↔ "Etapa 2 de 3").
 * A work the teacher ended shows the stage it was ended in, never "3 de 3".
 */
export function stageText(p: { stage: Stage | "done"; reached: Stage; total: number; endedByTeacher?: boolean }): { main: string; detail: string } {
  const n = stageNumber(p.reached, p.total === 3);
  if (p.stage === "done" && !p.endedByTeacher) return { main: "Terminó todas las etapas", detail: `${p.total} de ${p.total}` };
  if (p.stage === "done") return { main: `Quedó en la etapa ${n} de ${p.total}`, detail: STAGE_LABELS[p.reached] };
  return { main: `Etapa ${n} de ${p.total}`, detail: STAGE_LABELS[p.reached] };
}

/** Segmented bar (2 or 3 stages): completed stages filled, the current one half-filled. The text says the same. */
export function StageProgress({
  stage,
  reached,
  done,
  total,
  endedByTeacher,
  className,
}: {
  stage: Stage | "done";
  reached: Stage;
  done: number;
  total: number;
  endedByTeacher?: boolean;
  className?: string;
}) {
  const t = stageText({ stage, reached, total, endedByTeacher });
  const finished = stage === "done" && !endedByTeacher;
  const current = stage === "done" ? -1 : stageNumber(reached, total === 3) - 1;
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-sm leading-5">
        <span className="font-medium text-text">{t.main}</span>
        <span className="text-text-2">
          {" · "}
          {t.detail}
        </span>
      </p>
      <div className="mt-1.5 flex gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn("h-1.5 flex-1 rounded-full", finished ? "bg-leaf" : i < done ? "bg-lilac-ink" : i === current ? "bg-lilac/50" : "bg-sunken")}
          />
        ))}
      </div>
    </div>
  );
}

const WORK_TONE: Record<LiveStatus, "leaf" | "amber" | "neutral" | "ink"> = { active: "leaf", idle: "amber", abandoned: "neutral", completed: "leaf" };

/** Status badge for lists (Radiografía, ficha del alumno): same vocabulary as En vivo. */
export function WorkStatusBadge({ status, endedByTeacher, lastActivityAt }: { status: string; endedByTeacher?: boolean; lastActivityAt: string }) {
  const s = workLiveStatus(status, lastActivityAt);
  return (
    <Badge tone={WORK_TONE[s]} dot={s === "active"}>
      {s === "completed" && endedByTeacher ? "Terminó · lo terminaste vos" : LIVE_STATUS_LABELS[s]}
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
            <Link to="/app/sesiones/$sessionId" params={{ sessionId: alert.sessionId }} className="text-ink underline decoration-ink/35 underline-offset-4 hover:decoration-ink">
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
