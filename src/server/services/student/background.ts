// Fire-and-forget work for the student journey (alert detection). It never blocks a
// student's request and never fails it; tests can wait for it to settle.
import { log, errorFields } from "../../lib/logger";

const inFlight = new Set<Promise<unknown>>();

export function runInBackground(name: string, task: () => Promise<unknown>): void {
  const p = Promise.resolve()
    .then(task)
    .catch((err) => log.warn("student_background_failed", { task: name, ...errorFields(err) }))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
}

/** Resolves when every background task started so far has finished (used by tests). */
export async function settleStudentJobs(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

/** Runs `fn` after the previous task with the same key finished (per-session ordering). */
const chains = new Map<string, Promise<unknown>>();
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  const tail = next.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return next;
}
