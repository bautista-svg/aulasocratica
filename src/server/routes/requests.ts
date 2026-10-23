// /api/requests — "Pedidos de cambios", only for workspaces the admin enabled.
import { Hono } from "hono";
import { Readable } from "node:stream";
import type { AppEnv } from "../types";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { badRequest, notFound } from "../lib/errors";
import { fileSize, fileStream } from "../lib/storage";
import { rateLimit } from "../lib/rate-limit";
import { audit } from "../services/audit";
import {
  addMessage,
  assertRequestAccess,
  deleteDraft,
  imageOf,
  listRequests,
  openDraft,
  ownedRequest,
  reply,
  submitRequest,
  teacherView,
  withdrawRequest,
} from "../services/requests";
import { REQUEST_TEXT_MAX } from "@shared/contracts/requests";

const byTeacher = (c: Parameters<typeof teacherOf>[0]) => c.get("teacher")?.id ?? "anon";

export const requestRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)
  .use("*", async (c, next) => {
    await assertRequestAccess(teacherOf(c).id);
    await next();
  })

  .get("/", async (c) => c.json({ requests: await listRequests(teacherOf(c).id) }))

  .post("/", async (c) => {
    const r = await openDraft(teacherOf(c).id);
    return c.json({ request: teacherView(r) }, 201);
  })

  .get("/:id", async (c) => {
    const r = await ownedRequest(teacherOf(c).id, c.req.param("id"));
    return c.json({ request: teacherView(r) });
  })

  // Multipart: `text` and up to 3 `file` screenshots. Saved at once; the AI answers via /reply.
  .post("/:id/messages", rateLimit("request-message", 60, 60 * 60_000, byTeacher), async (c) => {
    const t = teacherOf(c);
    const r = await ownedRequest(t.id, c.req.param("id"));
    let text = "";
    let files: File[] = [];
    if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
      let body: Record<string, unknown>;
      try {
        body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
      } catch {
        throw badRequest("No pudimos leer lo que enviaste. Probá de nuevo.");
      }
      const raw = body.file;
      files = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter(
        (v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v,
      );
      text = typeof body.text === "string" ? body.text : "";
    } else {
      const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
      text = typeof body.text === "string" ? body.text : "";
    }
    if (text.length > REQUEST_TEXT_MAX) throw badRequest(`Usá hasta ${REQUEST_TEXT_MAX} caracteres por mensaje.`);
    const saved = await addMessage(r, text, files);
    return c.json({ request: teacherView(saved) });
  })

  .post("/:id/reply", rateLimit("request-reply", 60, 60 * 60_000, byTeacher), async (c) => {
    const r = await ownedRequest(teacherOf(c).id, c.req.param("id"));
    return c.json({ request: teacherView(await reply(r)) });
  })

  .post("/:id/submit", async (c) => {
    const t = teacherOf(c);
    const r = await ownedRequest(t.id, c.req.param("id"));
    const saved = await submitRequest(r);
    if (r.status === "draft") await audit(c, t.id, "change_request_submitted", "change_request", r.id);
    return c.json({ request: teacherView(saved) });
  })

  .post("/:id/withdraw", async (c) => {
    const r = await ownedRequest(teacherOf(c).id, c.req.param("id"));
    return c.json({ request: teacherView(await withdrawRequest(r)) });
  })

  .delete("/:id", async (c) => {
    const r = await ownedRequest(teacherOf(c).id, c.req.param("id"));
    await deleteDraft(r);
    return c.json({ ok: true });
  })

  .get("/:id/images/:imageId", async (c) => {
    const r = await ownedRequest(teacherOf(c).id, c.req.param("id"));
    const img = imageOf(r, c.req.param("imageId"));
    const size = await fileSize(img.key);
    if (size === null) throw notFound("La captura");
    const body = Readable.toWeb(fileStream(img.key)) as unknown as ReadableStream;
    return c.body(body, 200, { "Content-Type": img.mime, "Content-Length": String(size), "Cache-Control": "private, max-age=3600" });
  });
