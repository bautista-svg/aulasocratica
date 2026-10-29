// When the tutor stops asking: the teacher can cap how many messages it writes and/or let it
// close as soon as the student has shown what the objectives ask. The cap is counted by the
// server; "achieved" is the tutor's call, signalled with a marker the student never sees.

export const MAX_QUESTIONS_RANGE = { min: 2, max: 40, suggested: 10 } as const;

/** The student must have written at least this many messages before the tutor may close early. */
export const MIN_STUDENT_TURNS_TO_CLOSE = 2;

export const DONE_MARKER = "[[TERMINADO]]";
const DONE_MARKER_LOOSE = /\[\[\s*TERMINADO\s*\]\]/gi;

export type TutorDone = "limit" | "achieved";

export function clampMaxQuestions(n: number): number {
  return Math.min(MAX_QUESTIONS_RANGE.max, Math.max(MAX_QUESTIONS_RANGE.min, Math.round(n)));
}

/** Why the tutor no longer takes messages in this work, or null while it does. */
export function tutorDoneReason(opts: {
  maxQuestions: number | null;
  stopWhenAchieved: boolean;
  /** Tutor messages already in the conversation. */
  asked: number;
  achieved: boolean;
}): TutorDone | null {
  if (opts.stopWhenAchieved && opts.achieved) return "achieved";
  if (opts.maxQuestions !== null && opts.asked >= opts.maxQuestions) return "limit";
  return null;
}

/** The reply without the marker, and whether it was there. */
export function stripDoneMarker(text: string): { text: string; found: boolean } {
  let found = false;
  const clean = text.replace(DONE_MARKER_LOOSE, () => {
    found = true;
    return "";
  });
  return { text: found ? clean.trim() : text, found };
}

/**
 * Removes the marker from a streamed reply as it arrives: text that could be the start of the
 * marker is held back until the next chunk says whether it is.
 */
export function markerFilter() {
  let held = "";
  let found = false;
  return {
    push(chunk: string): string {
      const parts = (held + chunk).split(DONE_MARKER);
      if (parts.length > 1) found = true;
      let s = parts.join("");
      held = "";
      for (let k = Math.min(DONE_MARKER.length - 1, s.length); k > 0; k--) {
        if (DONE_MARKER.startsWith(s.slice(-k))) {
          held = s.slice(-k);
          s = s.slice(0, -k);
          break;
        }
      }
      return s;
    },
    /** Whether the marker came through (it was removed). */
    get found() {
      return found;
    },
    /** What was held back at the end (it was not the marker). */
    end(): string {
      const rest = held;
      held = "";
      return rest;
    },
  };
}
