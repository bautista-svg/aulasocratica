// "Pedidos de cambios": a teacher with access talks to an AI that asks until the change is
// clear, confirms the summary and sends it; the developer reads and answers through /api/admin.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "../../db/client";
import { generateStructured } from "../../ai/client";
import { HttpError, badRequest, forbidden, notFound } from "../../lib/errors";
import { deleteFile, newKey, readFile, saveFile } from "../../lib/storage";
import { isUuid } from "../access";
import { safeFileName } from "../activities/files";
import { INTERVIEWER_SYSTEM } from "./prompt";
import { MAX_IMAGE_BYTES, classifyFile } from "@shared/domain/files";
import {
  REQUEST_IMAGES_MAX,
  REQUEST_KINDS,
  type AdminChangeRequest,
  type ChangeRequestView,
  type RequestKind,
  type RequestMessage,
  type RequestStatus,
  type RequestSummary,
} from "@shared/contracts/requests";

type Row = typeof schema.changeRequests.$inferSelect;
interface StoredImage {
  id: string;
  key: string;
  name: string;
  mime: string;
}

export const GREETING =
  "¡Hola! Contame qué te gustaría cambiar, agregar o qué no te está funcionando. Si te ayuda, adjuntá una captura de la pantalla con el clip.";
/** Images in one message, and a ceiling on the conversation (then: send it and start another). */
export const IMAGES_PER_MESSAGE = 3;
export const MAX_MESSAGES = 40;
/** Screenshots sent to the AI on each turn, newest first, up to this many bytes. */
const AI_IMAGE_BYTES = 12 * 1024 * 1024;

const messagesOf = (r: Row): RequestMessage[] => (Array.isArray(r.messages) ? (r.messages as RequestMessage[]) : []);
const imagesOf = (r: Row): StoredImage[] => (Array.isArray(r.images) ? (r.images as StoredImage[]) : []);
const teacherWrote = (r: Row) => messagesOf(r).some((m) => m.role === "teacher");

function view(r: Row, base: string): ChangeRequestView {
  const messages = messagesOf(r);
  return {
    id: r.id,
    status: r.status as RequestStatus,
    title: r.title,
    summary: (r.summary as RequestSummary | null) ?? null,
    ready: r.ready,
    awaitingReply: messages.at(-1)?.role === "teacher" && (r.status === "draft" || r.status === "pending"),
    messages,
    images: imagesOf(r).map((i) => ({ id: i.id, name: i.name, url: `${base}/${r.id}/images/${i.id}` })),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    submittedAt: r.submittedAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  };
}

export const teacherView = (r: Row) => view(r, "/api/requests");

// ── Access ──

export async function canRequestChanges(teacherId: string): Promise<boolean> {
  const [row] = await db
    .select({ on: schema.teachers.canRequestChanges })
    .from(schema.teachers)
    .where(eq(schema.teachers.id, teacherId))
    .limit(1);
  return Boolean(row?.on);
}

export async function assertRequestAccess(teacherId: string): Promise<void> {
  if (!(await canRequestChanges(teacherId))) throw forbidden("Esta sección no está habilitada en tu cuenta.");
}

/** Admin: turn the section on or off for an account (by its email). Touches nothing else. */
export async function setRequestAccess(email: string, enabled: boolean) {
  const [row] = await db
    .update(schema.teachers)
    .set({ canRequestChanges: enabled })
    .where(sql`lower(${schema.teachers.email}) = ${email.toLowerCase()}`)
    .returning({ id: schema.teachers.id, name: schema.teachers.displayName, email: schema.teachers.email });
  if (!row) throw notFound("La cuenta con ese correo");
  return { ...row, enabled };
}

// ── Teacher side ──

export async function listRequests(teacherId: string): Promise<ChangeRequestView[]> {
  const rows = await db
    .select()
    .from(schema.changeRequests)
    .where(eq(schema.changeRequests.teacherId, teacherId))
    .orderBy(desc(schema.changeRequests.createdAt))
    .limit(100);
  // A draft she opened and never wrote in is not a request yet.
  return rows.filter((r) => r.status !== "draft" || teacherWrote(r)).map(teacherView);
}

export async function ownedRequest(teacherId: string, id: string): Promise<Row> {
  if (!isUuid(id)) throw notFound("El pedido");
  const [row] = await db
    .select()
    .from(schema.changeRequests)
    .where(and(eq(schema.changeRequests.id, id), eq(schema.changeRequests.teacherId, teacherId)))
    .limit(1);
  if (!row) throw notFound("El pedido");
  return row;
}

/** A new conversation (or the empty one she already opened, so "Nuevo pedido" twice makes one). */
export async function openDraft(teacherId: string): Promise<Row> {
  const drafts = await db
    .select()
    .from(schema.changeRequests)
    .where(and(eq(schema.changeRequests.teacherId, teacherId), eq(schema.changeRequests.status, "draft")))
    .orderBy(desc(schema.changeRequests.createdAt));
  const empty = drafts.find((d) => !teacherWrote(d));
  if (empty) return empty;
  const greeting: RequestMessage = { role: "assistant", text: GREETING, imageIds: [], at: new Date().toISOString() };
  const [row] = await db.insert(schema.changeRequests).values({ teacherId, messages: [greeting] }).returning();
  return row!;
}

