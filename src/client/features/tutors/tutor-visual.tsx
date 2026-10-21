import {
  BookOpenText,
  BookText,
  Brain,
  Calculator,
  Code,
  FileText,
  Lightbulb,
  ListChecks,
  MessageCircleQuestionMark,
  MessagesSquare,
  Mic,
  PenLine,
  Puzzle,
  RotateCcw,
  Scale,
  Search,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@client/lib/cn";
import { HELP_LEVELS, TUTOR_TYPES } from "@shared/domain/pedagogy";

export const TUTOR_TYPE_ICONS: Record<string, LucideIcon> = {
  comprension_lectora: BookOpenText,
  matematico: Calculator,
  pensamiento_critico: Lightbulb,
  argumentacion: Scale,
  resolucion_problemas: Puzzle,
  investigacion: Search,
  programacion: Code,
  metacognicion: Brain,
  conversacion_personaje: UserRound,
  conversacion_guiada: MessagesSquare,
  debate_clase: Users,
  debate_socratico: MessageCircleQuestionMark,
  escritura_mano: PenLine,
  seleccion_multiple: ListChecks,
  repaso: RotateCcw,
  expresion_oral: Mic,
  contenido_teorico: BookText,
  produccion_escrita: FileText,
};

const TONES = {
  ink: "bg-ink-soft text-ink",
  lilac: "bg-lilac-soft text-lilac-ink",
  leaf: "bg-leaf-soft text-leaf",
  amber: "bg-amber-soft text-amber",
  rose: "bg-rose-soft text-rose",
} as const;

const TYPE_TONE: Record<string, keyof typeof TONES> = {
  comprension_lectora: "ink",
  matematico: "ink",
  pensamiento_critico: "amber",
  argumentacion: "rose",
  resolucion_problemas: "leaf",
  investigacion: "ink",
  programacion: "lilac",
  metacognicion: "lilac",
  conversacion_personaje: "amber",
  conversacion_guiada: "amber",
  debate_clase: "rose",
  debate_socratico: "rose",
  escritura_mano: "amber",
  seleccion_multiple: "leaf",
  repaso: "leaf",
  expresion_oral: "ink",
  contenido_teorico: "lilac",
  produccion_escrita: "lilac",
};

export function TutorTypeTile({ type, className, size = "md" }: { type: string; className?: string; size?: "sm" | "md" }) {
  const Icon = TUTOR_TYPE_ICONS[type] ?? Lightbulb;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-md",
        size === "sm" ? "size-8" : "size-10",
        TONES[TYPE_TONE[type] ?? "ink"],
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-4" : "size-5"} />
    </span>
  );
}

export const typeLabel = (type: string) => TUTOR_TYPES[type] ?? "Tipo propio";
export const helpLabel = (level: string) => HELP_LEVELS[level]?.label ?? "Andamiaje moderado";
