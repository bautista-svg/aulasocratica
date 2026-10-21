// Client-safe rules for the teacher material library ("Mis materiales").
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
export const MAX_FOLDER_LENGTH = 80;
/** Max characters of a text/link material appended to an activity's written material. */
export const MAX_TEXT_FOR_ACTIVITY = 6000;

export function sanitizeTags(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(/[,;\n]/);
  const out: string[] = [];
  for (const t of raw) {
    const tag = t.trim().replace(/^#/, "").replace(/\s+/g, " ").toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function sanitizeFolder(input: string): string {
  return input.trim().replace(/\s+/g, " ").slice(0, MAX_FOLDER_LENGTH);
}

export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Text block appended to an activity's material when a written text or link is attached. */
export function materialAsActivityText(m: { title: string; kind: string; url: string | null; body: string }): string {
  const title = m.title.replace(/\s+/g, " ").trim();
  if (m.kind === "link") {
    const note = m.body.trim() ? `\n${m.body.trim().slice(0, 1000)}` : "";
    return `— ${title} —\nEnlace: ${m.url ?? ""}${note}`;
  }
  return `— ${title} —\n${m.body.trim().slice(0, MAX_TEXT_FOR_ACTIVITY)}`;
}

export interface LibraryFilter {
  query: string;
  folder: string | null;
  tag: string | null;
}

export function matchesLibraryFilter(
  m: { title: string; folder: string; tags: string[]; file_name: string | null },
  f: LibraryFilter,
): boolean {
  if (f.folder !== null && m.folder !== f.folder) return false;
  if (f.tag && !m.tags.includes(f.tag)) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  return [m.title, m.folder, m.file_name ?? "", ...m.tags].some((s) => s.toLowerCase().includes(q));
}
