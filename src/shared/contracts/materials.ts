import { z } from "zod";
import type { FileKind, ProcessingStatus } from "../domain/files";
import { MAX_FOLDER_LENGTH, MAX_LINK_NOTE, MAX_MATERIAL_TITLE, MAX_TEXT_BODY, isSafeUrl, type MaterialKind } from "../domain/library";

/** One material of the library. Lists never include the body or the extracted text. */
export interface MaterialSummary {
  id: string;
  title: string;
  kind: MaterialKind;
  fileKind: FileKind | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  pageCount: number | null;
  url: string | null;
  folder: string;
  tags: string[];
  processingStatus: ProcessingStatus;
  /** Failure reason (failed) or a note about how it was read (ready), e.g. "Imagen leída con IA." */
  processingError: string | null;
  /** Failed files only: false when reading it again cannot work (damaged or protected file…): remove it instead. */
  retryable: boolean;
  /** Characters of readable text: extracted text (files) or body (texts, link notes). */
  textChars: number;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialDetail extends MaterialSummary {
  /** Written text (kind text) or the link description (kind link). Empty for files. */
  body: string;
}

export interface MaterialListResponse {
  materials: MaterialSummary[];
  /** All folders of the workspace with their counts (not affected by the filters). */
  folders: { name: string; count: number }[];
  tags: { name: string; count: number }[];
  /** Materials in the workspace (not filtered) and the limit. */
  total: number;
  limit: number;
}

export interface UploadResponse {
  materials: MaterialSummary[];
  /** Files that were not accepted, with the reason. */
  rejected: { fileName: string; message: string }[];
}

export interface MaterialTextPage {
  text: string;
  offset: number;
  limit: number;
  total: number;
  pageCount: number | null;
}

export interface AttachResponse {
  /** "file": copied as an activity file; "text": appended to the written material. */
  attachedAs: "file" | "text";
  activityId: string;
  /** For files that were still being read: the copy keeps processing on its own. */
  processing: boolean;
}

const title = z.string().trim().min(1, "Poné un nombre.").max(MAX_MATERIAL_TITLE, `Usá hasta ${MAX_MATERIAL_TITLE} caracteres.`);
const folder = z.string().trim().max(MAX_FOLDER_LENGTH, `Usá hasta ${MAX_FOLDER_LENGTH} caracteres.`);
const tags = z.union([z.string().max(2000), z.array(z.string().max(200)).max(50)]);
const url = z
  .string()
  .trim()
  .max(2000, "El enlace es demasiado largo.")
  .refine((u) => isSafeUrl(u), "Revisá el enlace: tiene que empezar con https:// o http://");

export const createMaterialBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    title,
    body: z.string().trim().min(1, "Escribí el texto.").max(MAX_TEXT_BODY, `Usá hasta ${MAX_TEXT_BODY} caracteres.`),
    folder: folder.default(""),
    tags: tags.default([]),
    /** Same id again (double click, retry after a lost response) → the material created the first time. */
    requestId: z.string().uuid().optional(),
  }),
  z.object({
    kind: z.literal("link"),
    title,
    url,
    body: z.string().trim().max(MAX_LINK_NOTE, `Usá hasta ${MAX_LINK_NOTE} caracteres.`).default(""),
    folder: folder.default(""),
    tags: tags.default([]),
    requestId: z.string().uuid().optional(),
  }),
]);
export type CreateMaterialInput = z.input<typeof createMaterialBody>;

export const updateMaterialBody = z.object({
  title: title.optional(),
  folder: folder.optional(),
  tags: tags.optional(),
  /** Text materials: the text. Links: the description. */
  body: z.string().trim().max(MAX_TEXT_BODY, `Usá hasta ${MAX_TEXT_BODY} caracteres.`).optional(),
  url: url.optional(),
});
export type UpdateMaterialInput = z.input<typeof updateMaterialBody>;

export const attachMaterialBody = z.object({ activityId: z.string().uuid("Elegí una actividad.") });
