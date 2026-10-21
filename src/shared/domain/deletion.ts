// Client-safe rules for permanently deleting teacher-owned things.

/**
 * Students touched by a deletion whose record should also go away: they no longer
 * belong to any classroom and have no work left anywhere in the institution.
 * Students still enrolled elsewhere (e.g. in a colleague's classroom) keep their record.
 */
export function orphanStudentIds(
  candidates: string[],
  stillEnrolled: Iterable<string>,
  withSessions: Iterable<string>,
) {
  const keep = new Set<string>([...stillEnrolled, ...withSessions]);
  return Array.from(new Set(candidates)).filter((id) => !keep.has(id));
}

/** Splits a list into chunks (storage removals and `in()` filters are size-limited). */
export function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
