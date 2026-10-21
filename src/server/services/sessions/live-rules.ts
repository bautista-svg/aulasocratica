// Pure rules of the live view that complement shared/domain/live-monitor.
import { progressSteps, type LiveEvent, type LiveSession } from "@shared/domain/live-monitor";
import { OBSERVED_ALERT_KEYS } from "@shared/domain/alerts";

/** A pause longer than this counts only up to this much as working time. */
export const MAX_COUNTED_GAP_MS = 5 * 60_000;

export function stepsFor(requireInitialAnswer: boolean): 2 | 3 {
  return requireInitialAnswer ? 3 : 2;
}

/**
 * Progress expressed in the steps the activity really has (no initial-answer step when it is off).
 * A work the teacher ended counts only the steps the student had completed (never "3 de 3").
 */
export function progressFor(session: LiveSession, events: LiveEvent[], requireInitialAnswer: boolean, endedByTeacher = false): number {
  const s = endedByTeacher && session.status === "completed" ? { ...session, status: "in_progress" } : session;
  const p = progressSteps({ ...s, requireInitialAnswer }, events);
  return requireInitialAnswer ? p : Math.max(0, p - 1);
}

/** Sum of the gaps between consecutive work signals, each capped at MAX_COUNTED_GAP_MS. */
export function workTime(points: number[]): number {
  const sorted = [...points].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i++) total += Math.min(MAX_COUNTED_GAP_MS, sorted[i]! - sorted[i - 1]!);
  return total;
}

export function alertOrigin(alertKey: string): "ai" | "observed" {
  return OBSERVED_ALERT_KEYS.includes(alertKey) ? "observed" : "ai";
}

