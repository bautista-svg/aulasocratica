import { linkAvailability } from "./access-rules";

export type ActivityStateTone = "neutral" | "leaf" | "amber" | "ink";

/** One label for an activity's state, used everywhere (lists, header, dashboard). */
export function activityState(a: {
  status: string;
  linkActive: boolean;
  startsAt: string | null;
  expiresAt: string | null;
}, now = new Date()): { label: string; tone: ActivityStateTone; open: boolean } {
  if (a.status === "draft") return { label: "Borrador", tone: "neutral", open: false };
  if (a.status === "archived") return { label: "Archivada", tone: "neutral", open: false };
  const av = linkAvailability(a, { now });
  switch (av) {
    case "available":
      return { label: "Abierta", tone: "leaf", open: true };
    case "inactive":
      return { label: "Enlace cerrado", tone: "amber", open: false };
    case "not_started":
      return { label: "Programada", tone: "ink", open: false };
    case "expired":
      return { label: "Terminó", tone: "neutral", open: false };
    default:
      return { label: "No disponible", tone: "neutral", open: false };
  }
}

export const SESSION_STATUS_LABEL: Record<string, string> = {
  in_progress: "En curso",
  completed: "Terminó",
};
