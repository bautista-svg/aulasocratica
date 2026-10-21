// "Same request, same answer" for the create endpoints (classroom, activity, duplicate, Crear con
// IA, tutor, material). The client sends a random `requestId` per form; a second request with the
// same id and the same data (double click, retry after a lost response) waits for and returns the
// result of the first one instead of creating a duplicate. In memory, like the rate limits: the
// app runs as a single instance (docs/ARQUITECTURA.md). A failed request is forgotten so it can
// be retried.
import { createHash } from "node:crypto";

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 5000;

interface Entry {
  at: number;
  fingerprint: string;
  result: Promise<unknown>;
}

// Insertion order = age order (entries are only appended), so pruning stops at the first fresh one.
const recent = new Map<string, Entry>();

function prune(now: number) {
  for (const [key, e] of recent) {
    if (now - e.at <= TTL_MS && recent.size <= MAX_ENTRIES) break;
    recent.delete(key);
  }
}

function fingerprintOf(data: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(data ?? null))
    .digest("hex");
}

/**
 * Runs `run` once per (scope, teacher, requestId, data). Without a requestId it just runs.
 * The same id with different data is treated as a new request.
 */
export function once<T>(scope: string, teacherId: string, requestId: string | undefined, data: unknown, run: () => Promise<T>): Promise<T> {
  if (!requestId) return run();
  const now = Date.now();
  prune(now);
  const key = `${scope}:${teacherId}:${requestId}`;
  const fingerprint = fingerprintOf(data);
  const hit = recent.get(key);
  if (hit && hit.fingerprint === fingerprint && now - hit.at <= TTL_MS) return hit.result as Promise<T>;
  if (hit) recent.delete(key);
  const result = run();
  recent.set(key, { at: now, fingerprint, result });
  result.catch(() => {
    if (recent.get(key)?.result === result) recent.delete(key);
  });
  return result;
}

/** Tests only. */
export function clearIdempotency() {
  recent.clear();
}