function assertOpen(r: Row) {
  if (r.status !== "draft" && r.status !== "pending") {
    throw new HttpError(409, "Este pedido ya está cerrado. Si querés sumar algo, empezá un pedido nuevo.", "closed");
  }
}

/** Saves her message (text and screenshots). The AI answers in a second call (`reply`). */
export async function addMessage(r: Row, text: string, files: File[]): Promise<Row> {
  assertOpen(r);
  if (!text.trim() && files.length === 0) throw badRequest("Escribí un mensaje o adjuntá una captura.");
  if (messagesOf(r).length >= MAX_MESSAGES) {
    throw badRequest("Esta conversación ya es larga: enviá el pedido como está y, si hace falta, empezá otro.");
  }
  if (files.length > IMAGES_PER_MESSAGE) throw badRequest(`Adjuntá hasta ${IMAGES_PER_MESSAGE} capturas por mensaje.`);
  if (imagesOf(r).length + files.length > REQUEST_IMAGES_MAX) {
    throw badRequest(`Un pedido puede tener hasta ${REQUEST_IMAGES_MAX} capturas.`);
  }
  const checked = files.map((f) => {
    const c = classifyFile(f.name, f.type);
    if (!c || c.kind !== "image") throw badRequest(`"${safeFileName(f.name)}": adjuntá capturas o fotos (JPG, PNG o WEBP).`);
    if (f.size <= 0) throw badRequest(`"${safeFileName(f.name)}" está vacía.`);
    if (f.size > MAX_IMAGE_BYTES) throw badRequest(`"${safeFileName(f.name)}" pesa más de 5 MB.`);
    return { file: f, ...c };
  });
  const added: StoredImage[] = [];
  for (const c of checked) {
    const key = newKey("requests", r.teacherId, c.ext);
    await saveFile(key, new Uint8Array(await c.file.arrayBuffer()));
    added.push({ id: randomUUID(), key, name: safeFileName(c.file.name), mime: c.mime });
  }
  const message: RequestMessage = { role: "teacher", text: text.trim(), imageIds: added.map((i) => i.id), at: new Date().toISOString() };
  const [saved] = await db
    .update(schema.changeRequests)
    .set({ messages: [...messagesOf(r), message], images: [...imagesOf(r), ...added], updatedAt: new Date() })
    .where(eq(schema.changeRequests.id, r.id))
    .returning();
  return saved!;
}

const interviewSchema = z.object({
  reply: z.string(),
  ready: z.boolean(),
  summary: z.object({
    kind: z.string(),
    title: z.string(),
    screen: z.string(),
    today: z.string(),
    desired: z.string(),
    details: z.array(z.string()),
  }),
});

const clip = (s: string, n: number) => s.trim().replace(/\s+\n/g, "\n").slice(0, n);
const toKind = (k: string): RequestKind => {
  const v = k.trim().toLowerCase();
  return (REQUEST_KINDS as readonly string[]).includes(v) ? (v as RequestKind) : "change";
};

export function cleanSummary(s: z.infer<typeof interviewSchema>["summary"]): RequestSummary {
  return {
    kind: toKind(s.kind),
    title: clip(s.title, 120) || "Pedido sin título",
    screen: clip(s.screen, 240),
    today: clip(s.today, 1500),
    desired: clip(s.desired, 1500),
    details: s.details.map((d) => clip(d, 500)).filter(Boolean).slice(0, 8),
  };
}

const MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type Media = (typeof MEDIA)[number];

/** The conversation as the AI reads it: her words and her screenshots (newest first within a byte budget). */
async function conversationContent(r: Row): Promise<Anthropic.ContentBlockParam[]> {
  const images = new Map(imagesOf(r).map((i) => [i.id, i]));
  const messages = messagesOf(r);
  const include = new Map<string, string>();
  let budget = AI_IMAGE_BYTES;
  for (const m of [...messages].reverse()) {
    for (const id of [...m.imageIds].reverse()) {
      const img = images.get(id);
      if (!img) continue;
      const data = await readFile(img.key).catch(() => null);
      if (!data || data.byteLength > budget) continue;
      budget -= data.byteLength;
      include.set(id, data.toString("base64"));
    }
  }
  const blocks: Anthropic.ContentBlockParam[] = [{ type: "text", text: "CONVERSACIÓN HASTA AHORA:" }];
  for (const m of messages) {
    blocks.push({ type: "text", text: `${m.role === "teacher" ? "DOCENTE" : "VOS (asistente)"}: ${m.text || "(sin texto)"}` });
    for (const id of m.imageIds) {
      const img = images.get(id);
      const data = include.get(id);
      if (img && data) {
        const media: Media = (MEDIA as readonly string[]).includes(img.mime) ? (img.mime as Media) : "image/jpeg";
        blocks.push({ type: "image", source: { type: "base64", media_type: media, data } });
      } else {
        blocks.push({ type: "text", text: "(adjuntó una captura que no se incluye acá)" });
      }
    }
  }
  blocks.push({ type: "text", text: "Respondé al último mensaje de la docente y actualizá el resumen." });
  return blocks;
}

