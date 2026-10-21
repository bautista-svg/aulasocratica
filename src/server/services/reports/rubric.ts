// Reads the levels a teacher CONFIRMED for each rubric criterion of a student's work.
// The rubric is stored as a snapshot on the assessment, so later edits of the activity's
// rubric never change what was confirmed. `teacher_levels` is read defensively: the
// canonical shape is { [criterionId]: levelIndex }, but labels, numeric strings and
// arrays of { criterionId, levelIndex } are accepted too.
import { sanitizeRubric, type RubricCriterion } from "@shared/domain/activity-design";

type Lookup = Map<string, unknown>;

function toLookup(raw: unknown): Lookup {
  const out: Lookup = new Map();
  if (Array.isArray(raw)) {
    raw.forEach((item, i) => {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const key = o.criterionId ?? o.id ?? o.criterion ?? i;
        const value = o.levelIndex ?? o.level ?? o.index ?? o.label ?? o.value;
        if (value !== undefined && value !== null) out.set(String(key), value);
      } else if (item !== undefined && item !== null) {
        out.set(String(i), item);
      }
    });
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out.set(k, v);
  }
  return out;
}

function levelLabel(c: RubricCriterion, value: unknown): string | null {
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return levelLabel(c, o.levelIndex ?? o.level ?? o.index ?? o.label);
  }
  if (typeof value === "number" && Number.isInteger(value)) return c.levels[value]?.label ?? null;
  if (typeof value === "string") {
    const s = value.trim();
    if (/^\d+$/.test(s)) return c.levels[Number(s)]?.label ?? null;
    const match = c.levels.find((l) => l.label.toLowerCase() === s.toLowerCase());
    return match?.label ?? null;
  }
  return null;
}

/** Criterion + confirmed level, only for criteria that actually have a level chosen. */
export function confirmedRubricRows(snapshot: unknown, teacherLevels: unknown): { criterion: string; level: string }[] {
  const rubric = sanitizeRubric(snapshot);
  const lookup = toLookup(teacherLevels);
  const rows: { criterion: string; level: string }[] = [];
  rubric.forEach((c, i) => {
    const value = lookup.get(c.id) ?? lookup.get(String(i)) ?? lookup.get(c.name);
    const label = levelLabel(c, value);
    if (label) rows.push({ criterion: c.name, level: label });
  });
  return rows;
}
