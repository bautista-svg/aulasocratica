// Divisions of a classroom (e.g. "N", "F", "S"): the teacher lists them in the classroom and
// each student picks one when entering an activity, so the live view can show them apart.
// An empty list means the students are not asked.

export const MAX_DIVISIONS = 12;
export const MAX_DIVISION_CHARS = 20;

// Invisible characters that can disguise a text (bidi overrides, zero-width spaces, BOM).
const INVISIBLE = /[​‎‏‪-‮⁠⁦-⁩﻿]/g;

/** "  n  " → "n": trims, collapses spaces and drops invisible characters (case is kept). */
export function tidyDivision(input: string): string {
  return input.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/** Key to compare divisions: lowercase, no accents. */
export function divisionKey(input: string): string {
  return tidyDivision(input).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** The problem with a list typed by the teacher, or null (checked before saving). */
export function divisionOptionsProblem(list: string[]): string | null {
  const tidy = list.map(tidyDivision).filter(Boolean);
  if (tidy.some((d) => Array.from(d).length > MAX_DIVISION_CHARS)) return `Cada división puede tener hasta ${MAX_DIVISION_CHARS} caracteres.`;
  if (new Set(tidy.map(divisionKey)).size > MAX_DIVISIONS) return `Podés cargar hasta ${MAX_DIVISIONS} divisiones.`;
  return null;
}

/** Whatever is stored (or sent) → a clean list: texts only, tidy, without repeats, within the limits. */
export function sanitizeDivisionOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const d = Array.from(tidyDivision(item)).slice(0, MAX_DIVISION_CHARS).join("").trim();
    const key = divisionKey(d);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(d);
    if (out.length >= MAX_DIVISIONS) break;
  }
  return out;
}

/** The option a student picked, written as the teacher wrote it (null: not one of them). */
export function matchDivision(options: string[], picked: string): string | null {
  const key = divisionKey(picked);
  if (!key) return null;
  return options.find((o) => divisionKey(o) === key) ?? null;
}

export interface DivisionCount {
  /** The division, or "" for the students who did not pick one. */
  value: string;
  count: number;
}

/**
 * The choices of a filter by division: the classroom's divisions (in its order) plus any other
 * division a student has (picked before the teacher changed the list), each with how many
 * students have it; "" last when someone has none. Empty when nobody has a division and the
 * classroom asks for none (no filter to show).
 */
export function divisionCounts(options: string[], values: string[]): DivisionCount[] {
  const counts = new Map<string, DivisionCount>();
  for (const o of options) counts.set(divisionKey(o), { value: o, count: 0 });
  let none = 0;
  for (const v of values) {
    const key = divisionKey(v);
    if (!key) {
      none++;
      continue;
    }
    const entry = counts.get(key) ?? { value: tidyDivision(v), count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const list = [...counts.values()];
  if (!list.length) return [];
  return none ? [...list, { value: "", count: none }] : list;
}

/** Whether a student's division is the one chosen in a filter ("" = without division). */
export function inDivision(value: string, filter: string): boolean {
  return divisionKey(value) === divisionKey(filter);
}
