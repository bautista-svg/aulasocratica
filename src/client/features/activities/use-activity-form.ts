// Draft state of the activity editor: what the teacher is editing vs. what is saved.
// Saving sends only the fields that changed. When the saved activity changes elsewhere
// (another tab, applying a tutor), fields the teacher did not touch follow it and fields
// with unsaved edits are left alone — nothing typed is ever overwritten.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activityPatch, type ActivityEditorData, type ActivityPatch } from "@shared/contracts/activities";
import type { ReflectionQuestion, RubricCriterion } from "@shared/domain/activity-design";
import type { VoiceLanguage } from "@shared/domain/voice";
import type { DeliverableMode } from "@shared/domain/deliverables";
import type { HelpLevel } from "@shared/contracts/activities";
import type { ActivityLanguage } from "@shared/domain/language";

export interface ActivityDraft {
  subject: string;
  objectives: string;
  instructions: string;
  moreInstructions: string[];
  material: string;
  tutorType: string;
  extraTutorTypes: string[];
  helpLevel: HelpLevel;
  tutorRules: string;
  requireInitialAnswer: boolean;
  askFinalAnswer: boolean;
  finalQuestion: string;
  language: ActivityLanguage;
  voiceLanguage: VoiceLanguage;
  deliverableMode: DeliverableMode;
  deliverablePrompt: string;
  rubric: RubricCriterion[];
  reflectionQuestions: ReflectionQuestion[];
}

export const DRAFT_KEYS = [
  "subject",
  "objectives",
  "instructions",
  "moreInstructions",
  "material",
  "tutorType",
  "extraTutorTypes",
  "helpLevel",
  "tutorRules",
  "requireInitialAnswer",
  "askFinalAnswer",
  "finalQuestion",
  "language",
  "voiceLanguage",
  "deliverableMode",
  "deliverablePrompt",
  "rubric",
  "reflectionQuestions",
] as const satisfies readonly (keyof ActivityDraft)[];

export type DraftKey = (typeof DRAFT_KEYS)[number];
export type FieldErrors = Record<string, string>;

export function draftFrom(a: ActivityEditorData): ActivityDraft {
  return {
    subject: a.subject,
    objectives: a.objectives,
    instructions: a.instructions,
    moreInstructions: a.moreInstructions,
    material: a.material,
    tutorType: a.tutorType,
    extraTutorTypes: a.extraTutorTypes,
    helpLevel: a.helpLevel,
    tutorRules: a.tutorRules,
    requireInitialAnswer: a.requireInitialAnswer,
    askFinalAnswer: a.askFinalAnswer,
    finalQuestion: a.finalQuestion,
    language: a.language,
    voiceLanguage: a.voiceLanguage,
    deliverableMode: a.deliverableMode,
    deliverablePrompt: a.deliverablePrompt,
    rubric: a.rubric,
    reflectionQuestions: a.reflectionQuestions,
  };
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Which section of the editor each field (or error path) belongs to. */
export function errorKeyBelongsTo(path: string, key: DraftKey) {
  return path === key || path.startsWith(`${key}.`);
}

export function useActivityForm(activity: ActivityEditorData) {
  const [baseline, setBaseline] = useState<ActivityDraft>(() => draftFrom(activity));
  const [draft, setDraft] = useState<ActivityDraft>(() => draftFrom(activity));
  const [errors, setErrors] = useState<FieldErrors>({});
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  // Follow server changes for untouched fields.
  const serverStamp = `${activity.id}:${activity.updatedAt}`;
  useEffect(() => {
    const next = draftFrom(activity);
    const prevBase = baselineRef.current;
    const cur = draftRef.current;
    const merged = { ...cur } as Record<DraftKey, unknown>;
    for (const k of DRAFT_KEYS) if (same(cur[k], prevBase[k])) merged[k] = next[k];
    baselineRef.current = next;
    setBaseline(next);
    setDraft(merged as unknown as ActivityDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverStamp]);

  const dirtyKeys = useMemo(() => DRAFT_KEYS.filter((k) => !same(draft[k], baseline[k])), [draft, baseline]);

  const set = useCallback(<K extends DraftKey>(key: K, value: ActivityDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    // Editing a field clears its errors (they are recomputed on save).
    setErrors((e) => {
      const next: FieldErrors = {};
      let changed = false;
      for (const [path, msg] of Object.entries(e)) {
        if (errorKeyBelongsTo(path, key)) changed = true;
        else next[path] = msg;
      }
      return changed ? next : e;
    });
  }, []);

  /** The patch to send, or the per-field errors that prevent sending it. */
  const buildPatch = useCallback((): { patch: ActivityPatch; errors: null } | { patch: null; errors: FieldErrors } => {
    const d = draftRef.current;
    const b = baselineRef.current;
    const patch: Record<string, unknown> = {};
    for (const k of DRAFT_KEYS) if (!same(d[k], b[k])) patch[k] = d[k];
    const parsed = activityPatch.safeParse(patch);
    if (!parsed.success) {
      const out: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        if (!out[key]) out[key] = issue.message;
      }
      return { patch: null, errors: out };
    }
    return { patch: patch as ActivityPatch, errors: null };
  }, []);

  /** After a successful save: adopt the server's (sanitized) values for what was sent. */
  const saved = useCallback((sent: ActivityPatch, server: ActivityEditorData) => {
    const next = draftFrom(server);
    const prev = baselineRef.current;
    setBaseline(next);
    baselineRef.current = next;
    setDraft((cur) => {
      const merged = { ...cur } as Record<DraftKey, unknown>;
      for (const k of DRAFT_KEYS) {
        // Sent and not edited since: take the stored (trimmed) value. Not sent and untouched: follow the server.
        const untouched = k in sent ? same(cur[k], (sent as Record<string, unknown>)[k]) : same(cur[k], prev[k]);
        if (untouched) merged[k] = next[k];
      }
      return merged as unknown as ActivityDraft;
    });
    setErrors({});
  }, []);

  const discard = useCallback(() => {
    setDraft(baselineRef.current);
    setErrors({});
  }, []);

  /** Replaces some saved values (e.g. after applying a tutor) in both baseline and draft. */
  const adopt = useCallback((server: ActivityEditorData, keys: DraftKey[]) => {
    const next = draftFrom(server);
    setBaseline((b) => {
      const out = { ...b } as Record<DraftKey, unknown>;
      for (const k of keys) out[k] = next[k];
      return out as unknown as ActivityDraft;
    });
    setDraft((d) => {
      const out = { ...d } as Record<DraftKey, unknown>;
      for (const k of keys) out[k] = next[k];
      return out as unknown as ActivityDraft;
    });
  }, []);

  return { draft, baseline, set, dirtyKeys, dirty: dirtyKeys.length > 0, errors, setErrors, buildPatch, saved, discard, adopt };
}

export type ActivityForm = ReturnType<typeof useActivityForm>;
