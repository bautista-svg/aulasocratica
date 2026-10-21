// Client-safe rules for the teacher material library ("Mis materiales").
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
export const MAX_FOLDER_LENGTH = 80;
/** Materials per workspace. */
export const MAX_MATERIALS = 500;
export const MAX_MATERIAL_TITLE = 200;
/** A written text material (the teacher types or pastes it). */
export const MAX_TEXT_BODY = 100_000;
export const MAX_LINK_NOTE = 2000;
/**
 * Max characters of a text material appended to an activity's written material. Longer texts
 * are attached whole as a text file instead (nothing is cut).
 */
export const MAX_TEXT_FOR_ACTIVITY = 6000;
/** Max materials chosen at once (wizard, attach). */
export const MAX_PICK = 10;
/** Characters per page of the extracted-text preview. */
export const PREVIEW_PAGE_CHARS = 12_000;

export type MaterialKind = "file" | "link" | "text";
export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = { file: "Archivo", link: "Enlace", text: "Texto" };

/** Default title for an uploaded file: its name without extension. */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]{1,8}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Archivo").slice(0, MAX_MATERIAL_TITLE);
}

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

/** Appends a block to an activity's written material without touching what is already there. */
export function appendMaterialText(current: string, block: string): string {
  const cur = current.replace(/\s+$/, "");
  const add = block.trim();
  if (!add) return current;
  return cur ? `${cur}\n\n${add}` : add;
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
