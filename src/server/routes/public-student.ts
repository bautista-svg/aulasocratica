// Student API (no account). Mounted at /api/s. Every route resolves the activity by its link
// token, re-checks availability and, except join/resume/leave, the device's session cookie.
// GET /:token is the only read allowed on a closed link: a finished work stays visible to the
// device that did it.
// The client never sends ids to choose a session.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { readJson } from "../lib/errors";
import { LINK_AVAILABILITY_MESSAGE } from "@shared/domain/access-rules";
import { LINK_AVAILABILITY_MESSAGE_EN, languageOf } from "@shared/domain/language";
import {
  chatBody,
  deliverableLinkBody,
  finishBody,
  initialAnswerBody,
  joinBody,
  resumeBody,
  signalBody,
  type StudentLinkInfo,
  type WorkspaceResponse,
} from "@shared/contracts/student";
import {
  availabilityOf,
  buildWorkspace,
  ensureAvailable,
  joinWithName,
  leaveDevice,
  linkWorkspace,
  loadLink,
  loadStudentContext,
  publicActivity,
  resumeWithCode,
} from "../services/student/session";
import { finishActivity, reportSignal, saveInitialAnswer, startClosing } from "../services/student/work";
import { tutorChat } from "../services/student/tutor";
import { serveActivityFile } from "../services/student/files";
import { removeDeliverable, saveDeliverable, saveDeliverableLink, serveStudentDeliverable } from "../services/deliverables";
import { readFileParts } from "../services/activities/files";

export const publicStudentRoutes = new Hono<AppEnv>()
  .get("/:token", async (c) => {
    const link = await loadLink(c.req.param("token"));
    const availability = availabilityOf(link);
    const info: StudentLinkInfo = {
      availability,
      message:
        availability === "available"
          ? null
          : languageOf(link.activity.language) === "en"
            ? LINK_AVAILABILITY_MESSAGE_EN[availability]
            : LINK_AVAILABILITY_MESSAGE[availability],
      startsAt: link.activity.startsAt?.toISOString() ?? null,
      expiresAt: link.activity.expiresAt?.toISOString() ?? null,
      activity: publicActivity(link),
      workspace: null,
    };
    // Open link: this device's work. Closed link: only a finished work, read-only (D38).
    info.workspace = await linkWorkspace(c, link, availability);
    return c.json(info);
  })

  .post("/:token/join", async (c) => {
    const link = await loadLink(c.req.param("token"));
    ensureAvailable(link);
    const body = await readJson(c, joinBody);
    const { ctx, created } = await joinWithName(c, link, body.name);
    return c.json({ workspace: await buildWorkspace(ctx), created } satisfies WorkspaceResponse & { created: boolean }, created ? 201 : 200);
  })

  .post("/:token/resume", async (c) => {
    const link = await loadLink(c.req.param("token"));
    ensureAvailable(link);
    const body = await readJson(c, resumeBody);
    const ctx = await resumeWithCode(c, link, body.name, body.code);
    return c.json({ workspace: await buildWorkspace(ctx) } satisfies WorkspaceResponse);
  })

  .post("/:token/leave", async (c) => {
    const link = await loadLink(c.req.param("token"));
    await leaveDevice(c, link);
    return c.json({ ok: true });
  })

  .post("/:token/initial", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    const body = await readJson(c, initialAnswerBody);
    const next = await saveInitialAnswer(ctx, body.answer);
    return c.json({ workspace: await buildWorkspace(next) } satisfies WorkspaceResponse);
  })

  .post("/:token/chat", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    const body = await readJson(c, chatBody);
    return tutorChat(c, ctx, body);
  })

  .post("/:token/closing", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    await startClosing(ctx);
    return c.json({ ok: true });
  })

  .post("/:token/finish", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    const body = await readJson(c, finishBody);
    const next = await finishActivity(ctx, body);
    return c.json({ workspace: await buildWorkspace(next) } satisfies WorkspaceResponse);
  })

  .post("/:token/signal", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    const body = await readJson(c, signalBody);
    const recorded = await reportSignal(ctx, body);
    return c.json({ ok: true, recorded });
  })

  // The file handed in with the final answer ("entrega"). The path ends in /upload so the
  // upload body limit applies; the deliverable itself is capped lower (validateDeliverable).
  .post("/:token/deliverable/upload", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    const [file] = await readFileParts(c);
    await saveDeliverable(ctx, file);
    return c.json({ workspace: await buildWorkspace(ctx) } satisfies WorkspaceResponse, 201);
  })

  // A link instead of a file (Google Drive, Docs, Canva...).
  .post("/:token/deliverable/link", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    const body = await readJson(c, deliverableLinkBody);
    await saveDeliverableLink(ctx, body.url);
    return c.json({ workspace: await buildWorkspace(ctx) } satisfies WorkspaceResponse, 201);
  })

  .delete("/:token/deliverable", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    await removeDeliverable(ctx);
    return c.json({ workspace: await buildWorkspace(ctx) } satisfies WorkspaceResponse);
  })

  .get("/:token/deliverable/file", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    return serveStudentDeliverable(c, ctx.session.id, c.req.query("download") === "1");
  })

  .get("/:token/files/:fileId", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    return serveActivityFile(c, ctx.activity.id, c.req.param("fileId"), c.req.query("download") === "1");
  });
