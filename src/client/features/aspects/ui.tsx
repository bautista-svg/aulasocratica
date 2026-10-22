// Visual vocabulary of "Fortalezas y aspectos a reforzar": an icon per aspect, leaf for what
// the student achieved (the app keeps green for "logrado") and amber for what to reinforce.
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
  RefreshCcw,
  Scale,
  Sprout,
  Target,
  Telescope,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@client/lib/cn";
import type { AspectKey, AspectKind } from "@shared/domain/aspects";

export const ASPECT_ICONS: Record<AspectKey, LucideIcon> = {
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

export const KIND_STYLE: Record<AspectKind, { icon: LucideIcon; tile: string; bar: string; text: string; soft: string; dot: string }> = {
  strength: { icon: Sprout, tile: "bg-leaf-soft text-leaf", bar: "bg-leaf-bright", text: "text-leaf", soft: "bg-leaf-soft/70", dot: "bg-leaf-bright" },
  reinforce: { icon: Target, tile: "bg-amber-soft text-amber", bar: "bg-heat-4", text: "text-amber", soft: "bg-amber-soft/70", dot: "bg-heat-4" },
};

/** The aspect's icon on a tile tinted by what it says about the student. */
export function AspectGlyph({ aspect, kind, className }: { aspect: AspectKey; kind: AspectKind | "neutral"; className?: string }) {
  const Icon = ASPECT_ICONS[aspect];
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px]",
        kind === "neutral" ? "bg-sunken text-ink" : KIND_STYLE[kind].tile,
        className,
      )}
      aria-hidden="true"
    >
      <Icon className="size-[18px]" strokeWidth={2} />
    </span>
  );
}

/** Column heading: "Se destacó en" with a sprout, "A reforzar" with a target. */
export function KindHeading({ kind, label, count, as: As = "h3" }: { kind: AspectKind; label: string; count?: number; as?: "h3" | "h4" }) {
  const Icon = KIND_STYLE[kind].icon;
  return (
    <As className={cn("flex items-center gap-2 text-sm font-semibold", KIND_STYLE[kind].text)}>
      <Icon className="size-4" aria-hidden="true" />
      {label}
      {count !== undefined ? <span className="ml-auto rounded-full bg-surface/80 px-2 py-0.5 text-xs tabular text-text-2">{count}</span> : null}
    </As>
  );
}