/** The AI's next turn. If it fails, her message stays saved and the page offers to retry. */
async function answer(r: Row): Promise<Row> {
  const out = await generateStructured({
    purpose: "change_request",
    teacherId: r.teacherId,
    effort: "medium",
    maxTokens: 3000,
    system: INTERVIEWER_SYSTEM,
    content: await conversationContent(r),
    schema: interviewSchema,
  });
  const summary = cleanSummary(out.summary);
  const reply: RequestMessage = {
    role: "assistant",
    text: clip(out.reply, 2000) || "¿Me contás un poco más?",
    imageIds: [],
    at: new Date().toISOString(),
  };
  const [saved] = await db
    .update(schema.changeRequests)
    .set({ messages: [...messagesOf(r), reply], summary, title: summary.title, ready: out.ready, updatedAt: new Date() })
    .where(eq(schema.changeRequests.id, r.id))
    .returning();
  return saved!;
}

/** Answers her last message (right after she sends it, or again when the first try failed). */
export async function reply(r: Row): Promise<Row> {
  assertOpen(r);
  if (messagesOf(r).at(-1)?.role !== "teacher") return r;
  return answer(r);
}

export async function submitRequest(r: Row): Promise<Row> {
  if (r.status !== "draft") return r;
  if (!teacherWrote(r)) throw badRequest("Contá primero qué querés cambiar.");
  const [saved] = await db
    .update(schema.changeRequests)
    .set({ status: "pending", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.changeRequests.id, r.id))
    .returning();
  return saved!;
}

/** She takes back a request that was sent and not started (it stays in the list as discarded). */
export async function withdrawRequest(r: Row): Promise<Row> {
  if (r.status !== "pending") throw new HttpError(409, "Solo se puede cancelar un pedido enviado que todavía no empezó.", "closed");
  const [saved] = await db
    .update(schema.changeRequests)
    .set({ status: "discarded", resolvedAt: new Date(), note: r.note || "Cancelado por la docente.", updatedAt: new Date() })
    .where(eq(schema.changeRequests.id, r.id))
    .returning();
  return saved!;
}

export async function deleteDraft(r: Row): Promise<void> {
  if (r.status !== "draft") throw new HttpError(409, "Un pedido enviado no se borra: si ya no lo necesitás, cancelalo.", "closed");
  await db.delete(schema.changeRequests).where(eq(schema.changeRequests.id, r.id));
  for (const img of imagesOf(r)) await deleteFile(img.key).catch(() => {});
}

export function imageOf(r: Row, imageId: string): StoredImage {
  const img = imagesOf(r).find((i) => i.id === imageId);
  if (!img) throw notFound("La captura");
  return img;
}

// ── Admin side ──

const ADMIN_STATUSES = ["pending", "in_progress", "done", "discarded"] as const;

export async function adminListRequests(status?: string): Promise<AdminChangeRequest[]> {
  const wanted = status === "all" ? [...ADMIN_STATUSES] : status && (ADMIN_STATUSES as readonly string[]).includes(status) ? [status] : ["pending", "in_progress"];
  const rows = await db
    .select({ r: schema.changeRequests, name: schema.teachers.displayName, email: schema.teachers.email })
    .from(schema.changeRequests)
    .innerJoin(schema.teachers, eq(schema.teachers.id, schema.changeRequests.teacherId))
    .where(inArray(schema.changeRequests.status, wanted))
    .orderBy(desc(sql`coalesce(${schema.changeRequests.submittedAt}, ${schema.changeRequests.createdAt})`))
    .limit(200);
  return rows.map(({ r, name, email }) => ({ ...view(r, "/api/admin/requests"), teacher: { id: r.teacherId, name, email } }));
}

export async function adminRequest(id: string): Promise<Row> {
  if (!isUuid(id)) throw notFound("El pedido");
  const [row] = await db.select().from(schema.changeRequests).where(eq(schema.changeRequests.id, id)).limit(1);
  if (!row || row.status === "draft") throw notFound("El pedido");
  return row;
}

export async function adminUpdateRequest(r: Row, patch: { status?: Exclude<RequestStatus, "draft">; note?: string }) {
  const status = patch.status ?? (r.status as RequestStatus);
  const closed = status === "done" || status === "discarded";
  const [saved] = await db
    .update(schema.changeRequests)
    .set({
      status,
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      resolvedAt: closed ? (r.resolvedAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.changeRequests.id, r.id))
    .returning();
  return view(saved!, "/api/admin/requests");
}
