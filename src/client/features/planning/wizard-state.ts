// The whole "Crear con IA" wizard lives in one object saved in localStorage (per workspace),
// so a reload or a detour to another screen never loses what the teacher did.
import { useCallback, useEffect, useState } from "react";
import type { ClassProposal, PlanningDifficulty } from "@shared/domain/planning";
import type { MaterialUsage, ProposalsInput } from "@shared/contracts/planning";

export interface WizardState {
  v: 1;
  step: number;
  /** Furthest step reached (the stepper lets the teacher jump back and forth up to here). */
  maxStep: number;
  classroomId: string;
  subject: string;
  grade: string;
  topic: string;
  /** Minutes, as typed. */
  duration: string;
  priorKnowledge: string;
  materialIds: string[];
  extraText: string;
  skills: string[];
  activityTypes: string[];
  difficulty: PlanningDifficulty;
  request: string;
  proposals: ClassProposal[];
  usage: MaterialUsage | null;
  /** Signature of the inputs the proposals were generated with (to flag them as outdated). */
  generatedFor: string | null;
  /** Index of the chosen proposal; -1 = written by the teacher; null = none yet. */
  chosen: number | null;
  draft: ClassProposal | null;
  /** The chosen proposal as it came, to know whether the teacher edited it. */
  draftBase: string | null;
  /** A tutor of "Mis tutores", or null to keep the proposal's suggestion. */
  tutorId: string | null;
}

export function initialWizard(): WizardState {
  return {
    v: 1,
    step: 0,
    maxStep: 0,
    classroomId: "",
    subject: "",
    grade: "",
    topic: "",
    duration: "",
    priorKnowledge: "",
    materialIds: [],
    extraText: "",
    skills: [],
    activityTypes: [],
    difficulty: "intermedia",
    request: "",
    proposals: [],
    usage: null,
    generatedFor: null,
    chosen: null,
    draft: null,
    draftBase: null,
    tutorId: null,
  };
}

const storageKey = (teacherId: string) => `aula.crear.v1.${teacherId}`;

function load(teacherId: string): WizardState | null {
  try {
    const raw = localStorage.getItem(storageKey(teacherId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    if (!parsed || parsed.v !== 1) return null;
    return { ...initialWizard(), ...parsed };
  } catch {
    return null;
  }
}

export function durationMinutes(s: WizardState): number | null {
  const n = Number(s.duration.trim());
  return s.duration.trim() && Number.isInteger(n) ? n : null;
}

/** Body for POST /api/planning/proposals from the wizard state. */
export function proposalsInput(s: WizardState): ProposalsInput {
  return {
    classroomId: s.classroomId || null,
    subject: s.subject,
    grade: s.grade,
    topic: s.topic,
    durationMinutes: durationMinutes(s),
    priorKnowledge: s.priorKnowledge,
    skills: s.skills as ProposalsInput["skills"],
    activityTypes: s.activityTypes as ProposalsInput["activityTypes"],
    difficulty: s.difficulty,
    materialIds: s.materialIds,
    extraText: s.extraText,
    request: s.request,
  };
}

export function inputSignature(s: WizardState): string {
  const { request: _r, classroomId: _c, ...rest } = proposalsInput(s);
  return JSON.stringify(rest);
}

export function draftEdited(s: WizardState): boolean {
  return Boolean(s.draft && s.draftBase && JSON.stringify(s.draft) !== s.draftBase);
}

/** Anything typed beyond what a classroom pre-fills (classroom, subject, grade). */
export function hasProgress(s: WizardState): boolean {
  const neutral = { step: 0, maxStep: 0, classroomId: "", subject: "", grade: "" };
  return JSON.stringify({ ...s, ...neutral }) !== JSON.stringify({ ...initialWizard(), ...neutral }) || s.maxStep > 0;
}

export function useWizard(teacherId: string) {
  const [state, setState] = useState<WizardState>(() => load(teacherId) ?? initialWizard());
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(teacherId), JSON.stringify(state));
    } catch {
      /* private mode or full storage: the wizard still works, it just won't survive a reload */
    }
  }, [teacherId, state]);
  const update = useCallback((patch: Partial<WizardState> | ((s: WizardState) => Partial<WizardState>)) => {
    setState((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));
  }, []);
  const reset = useCallback((keep: Partial<WizardState> = {}) => {
    setState({ ...initialWizard(), ...keep });
    try {
      localStorage.removeItem(storageKey(teacherId));
    } catch {
      /* ignore */
    }
  }, [teacherId]);
  return { state, update, reset };
}
