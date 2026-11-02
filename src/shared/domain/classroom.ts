// Google Classroom: the grade a work gets from its rubric, and which Classroom student is which
// student of the app (the app only knows names; Classroom knows accounts).
import type { RubricCriterion } from "./activity-design";

export const DEFAULT_MAX_POINTS = 10;
export const MAX_POINTS_RANGE = { min: 1, max: 1000 } as const;

/**
 * The grade out of `maxPoints`: each criterion is worth the same, and a level is worth its place
 * (the first of four levels is 1/4, the last 4/4). Criteria without a level do not count; with no
 * level at all there is no grade. Rounded to one decimal, like a school grade.
 */
export function gradeFromRubric(rubric: RubricCriterion[], levels: Record<string, number | null | undefined>, maxPoints: number): number | null {
  const parts: number[] = [];
  for (const c of rubric) {
    const idx = levels[c.id];
    if (idx === null || idx === undefined || !c.levels.length) continue;
    const clamped = Math.max(0, Math.min(c.levels.length - 1, idx));
    parts.push((clamped + 1) / c.levels.length);
  }
  if (!parts.length) return null;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.round(avg * maxPoints * 10) / 10;
}

/** Lowercase, no accents or punctuation, single spaces: "  Martína  López-Paz " → "martina lopez paz". */
export function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RosterStudent {
  userId: string;
  name: string;
}

/**
 * The Classroom student that is surely this one, or null when it is not clear (the teacher picks).
 * Same words in any order ("López Martina" = "Martina López") count; so does one name containing
 * every word of the other ("Martina López" in "Martina Sofía López"), when only one student fits.
 */
export function matchStudent(name: string, roster: RosterStudent[]): RosterStudent | null {
  const words = (s: string) => foldName(s).split(" ").filter(Boolean);
  const mine = words(name);
  if (!mine.length) return null;
  const key = [...mine].sort().join(" ");
  const exact = roster.filter((r) => [...words(r.name)].sort().join(" ") === key);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const contains = (a: string[], b: string[]) => a.every((w) => b.includes(w));
  const loose = roster.filter((r) => {
    const theirs = words(r.name);
    return mine.length >= 2 && theirs.length >= 2 && (contains(mine, theirs) || contains(theirs, mine));
  });
  return loose.length === 1 ? loose[0]! : null;
}
