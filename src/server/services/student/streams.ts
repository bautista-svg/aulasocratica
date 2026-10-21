// Sessions whose tutor reply is being generated right now. One reply at a time per session
// (two tabs cannot interleave the history). In memory: the app runs as a single instance.
const active = new Set<string>();

export function isStreaming(sessionId: string): boolean {
  return active.has(sessionId);
}

/** Returns false when a reply is already in progress for this session. */
export function acquireStream(sessionId: string): boolean {
  if (active.has(sessionId)) return false;
  active.add(sessionId);
  return true;
}

export function releaseStream(sessionId: string): void {
  active.delete(sessionId);
}
