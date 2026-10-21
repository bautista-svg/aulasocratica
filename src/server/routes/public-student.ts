// Student API (no account). Mounted at /api/s. Every route resolves the activity by its link
// token, re-checks availability and, except join/resume/leave, the device's session cookie.
// The client never sends ids to choose a session.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { readJson } from "../lib/errors";
import { LINK_AVAILABILITY_MESSAGE } from "@shared/domain/access-rules";
import {
  chatBody,
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
  deviceSession,
  ensureAvailable,
  joinWithName,
  leaveDevice,
  loadLink,
  loadStudentContext,
  publicActivity,
  resumeWithCode,
} from "../services/student/session";
import { finishActivity, reportSignal, saveInitialAnswer, startClosing } from "../services/student/work";
import { tutorChat } from "../services/student/tutor";
import { serveActivityFile } from "../services/student/files";

export const publicStudentRoutes = new Hono<AppEnv>()
  .get("/:token", async (c) => {
    const link = await loadLink(c.req.param("token"));
    const availability = availabilityOf(link);
    const info: StudentLinkInfo = {
      availability,
      message: availability === "available" ? null : LINK_AVAILABILITY_MESSAGE[availability],
      startsAt: link.activity.startsAt?.toISOString() ?? null,
      expiresAt: link.activity.expiresAt?.toISOString() ?? null,
      activity: publicActivity(link),
      workspace: null,
    };
    if (availability === "available") {
      const ctx = await deviceSession(c, link);
      if (ctx) info.workspace = await buildWorkspace(ctx);
    }
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

  .get("/:token/files/:fileId", async (c) => {
    const ctx = await loadStudentContext(c, c.req.param("token"));
    return serveActivityFile(c, ctx.activity.id, c.req.param("fileId"), c.req.query("download") === "1");
  });
