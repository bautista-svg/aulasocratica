// Client-safe rules for every file a teacher uploads (activity material, library, the
// "Crear con IA" wizard, rubric import). One vocabulary for the whole app.

export type FileKind = "pdf" | "image" | "docx" | "text" | "audio";

/** Hard byte limit per file. There is NO page limit: long PDFs are read page by page. */
export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
export const MAX_FILES_PER_ACTIVITY = 20;
/** Images sent to the AI must be under 5 MB; the browser downsizes photos before upload. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 2200;

const EXT_KIND: Record<string, { kind: FileKind; mime: string }> = {
  pdf: { kind: "pdf", mime: "application/pdf" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  png: { kind: "image", mime: "image/png" },
  webp: { kind: "image", mime: "image/webp" },
  gif: { kind: "image", mime: "image/gif" },
  docx: { kind: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  txt: { kind: "text", mime: "text/plain" },
  md: { kind: "text", mime: "text/markdown" },
  csv: { kind: "text", mime: "text/csv" },
  mp3: { kind: "audio", mime: "audio/mpeg" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  aac: { kind: "audio", mime: "audio/aac" },
  wav: { kind: "audio", mime: "audio/wav" },
  ogg: { kind: "audio", mime: "audio/ogg" },
  oga: { kind: "audio", mime: "audio/ogg" },
  webm: { kind: "audio", mime: "audio/webm" },
};

export const FILE_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.jpg,.jpeg,.png,.webp,.gif,.mp3,.m4a,.aac,.wav,.ogg,.webm";
/** For flows where audio makes no sense (AI drafting, rubric import). */
export const DOC_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.jpg,.jpeg,.png,.webp";

export const KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF",
  image: "Imagen",
  docx: "Word",
  text: "Texto",
  audio: "Audio",
};

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function classifyFile(name: string, mimeType: string): { kind: FileKind; mime: string; ext: string } | null {
  const ext = fileExtension(name);
  const byExt = EXT_KIND[ext];
  if (byExt) return { ...byExt, ext };
  const m = (mimeType || "").toLowerCase();
  const byMime = Object.entries(EXT_KIND).find(([, v]) => v.mime === m);
  return byMime ? { ...byMime[1], ext: byMime[0] } : null;
}

export type FileCheck = { ok: true; kind: FileKind; mime: string; ext: string } | { ok: false; error: string };

export function validateUpload(file: { name: string; type: string; size: number }, opts: { allowAudio?: boolean } = {}): FileCheck {
  const c = classifyFile(file.name, file.type);
  if (!c || (c.kind === "audio" && opts.allowAudio === false)) {
    if (fileExtension(file.name) === "doc") {
      return { ok: false, error: `"${file.name}": es un Word antiguo (.doc). Guardalo como .docx o como PDF y subilo de nuevo.` };
    }
    if (["heic", "heif"].includes(fileExtension(file.name))) {
      return { ok: false, error: `"${file.name}": el formato HEIC no se puede leer. Sacá la foto en JPG o exportala como JPG.` };
    }
    return {
      ok: false,
      error: opts.allowAudio === false
        ? `"${file.name}": se aceptan PDF, Word (.docx), texto y fotos (JPG, PNG, WEBP).`
        : `"${file.name}": se aceptan PDF, Word (.docx), texto, fotos (JPG, PNG, WEBP) y audios (MP3, M4A, WAV, OGG).`,
    };
  }
  if (file.size <= 0) return { ok: false, error: `"${file.name}" está vacío.` };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `"${file.name}" pesa más de 60 MB.` };
  return { ok: true, ...c };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export type ProcessingStatus = "pending" | "processing" | "ready" | "failed";

export const PROCESSING_LABEL: Record<ProcessingStatus, string> = {
  pending: "En espera",
  processing: "Leyendo…",
  ready: "Listo",
  failed: "No se pudo leer",
};
