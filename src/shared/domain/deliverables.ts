// Client-safe rules for what a student hands in when finishing an activity ("entrega"): a file or a
// link (Google Drive, Docs, Canva…). The teacher decides per activity whether it is off, optional
// or required.
import { DOC_ACCEPT, KIND_LABEL, MAX_IMAGE_BYTES, formatBytes, validateUpload, type FileKind } from "./files";

export type DeliverableMode = "off" | "optional" | "required";

export const DELIVERABLE_MODES: Record<DeliverableMode, { label: string; description: string }> = {
  off: { label: "No pedir entrega", description: "Los alumnos terminan con su respuesta final y la reflexión." },
  optional: { label: "Opcional", description: "Al terminar pueden subir un archivo o pegar un enlace, si quieren." },
  required: { label: "Obligatoria", description: "No pueden enviar su trabajo sin subir un archivo o pegar un enlace." },
};

export function isDeliverableMode(v: unknown): v is DeliverableMode {
  return v === "off" || v === "optional" || v === "required";
}

/** Phones send photos; big ones are resized in the browser before upload. */
export const MAX_DELIVERABLE_BYTES = 25 * 1024 * 1024;
/** "25 MB" for texts that state the limit. */
export const MAX_DELIVERABLE_LABEL = "25 MB";
export const DELIVERABLE_PROMPT_MAX = 600;
/** PDF, Word, text and photos (no audio: the AI cannot read it). */
export const DELIVERABLE_ACCEPT = DOC_ACCEPT;
export const DELIVERABLE_KINDS: FileKind[] = ["pdf", "image", "docx", "text"];

export type DeliverableCheck = { ok: true; kind: FileKind; mime: string; ext: string } | { ok: false; error: string };

export function validateDeliverable(file: { name: string; type: string; size: number }): DeliverableCheck {
  const c = validateUpload(file, { allowAudio: false });
  if (!c.ok) return c;
  if (!DELIVERABLE_KINDS.includes(c.kind)) return { ok: false, error: `"${file.name}": se aceptan PDF, Word (.docx), texto y fotos (JPG, PNG, WEBP).` };
  // The AI reads photos up to 5 MB; the browser shrinks big photos before uploading them.
  if (c.kind === "image" && file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `"${file.name}" pesa ${formatBytes(file.size)}: las fotos pueden pesar hasta 5 MB. Sacala con menos resolución o mandala como PDF.` };
  }
  if (file.size > MAX_DELIVERABLE_BYTES) return { ok: false, error: `"${file.name}" pesa ${formatBytes(file.size)}: el máximo es ${MAX_DELIVERABLE_LABEL}.` };
  return c;
}

// ───────────── Links ─────────────

/** A delivery is a file or a link. */
export type DeliverableKind = FileKind | "link";

export function deliverableKindLabel(kind: DeliverableKind): string {
  return kind === "link" ? "Enlace" : KIND_LABEL[kind];
}

export const DELIVERABLE_URL_MAX = 2000;

const GOOGLE_DOC_LABELS: Record<string, string> = {
  document: "Documento de Google",
  presentation: "Presentación de Google",
  spreadsheets: "Hoja de cálculo de Google",
  forms: "Formulario de Google",
};

/** What a link is, said for people: "Documento de Google", "Diseño de Canva", "padlet.com". */
export function linkLabel(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "Enlace";
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "docs.google.com") return GOOGLE_DOC_LABELS[u.pathname.split("/")[1] ?? ""] ?? "Archivo de Google";
  if (host === "drive.google.com") return u.pathname.startsWith("/drive/folders") ? "Carpeta de Google Drive" : "Archivo de Google Drive";
  if (host.endsWith("canva.com")) return "Diseño de Canva";
  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) return "Video de YouTube";
  return host || "Enlace";
}

export type LinkCheck = { ok: true; url: string; label: string } | { ok: false; error: string };

export function validateDeliverableLink(raw: string): LinkCheck {
  const url = raw.trim();
  if (!url) return { ok: false, error: "Pegá el enlace a tu trabajo." };
  if (url.length > DELIVERABLE_URL_MAX) return { ok: false, error: "El enlace es demasiado largo." };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
  } catch {
    return { ok: false, error: "Revisá el enlace: copialo completo, empezando con https://" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Revisá el enlace: copialo completo, empezando con https://" };
  if (!u.hostname.includes(".")) return { ok: false, error: "Revisá el enlace: copialo completo, empezando con https://" };
  return { ok: true, url: u.toString(), label: linkLabel(u.toString()) };
}
