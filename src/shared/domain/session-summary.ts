// Client-safe shapes and rules for the AI summary of one student's work, built
// from what the teacher ticks: the activity rubric and/or its learning objectives.
import { quoteAppears } from "./thinking-xray";

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
    const title = str(o.title, 200);
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
