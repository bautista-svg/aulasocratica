// Visual vocabulary of "Habilidades": an icon per skill, a four-step meter for the level and one
// color per meaning — green achieved (logrado, avanzado), orange on the way (inicial, en
// desarrollo), grey not evaluable (sin evidencia, no evaluada).
import type { ReactNode } from "react";
import {
  BookOpen,
  ChartColumn,
  Compass,
  Languages,
  Lightbulb,
  MessagesSquare,
  NotebookPen,
  Palette,
  PenLine,
  Quote,
  RefreshCcw,
  Scale,
  Sparkle,
  Telescope,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@client/lib/cn";
import { SKILL_LEVELS, STATUS_LABELS, toneOf, type SkillAssessment, type SkillStatus, type StatusTone } from "@shared/domain/skills";

const ICONS: Record<string, LucideIcon> = {
  redaccion: PenLine,
  argumentacion: Scale,
  comprension: Lightbulb,
  materiales: BookOpen,
  ejemplos: ChartColumn,
  pensamiento_critico: Telescope,
  revision: RefreshCcw,
  dialogo: MessagesSquare,
  autonomia: Compass,
  vocabulario: Languages,
  creatividad: Palette,
  reflexion: NotebookPen,
};

export const TONE_STYLE: Record<StatusTone, { tile: string; bar: string; text: string; soft: string; dot: string }> = {
  good: { tile: "bg-leaf-soft text-leaf", bar: "bg-leaf-bright", text: "text-leaf", soft: "bg-leaf-soft/70", dot: "bg-leaf-bright" },
  grow: { tile: "bg-amber-soft text-amber", bar: "bg-heat-4", text: "text-amber", soft: "bg-amber-soft/70", dot: "bg-heat-4" },
  none: { tile: "bg-sunken text-text-2", bar: "bg-line-strong", text: "text-text-2", soft: "bg-sunken/70", dot: "bg-line-strong" },
};

/** The skill's icon (own skills get a spark) on a tile tinted by the level, or neutral. */
export function SkillGlyph({ skill, status, className }: { skill: string; status?: SkillStatus | null; className?: string }) {
  const Icon = ICONS[skill] ?? Sparkle;
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px]",
        status === undefined ? "bg-sunken text-ink" : TONE_STYLE[toneOf(status)].tile,
        className,
      )}
      aria-hidden="true"
    >
      <Icon className="size-[18px]" strokeWidth={2} />
    </span>
  );
}

/** Four steps, filled up to the level; "sin evidencia" is four dashed outlines. */
export function LevelMeter({ status, className }: { status: SkillStatus | null; className?: string }) {
  const filled = status && status !== "sin_evidencia" ? SKILL_LEVELS.indexOf(status) + 1 : 0;
  const tone = TONE_STYLE[toneOf(status)];
  return (
    <span className={cn("inline-flex items-end gap-[3px]", className)} aria-hidden="true">
      {SKILL_LEVELS.map((l, i) => (
        <span
          key={l}
          className={cn(
            "w-[7px] rounded-[2px]",
            ["h-2", "h-3", "h-4", "h-5"][i],
            i < filled ? tone.bar : filled === 0 ? "border border-dashed border-line-strong" : "bg-sunken",
          )}
        />
      ))}
    </span>
  );
}

/** The level as a pill with its meter ("No evaluada" when the work has no entry for the skill). */
export function LevelPill({ status, className }: { status: SkillStatus | null; className?: string }) {
  const tone = TONE_STYLE[toneOf(status)];
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", tone.tile, className)}>
      <LevelMeter status={status} />
      {status ? STATUS_LABELS[status] : "No evaluada"}
    </span>
  );
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-text-3 uppercase">{label}</p>
      <div className="mt-0.5 text-[15px] leading-6 text-text">{children}</div>
    </div>
  );
}

/** What backs a level: the indicator, the student's words, why, what to improve and a suggestion. */
export function EvidenceCard({ a, footer, className }: { a: Pick<SkillAssessment, "status" | "criterion" | "evidence" | "why" | "improve" | "suggestion" | "source">; footer?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-3 rounded-[14px] border border-line bg-surface p-4 shadow-1", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <LevelPill status={a.status} />
        {a.source === "teacher" ? <span className="rounded-full bg-ink-soft px-2 py-0.5 text-[11px] font-semibold text-ink">Nivel corregido por vos</span> : null}
      </div>
      {a.criterion ? <Part label="Indicador observado">{a.criterion}</Part> : null}
      {a.evidence ? (
        <figure className="flex gap-2.5 rounded-[10px] bg-lilac-soft/60 px-3.5 py-3">
          <Quote className="mt-0.5 size-4 shrink-0 text-lilac-ink" aria-hidden="true" />
          <blockquote className="text-[15px] leading-6 text-text italic">«{a.evidence}»</blockquote>
        </figure>
      ) : null}
      {a.why ? <Part label={a.status === "sin_evidencia" ? "Por qué no se pudo evaluar" : "Por qué es evidencia"}>{a.why}</Part> : null}
      {a.improve ? <Part label="Para mejorar">{a.improve}</Part> : null}
      {a.suggestion ? <Part label="Sugerencia">{a.suggestion}</Part> : null}
      {footer}
    </div>
  );
}

/** Legend of the three colors (shown once per view). */
export function ToneLegend({ className }: { className?: string }) {
  const items: [StatusTone, string][] = [
    ["good", "Logrado o avanzado"],
    ["grow", "Inicial o en desarrollo"],
    ["none", "Sin evidencia o no evaluada"],
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-text-2", className)}>
      {items.map(([tone, label]) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-full", TONE_STYLE[tone].dot)} aria-hidden="true" /> {label}
        </span>
      ))}
    </div>
  );
}
