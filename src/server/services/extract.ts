// Turns uploaded files into text the tutor and the AI helpers can read.
// - PDF with a text layer: every page is extracted locally (no page limit, no AI cost).
// - Scanned PDF (little or no text): pages are sent to Claude in chunks for transcription.
// - Word (.docx): converted locally with mammoth.
// - Images: Claude transcribes visible text and describes relevant diagrams.
// - Audio: Claude cannot listen; the teacher can type a transcript (teacherNote).
import { Worker } from "node:worker_threads";
import { PDFDocument } from "pdf-lib";
import type Anthropic from "@anthropic-ai/sdk";
import { generateText, type UsageContext } from "../ai/client";
import type { FileKind } from "@shared/domain/files";
import { HttpError } from "../lib/errors";

export interface ExtractResult {
  text: string;
  pageCount: number | null;
  /** Human-readable note shown next to the file (e.g. "Se transcribió con IA"). */
  note: string | null;
}

/** Pages per request when a scanned PDF is transcribed by the AI. */
const OCR_PAGES_PER_CHUNK = 20;
/** Below this many characters per page on average we treat the PDF as scanned. */
const SCANNED_CHARS_PER_PAGE = 60;
/** Safety cap on stored text (≈ 2,500 dense pages). Longer material is still usable via retrieval. */
export const MAX_STORED_TEXT = 5_000_000;

const OCR_SYSTEM =
  "Transcribís material escolar. Devolvé el texto tal como aparece, en orden de lectura, sin resumir ni agregar comentarios. " +
  "Marcá el comienzo de cada página con [Página N]. Si hay tablas, transcribilas en filas de texto. " +
  "Si hay imágenes, gráficos o diagramas con información importante para entender el contenido, describilos en una línea entre corchetes, por ejemplo [Imagen: ...]. " +
  "Si una página no tiene texto legible, escribí [Página N: sin texto legible].";

const IMAGE_SYSTEM =
  "Transcribís material escolar a partir de una foto o imagen. Devolvé primero todo el texto visible, en orden de lectura y sin corregirlo. " +
  "Después, si la imagen tiene dibujos, esquemas, gráficos o fórmulas que importen para una actividad, describilos brevemente entre corchetes. " +
  "No inventes contenido que no se vea. Si no hay texto legible, describí lo que muestra la imagen en dos o tres oraciones.";

// ── Isolated local extraction (worker thread with hard memory/time limits) ──

const WORKER_URL = new URL(
  import.meta.url.endsWith(".ts") ? "../workers/extract-worker.ts" : "./extract-worker.mjs",
  import.meta.url,
);
const WORKER_TIMEOUT_MS = 120_000;

type WorkerResult = { ok: true; pages?: string[]; totalPages?: number; text?: string } | { ok: false; code: string };

function runIsolated(kind: "pdf" | "docx", data: Uint8Array): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_URL, {
      workerData: { kind, data },
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 },
    });
    let settled = false;
    const done = (r: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, code: "timeout" }), WORKER_TIMEOUT_MS);
    worker.once("message", (m: WorkerResult) => done(m));
    // Out of memory (ERR_WORKER_OUT_OF_MEMORY) or any crash: the API process is unaffected.
    worker.once("error", () => done({ ok: false, code: "worker_crashed" }));
    worker.once("exit", (code) => done({ ok: false, code: code === 0 ? "no_result" : "worker_crashed" }));
  });
}

const DOCX_ERRORS: Record<string, string> = {
  docx_too_large: "Este documento de Word es demasiado grande para leerlo. Guardalo como PDF y subilo de nuevo.",
};

function clean(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_STORED_TEXT);
}

async function extractPdf(data: Uint8Array, ctx: UsageContext): Promise<ExtractResult> {
  const r = await runIsolated("pdf", new Uint8Array(data));
  if (!r.ok || !r.pages) {
    throw new HttpError(422, "No pudimos abrir este PDF. Puede estar dañado o protegido con contraseña.", "pdf_unreadable");
  }
  const pages = r.pages;
  const totalPages = r.totalPages ?? pages.length;
  const chars = pages.reduce((n, p) => n + p.trim().length, 0);
  if (totalPages === 0) return { text: "", pageCount: 0, note: "El PDF no tiene páginas." };

  if (chars / totalPages >= SCANNED_CHARS_PER_PAGE) {
    const text = pages.map((p, i) => `[Página ${i + 1}]\n${p.trim()}`).join("\n\n");
    return { text: clean(text), pageCount: totalPages, note: null };
  }

  // Scanned PDF: transcribe with the AI in chunks of pages.
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  const parts: string[] = [];
  for (let start = 0; start < totalPages; start += OCR_PAGES_PER_CHUNK) {
    const end = Math.min(totalPages, start + OCR_PAGES_PER_CHUNK);
    const chunk = await PDFDocument.create();
    const copied = await chunk.copyPages(src, Array.from({ length: end - start }, (_, i) => start + i));
    copied.forEach((p) => chunk.addPage(p));
    const b64 = Buffer.from(await chunk.save()).toString("base64");
    const content: Anthropic.ContentBlockParam[] = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
      { type: "text", text: `Estas son las páginas ${start + 1} a ${end} del documento. Numerá las páginas a partir de ${start + 1}.` },
    ];
    parts.push(await generateText({ ...ctx, purpose: "file_extraction", system: OCR_SYSTEM, content, maxTokens: 32000 }));
  }
  return { text: clean(parts.join("\n\n")), pageCount: totalPages, note: "PDF escaneado: el texto se transcribió con IA." };
}

async function extractDocx(data: Uint8Array): Promise<ExtractResult> {
  const r = await runIsolated("docx", data);
  if (!r.ok || r.text === undefined) {
    const msg = (!r.ok && DOCX_ERRORS[r.code]) || "No pudimos leer este documento de Word. Probá guardarlo de nuevo como .docx o como PDF.";
    throw new HttpError(422, msg, "docx_unreadable");
  }
  return { text: clean(r.text), pageCount: null, note: null };
}

async function extractImage(data: Uint8Array, mime: string, ctx: UsageContext): Promise<ExtractResult> {
  if (data.byteLength > 5 * 1024 * 1024) {
    throw new HttpError(422, "La imagen pesa más de 5 MB. Probá con una foto de menor resolución.", "image_too_large");
  }
  const media = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime) ? mime : "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/gif";
  const text = await generateText({
    ...ctx,
    purpose: "file_extraction",
    system: IMAGE_SYSTEM,
    content: [
      { type: "image", source: { type: "base64", media_type: media, data: Buffer.from(data).toString("base64") } },
      { type: "text", text: "Transcribí esta imagen." },
    ],
    maxTokens: 8000,
  });
  return { text: clean(text), pageCount: null, note: "Imagen leída con IA." };
}

export async function extractFile(input: { data: Uint8Array; kind: FileKind; mime: string; ctx: UsageContext }): Promise<ExtractResult> {
  switch (input.kind) {
    case "pdf":
      return extractPdf(input.data, input.ctx);
    case "docx":
      return extractDocx(input.data);
    case "text":
      return { text: clean(new TextDecoder("utf-8", { fatal: false }).decode(input.data)), pageCount: null, note: null };
    case "image":
      return extractImage(input.data, input.mime, input.ctx);
    case "audio":
      return {
        text: "",
        pageCount: null,
        note: "El tutor no puede escuchar audios. Si querés que lo use, escribí una transcripción o un resumen.",
      };
  }
}
