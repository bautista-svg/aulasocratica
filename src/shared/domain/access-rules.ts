// Pure rules for activity links and student support signals. Covered by tests.

export type LinkAvailability = "available" | "inactive" | "not_started" | "expired" | "unpublished" | "archived";

export const LINK_AVAILABILITY_MESSAGE: Record<Exclude<LinkAvailability, "available">, string> = {
  inactive: "Tu docente cerró esta actividad por ahora.",
  not_started: "Esta actividad todavía no empezó.",
  expired: "Esta actividad ya terminó.",
  unpublished: "Esta actividad todavía no está publicada.",
  archived: "Esta actividad ya no está disponible.",
};

/**
 * Checked on EVERY student request (not only when entering): turning the link off,
 * expiring it or archiving the classroom stops students who are already inside.
 */
export function linkAvailability(
  a: { status: string; linkActive: boolean; startsAt: Date | string | null; expiresAt: Date | string | null },
  opts: { classroomArchived?: boolean; now?: Date } = {},
): LinkAvailability {
  const now = (opts.now ?? new Date()).getTime();
  if (opts.classroomArchived || a.status === "archived") return "archived";
  if (a.status !== "published") return "unpublished";
  if (!a.linkActive) return "inactive";
  if (a.startsAt && new Date(a.startsAt).getTime() > now) return "not_started";
  if (a.expiresAt && new Date(a.expiresAt).getTime() <= now) return "expired";
  return "available";
}

/** Observable signal for "may need teacher support" — never a judgement of ability. */
export const SUPPORT_HINT_THRESHOLD = 3;

export function supportReasons(s: {
  hintCount: number;
  clarificationCount?: number;
  status: string;
  initialAnswer: string | null;
  requireInitialAnswer: boolean;
}): string[] {
  const reasons: string[] = [];
  if (s.hintCount >= SUPPORT_HINT_THRESHOLD) reasons.push(`Pidió ${s.hintCount} pistas`);
  if ((s.clarificationCount ?? 0) >= 3) reasons.push(`Indicó ${s.clarificationCount} veces que no entendió`);
  if (s.requireInitialAnswer && s.status === "in_progress" && !s.initialAnswer) {
    reasons.push("Entró pero todavía no escribió su respuesta inicial");
  }
  return reasons;
}
