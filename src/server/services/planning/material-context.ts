// Builds the material the planning AI reads: the full text of every chosen library material
// (no page limit) plus pasted text. Long material is reduced with selectMaterial() to the
// fragments most related to the class, keeping file names and page markers.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { HttpError, notFound } from "../../lib/errors";
import { enqueueFile, waitForFile } from "../file-jobs";
import { assembleMaterial, selectMaterial, type MaterialSource } from "@shared/domain/material-select";
import { KIND_LABEL, type FileKind } from "@shared/domain/files";
import type { MaterialUsage } from "@shared/contracts/planning";

/** How long a proposals request waits for materials that are still being read. */
export const MATERIAL_WAIT_MS = 90_000;

type MaterialRow = typeof schema.materials.$inferSelect;

export async function loadOwnedMaterials(teacherId: string, ids: string[]): Promise<MaterialRow[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await db
    .select()
    .from(schema.materials)
    .where(and(eq(schema.materials.teacherId, teacherId), inArray(schema.materials.id, unique)));
  if (rows.length !== unique.length) throw notFound("Uno de los materiales elegidos");
  const byId = new Map(rows.map((r) => [r.id, r]));
  return unique.map((id) => byId.get(id)!);
}

/** Waits (bounded) for files still being read; then refuses with the name of any that failed. */
export async function readyMaterials(teacherId: string, ids: string[], waitMs = MATERIAL_WAIT_MS): Promise<MaterialRow[]> {
  let rows = await loadOwnedMaterials(teacherId, ids);
  const busy = rows.filter((r) => r.kind === "file" && (r.processingStatus === "pending" || r.processingStatus === "processing"));
  if (busy.length) {
    for (const r of busy) enqueueFile({ table: "materials", id: r.id });
    await Promise.all(busy.map((r) => waitForFile({ table: "materials", id: r.id }, waitMs)));
    rows = await loadOwnedMaterials(teacherId, ids);
  }
  const still = rows.filter((r) => r.processingStatus === "pending" || r.processingStatus === "processing");
  if (still.length) {
    throw new HttpError(
      409,
      `Todavía estamos leyendo ${still.map((r) => `«${r.title}»`).join(", ")}. Esperá un momento y volvé a generar las propuestas.`,
      "material_pending",
    );
  }
  const failed = rows.filter((r) => r.processingStatus === "failed");
  if (failed.length) {
    const detail = failed.map((r) => `«${r.title}»${r.processingError ? ` (${r.processingError.replace(/\.$/, "")})` : ""}`).join(", ");
    throw new HttpError(
      422,
      `No pudimos leer ${detail}. Reintentá la lectura o quitalo del paso Material para seguir.`,
      "material_failed",
    );
  }
  return rows;
}

function sourceOf(r: MaterialRow): MaterialSource {
  if (r.kind === "file") return { name: r.title, kind: KIND_LABEL[(r.fileKind ?? "text") as FileKind] ?? "archivo", text: r.extractedText };
  if (r.kind === "link") return { name: r.title, kind: "enlace", text: `Enlace: ${r.url ?? ""}${r.body.trim() ? `\n${r.body.trim()}` : ""}` };
  return { name: r.title, kind: "texto", text: r.body };
}

export interface MaterialContext {
  text: string;
  usage: MaterialUsage;
}

export function buildMaterialContext(rows: MaterialRow[], extraText: string, query: string): MaterialContext {
  const sources = rows.map(sourceOf);
  const full = assembleMaterial(extraText, sources);
  const sel = selectMaterial(full, query);
  return {
    text: sel.text,
    usage: {
      mode: sel.mode,
      totalChars: sel.totalChars,
      sentChars: sel.text.length,
      materials: rows.map((r, i) => ({ id: r.id, title: r.title, chars: sources[i]!.text.trim().length, pageCount: r.pageCount })),
    },
  };
}
