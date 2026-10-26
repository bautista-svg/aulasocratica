// Client-safe shapes and rules for the AI summary of one student's work, built
// from what the teacher ticks: the activity rubric and/or its learning objectives.
import { quoteAppears } from "./thinking-xray";
import { sanitizeRubric } from "./activity-design";

export type SummaryBasis = "rubric" | "objectives";

export const SUMMARY_BASIS_LABELS: Record<SummaryBasis, string> = {
  rubric: "Rúbrica",
  objectives: "Objetivos de la actividad",
};

export interface SummaryPoint {
  title: string;
  observation: string;
  evidence: string[];
}

export interface SessionSummaryContent {
  overview: string;
  criteria: SummaryPoint[];
  objectives: SummaryPoint[];
  nextSteps: string[];
}

export const MAX_EVIDENCE_PER_POINT = 3;
/** An objective is the title of its point, and teachers write long ones: never cut it. */
const TITLE_MAX = 1000;

/** Keeps only valid, available bases (no rubric basis when the activity has no rubric). */
export function normalizeBasis(
  requested: readonly string[],
  available: { hasRubric: boolean; hasObjectives: boolean },
): SummaryBasis[] {
  const out: SummaryBasis[] = [];
  if (requested.includes("rubric") && available.hasRubric) out.push("rubric");
  if (requested.includes("objectives") && available.hasObjectives) out.push("objectives");
  return out;
}

/**
 * The bases of a summary made without the teacher choosing (the one shared with the student when
 * they send their work): everything the activity has. Empty when it has no rubric nor objectives.
 */
export function defaultBasis(activity: { rubric: unknown; objectives: string }): SummaryBasis[] {
  return normalizeBasis(["rubric", "objectives"], {
    hasRubric: sanitizeRubric(activity.rubric).length > 0,
    hasObjectives: splitObjectives(activity.objectives).length > 0,
  });
}

/** Splits the free-text objectives into separate items (lines, bullets or semicolons). */
export function splitObjectives(text: string): string[] {
  return text
    .split(/\n|;|•/)
    .map((s) => s.replace(/^\s*(?:[-*–]|\d+[.)])\s*/, "").trim())
    .filter((s) => s.length > 2)
    .slice(0, 12);
}

function str(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function points(raw: unknown, corpus: string | null): SummaryPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: SummaryPoint[] = [];
  for (const r of raw.slice(0, 12)) {
    if (!r || typeof r !== "object") continue;
    const o = r as { title?: unknown; observation?: unknown; evidence?: unknown };
    const title = str(o.title, TITLE_MAX);
    const observation = str(o.observation, 1500);
    if (!title || !observation) continue;
    const evidence = (Array.isArray(o.evidence) ? o.evidence : [])
      .map((e) => str(e, 400))
      .filter((e) => e && (corpus === null || quoteAppears(e, corpus)))
      .slice(0, MAX_EVIDENCE_PER_POINT);
    out.push({ title, observation, evidence });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Shows each objective point with the full objective of the activity: the AI sometimes shortens
 * it, and summaries saved before this fix had titles cut at 200 characters.
 */
export function withFullObjectives(points: SummaryPoint[], objectives: string[]): SummaryPoint[] {
  return points.map((p) => {
    const title = norm(p.title).replace(/(?:\.{3}|…)$/, "").trim();
    if (title.length < 12) return p;
    const full = objectives.find((o) => norm(o).startsWith(title));
    return full && full.length > p.title.length ? { ...p, title: full } : p;
  });
}

/**
 * Cleans a stored or AI-generated summary. When `studentCorpus` is given, quotes
 * that do not literally appear in what the student wrote are dropped.
 */
export function sanitizeSummary(raw: unknown, studentCorpus: string | null = null): SessionSummaryContent {
  type Raw = { overview?: unknown; criteria?: unknown; objectives?: unknown; nextSteps?: unknown };
  const o: Raw = raw && typeof raw === "object" ? (raw as Raw) : {};
  return {
    overview: str(o.overview, 2500),
    criteria: points(o.criteria, studentCorpus),
    objectives: points(o.objectives, studentCorpus),
    nextSteps: (Array.isArray(o.nextSteps) ? o.nextSteps : []).map((s) => str(s, 400)).filter(Boolean).slice(0, 6),
  };
}
