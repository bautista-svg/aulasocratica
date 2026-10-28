// "Compartir aula": invitations by link, members' roles and what each role can do. A teacher with
// no relation to the classroom gets 404 everywhere; a reader 200 on reads and 403 on every change.
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { call, newTeacher, newClassroom } from "./helpers";
import { insertActivity, insertAlert, insertFullWork, insertStudent } from "./live-fixtures";
import { aiMock } from "./ai-mock";
import { db, schema } from "@server/db/client";

type Who = { cookie: string; id: string };

let accounts = 0;
/** A workspace with an account (needed to accept an invitation). */
async function newAccount(): Promise<Who> {
  const t = await newTeacher();
  accounts++;
  const r = await call("POST", "/api/auth/register", { cookie: t.cookie, body: { email: `docente${accounts}-${Date.now()}@escuela.edu.ar`, password: "una-clave-larga-de-prueba" } });
  if (r.status !== 200 && r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return t;
}

async function invite(owner: Who, classroomId: string, role: "admin" | "editor" | "reader") {
  const r = await call("POST", `/api/classrooms/${classroomId}/invites`, { cookie: owner.cookie, body: { role } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { token: string; invite: { id: string } };
}

async function join(owner: Who, classroomId: string, role: "admin" | "editor" | "reader") {
  const member = await newAccount();
  const { token } = await invite(owner, classroomId, role);
  const r = await call("POST", `/api/invites/${token}/accept`, { cookie: member.cookie });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return member;
}

/** Owner's classroom with an activity, a student's complete work, an alert and a custom alert setting. */
async function sharedRoom() {
  const owner = await newAccount();
  const roomId = await newClassroom(owner.cookie, "Social Studies- 1° ES");
  const activity = await insertActivity(owner.id, roomId);
  const student = await insertStudent(roomId, "Ana Pérez");
  const session = await insertFullWork(activity.id, student.id);
  const alert = await insertAlert(session);
  const custom = await call("POST", `/api/classrooms/${roomId}/alerts`, {
    cookie: owner.cookie,
    body: { name: "Habla de otro tema", description: "Escribe sobre algo que no es la consigna.", category: "conducta", severity: "review" },
  });
  expect(custom.status).toBe(201);
  const [file] = await db
    .insert(schema.activityFiles)
    .values({ activityId: activity.id, storageKey: `activities/${activity.id}/x.txt`, fileName: "x.txt", mimeType: "text/plain", kind: "text", sizeBytes: 4, processingStatus: "ready", extractedText: "hola" })
    .returning();
  return { owner, roomId, activity, student, session, alert, alertConfigId: custom.body.alert.id as string, fileId: file!.id };
}

type Case = [method: string, path: string, opts?: { body?: unknown; form?: FormData }];

/** Every change on a classroom and what hangs from it, with valid bodies. */
function mutations(s: Awaited<ReturnType<typeof sharedRoom>>, extra: { otherMemberId: string; inviteId: string; tutorId: string; materialId: string }): Case[] {
  const room = `/api/classrooms/${s.roomId}`;
  const act = `/api/activities/${s.activity.id}`;
  const ses = `/api/sessions/${s.session.id}`;
  const live = `/api/live/${s.activity.id}`;
  return [
    ["PATCH", room, { body: { name: "Otro nombre" } }],
    ["DELETE", room],
    ["POST", `${room}/students`, { body: { names: ["Bruno Díaz"] } }],
    ["PATCH", `${room}/students/${s.student.id}`, { body: { fullName: "Ana María Pérez" } }],
    ["DELETE", `${room}/students/${s.student.id}`],
    ["PUT", `${room}/alerts/builtin/low_engagement`, { body: { enabled: false } }],
    ["POST", `${room}/alerts`, { body: { name: "Otra alerta", description: "Algo para detectar.", category: "conducta", severity: "review" } }],
    ["PATCH", `${room}/alerts/${s.alertConfigId}`, { body: { enabled: false } }],
    ["DELETE", `${room}/alerts/${s.alertConfigId}`],
    ["POST", `${room}/invites`, { body: { role: "reader" } }],
    ["DELETE", `${room}/invites/${extra.inviteId}`],
    ["PATCH", `${room}/members/${extra.otherMemberId}`, { body: { role: "admin" } }],
    ["DELETE", `${room}/members/${extra.otherMemberId}`],
    ["POST", "/api/activities", { body: { classroomId: s.roomId, title: "Nueva" } }],
    ["PATCH", act, { body: { title: "Cambiada" } }],
    ["POST", `${act}/tutor`, { body: { tutorId: extra.tutorId } }],
    ["POST", `${act}/skills/reevaluate`],
    ["POST", `${act}/publish`],
    ["POST", `${act}/unpublish`],
    ["POST", `${act}/archive`],
    ["POST", `${act}/restore`],
    ["POST", `${act}/trash`],
    ["POST", `${act}/untrash`],
    ["POST", `${act}/duplicate`, { body: {} }],
    ["POST", `${act}/reset`, { body: { confirm: "REINICIAR" } }],
    ["DELETE", act, { body: { confirm: "BORRAR" } }],
    ["PATCH", `${act}/link`, { body: { linkActive: false } }],
    ["POST", `${act}/link/regenerate`],
    ["POST", `${act}/files`, { form: new FormData() }],
    ["PATCH", `${act}/files/${s.fileId}`, { body: { teacherNote: "nota" } }],
    ["POST", `${act}/files/${s.fileId}/retry`],
    ["DELETE", `${act}/files/${s.fileId}`],
    ["POST", `${act}/ai/rubric`, { body: {} }],
    ["POST", `${act}/ai/reflection`, { body: { count: 2 } }],
    ["POST", `${act}/rubric/import`, { form: new FormData() }],
    ["POST", `/api/materials/${extra.materialId}/attach`, { body: { activityId: s.activity.id } }],
    ["POST", `${ses}/end`],
    ["POST", `${ses}/reopen`],
    ["DELETE", ses, { body: { confirm: "BORRAR" } }],
    ["POST", `${ses}/deliverable/analyze`],
    ["POST", `${ses}/deliverable/retry`],
    ["POST", `${ses}/rubric/suggest`],
    ["POST", `${ses}/skills/analyze`],
    ["PUT", `${ses}/skills/recommendations`, { body: { recommendations: [] } }],
    ["PATCH", `${ses}/skills/argumentacion`, { body: { status: "logrado" } }],
    ["DELETE", `${ses}/rubric/suggestion`],
    ["PUT", `${ses}/rubric`, { body: { levels: {} } }],
    ["POST", `${ses}/summary`, { body: { basis: ["objectives"] } }],
    ["POST", `${ses}/xray/analyze`],
    ["PATCH", `${ses}/xray/items/x1`, { body: { status: "validated" } }],
    ["PATCH", `${live}/alerts/${s.alert.id}`, { body: { status: "reviewed" } }],
    ["POST", `${live}/end-all`, { body: {} }],
    ["PATCH", `/api/alerts/${s.alert.id}`, { body: { status: "reviewed" } }],
    ["POST", "/api/alerts/bulk", { body: { ids: [s.alert.id], status: "dismissed" } }],
    ["POST", "/api/planning/proposals", { body: { classroomId: s.roomId, topic: "La Revolución de Mayo" } }],
  ];
}

/** Reads on the classroom and everything in it. */
function reads(s: Awaited<ReturnType<typeof sharedRoom>>): string[] {
  const room = `/api/classrooms/${s.roomId}`;
  const act = `/api/activities/${s.activity.id}`;
  return [
    room,
    `${room}/activities`,
    `${room}/trash`,
    `${room}/students`,
    `${room}/alerts`,
    `${room}/sharing`,
    act,
    `${act}/skills`,
    `${act}/files`,
    `${act}/files/${s.fileId}/text`,
    `/api/live/${s.activity.id}`,
    `/api/sessions/${s.session.id}`,
    `/api/sessions/${s.session.id}/journey.pdf`,
    `/api/students/${s.student.id}`,
  ];
}

async function extras(s: Awaited<ReturnType<typeof sharedRoom>>, actor: Who) {
  const other = await join(s.owner, s.roomId, "reader");
  const { invite: inv } = await invite(s.owner, s.roomId, "editor");
  const tutors = await call("GET", "/api/tutors", { cookie: actor.cookie });
  const material = await call("POST", "/api/materials", { cookie: actor.cookie, body: { kind: "text", title: "Apunte", body: "Texto del apunte." } });
  expect(material.status).toBe(201);
  return { otherMemberId: other.id, inviteId: inv.id, tutorId: tutors.body.tutors[0].id as string, materialId: material.body.material.id as string };
}

describe("Compartir aula: invitaciones", () => {
  it("an invited teacher with an account joins with the role of the link, and sees the classroom as shared", async () => {
    const s = await sharedRoom();
    const { token } = await invite(s.owner, s.roomId, "editor");
    expect(token.length).toBeGreaterThanOrEqual(40);
    // Only the hash is stored.
    const stored = await db.select().from(schema.classroomInvites);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toBe(token);
    expect(stored[0]!.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    // The page of the link works without a workspace on the device.
    const anon = await call("GET", `/api/invites/${token}`);
    expect(anon.status).toBe(200);
    expect(anon.body).toMatchObject({ status: "valid", role: "editor", classroom: { id: s.roomId }, viewer: { signedIn: false, hasAccount: false, currentRole: null } });
    expect(anon.body.classroom.label).toContain("Social Studies");

    const member = await newAccount();
    const seen = await call("GET", `/api/invites/${token}`, { cookie: member.cookie });
    expect(seen.body.viewer).toEqual({ signedIn: true, hasAccount: true, currentRole: null });
    const ok = await call("POST", `/api/invites/${token}/accept`, { cookie: member.cookie });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ classroomId: s.roomId, role: "editor" });

    const list = await call("GET", "/api/classrooms", { cookie: member.cookie });
    expect(list.body.classrooms).toHaveLength(1);
    expect(list.body.classrooms[0]).toMatchObject({ id: s.roomId, role: "editor", memberCount: 1 });
    expect(list.body.classrooms[0].ownerName).toMatch(/@escuela\.edu\.ar$/);
    const own = await call("GET", "/api/classrooms", { cookie: s.owner.cookie });
    expect(own.body.classrooms[0]).toMatchObject({ role: "owner", ownerName: "", memberCount: 1 });

    const sharing = await call("GET", `/api/classrooms/${s.roomId}/sharing`, { cookie: s.owner.cookie });
    expect(sharing.body.myRole).toBe("owner");
    expect(sharing.body.owner.isMe).toBe(true);
    expect(sharing.body.members).toHaveLength(1);
    expect(sharing.body.members[0]).toMatchObject({ teacherId: member.id, role: "editor", isMe: false });
    expect(sharing.body.invites).toEqual([]);

    const actions = (await db.select().from(schema.auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["classroom_invite_created", "classroom_invite_accepted"]));
  });

  it("asks for an account: a workspace without email cannot accept, and nothing is used up", async () => {
    const s = await sharedRoom();
    const { token } = await invite(s.owner, s.roomId, "reader");
    const anon = await newTeacher();
    const view = await call("GET", `/api/invites/${token}`, { cookie: anon.cookie });
    expect(view.body.viewer).toEqual({ signedIn: true, hasAccount: false, currentRole: null });
    const r = await call("POST", `/api/invites/${token}/accept`, { cookie: anon.cookie });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("account_required");
    expect(r.body.error.message).toMatch(/cuenta/);
    const none = await call("POST", `/api/invites/${token}/accept`);
    expect(none.status).toBe(401);
    // Still valid for when they create the account.
    expect((await call("GET", `/api/invites/${token}`)).body.status).toBe("valid");
    expect(await db.select().from(schema.classroomMembers)).toHaveLength(0);
  });

  it("a link works once; expired, revoked and unknown links say so; the owner cannot accept their own", async () => {
    const s = await sharedRoom();
    const first = await invite(s.owner, s.roomId, "reader");
    const a = await newAccount();
    expect((await call("POST", `/api/invites/${first.token}/accept`, { cookie: a.cookie })).status).toBe(200);
    const b = await newAccount();
    const used = await call("POST", `/api/invites/${first.token}/accept`, { cookie: b.cookie });
    expect(used.status).toBe(410);
    expect(used.body.error.code).toBe("invite_used");
    expect(used.body.error.message).toMatch(/una sola vez/);
    expect((await call("GET", `/api/invites/${first.token}`)).body.status).toBe("used");

    const expiring = await invite(s.owner, s.roomId, "reader");
    await db.update(schema.classroomInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.classroomInvites.id, expiring.invite.id));
    const expired = await call("POST", `/api/invites/${expiring.token}/accept`, { cookie: b.cookie });
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe("invite_expired");
    expect(expired.body.error.message).toMatch(/venció/);

    const revoking = await invite(s.owner, s.roomId, "admin");
    const pending = await call("GET", `/api/classrooms/${s.roomId}/sharing`, { cookie: s.owner.cookie });
    expect(pending.body.invites.map((i: { id: string }) => i.id)).toEqual([revoking.invite.id]);
    expect((await call("DELETE", `/api/classrooms/${s.roomId}/invites/${revoking.invite.id}`, { cookie: s.owner.cookie })).status).toBe(200);
    const revoked = await call("POST", `/api/invites/${revoking.token}/accept`, { cookie: b.cookie });
    expect(revoked.status).toBe(410);
    expect(revoked.body.error.code).toBe("invite_revoked");
    expect((await call("GET", `/api/classrooms/${s.roomId}/sharing`, { cookie: s.owner.cookie })).body.invites).toEqual([]);

    const unknown = await call("GET", `/api/invites/${"x".repeat(43)}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.message).toMatch(/no existe/);

    const own = await invite(s.owner, s.roomId, "editor");
    const self = await call("POST", `/api/invites/${own.token}/accept`, { cookie: s.owner.cookie });
    expect(self.status).toBe(409);
    expect(self.body.error.message).toMatch(/es tuya/);
    expect((await call("GET", `/api/invites/${own.token}`, { cookie: s.owner.cookie })).body.viewer.currentRole).toBe("owner");
    expect(await db.select().from(schema.classroomMembers)).toHaveLength(1);
  });

  it("a member who accepts another link changes to its role", async () => {
    const s = await sharedRoom();
    const member = await join(s.owner, s.roomId, "reader");
    const { token } = await invite(s.owner, s.roomId, "admin");
    expect((await call("GET", `/api/invites/${token}`, { cookie: member.cookie })).body.viewer.currentRole).toBe("reader");
    expect((await call("POST", `/api/invites/${token}/accept`, { cookie: member.cookie })).status).toBe(200);
    const rows = await db.select().from(schema.classroomMembers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teacherId: member.id, role: "admin" });
  });
});

describe("Compartir aula: permisos por rol", () => {
  it("a teacher without relation to the classroom gets 404 on every read and change", async () => {
    const s = await sharedRoom();
    const stranger = await newAccount();
    const ex = await extras(s, stranger);
    for (const path of [...reads(s), `/api/live/${s.activity.id}/stream`]) {
      const r = await call("GET", path, { cookie: stranger.cookie });
      expect(r.status, `GET ${path}`).toBe(404);
    }
    for (const [method, path, opts] of mutations(s, ex)) {
      const r = await call(method, path, { cookie: stranger.cookie, ...opts });
      if (path === "/api/alerts/bulk") expect(r.body.updated, path).toBe(0);
      else expect(r.status, `${method} ${path}`).toBe(404);
    }
    expect((await call("GET", "/api/classrooms", { cookie: stranger.cookie })).body.classrooms).toEqual([]);
    expect((await call("GET", "/api/alerts", { cookie: stranger.cookie })).body.items).toEqual([]);
    const [alert] = await db.select().from(schema.studentAlerts);
    expect(alert!.status).toBe("open");
  });

  it("a reader sees everything (200) and every change answers 403 with a clear message", async () => {
    const s = await sharedRoom();
    const reader = await join(s.owner, s.roomId, "reader");
    const ex = await extras(s, reader);
    for (const path of reads(s)) {
      const r = await call("GET", path, { cookie: reader.cookie });
      expect(r.status, `GET ${path}`).toBe(200);
    }
    expect((await call("GET", `/api/classrooms/${s.roomId}`, { cookie: reader.cookie })).body.classroom.role).toBe("reader");
    expect((await call("GET", `/api/activities/${s.activity.id}`, { cookie: reader.cookie })).body.activity.role).toBe("reader");
    expect((await call("GET", `/api/live/${s.activity.id}`, { cookie: reader.cookie })).body.role).toBe("reader");
    expect((await call("GET", `/api/sessions/${s.session.id}`, { cookie: reader.cookie })).body.role).toBe("reader");
    expect((await call("GET", `/api/students/${s.student.id}`, { cookie: reader.cookie })).body.role).toBe("reader");
    // Pending links are only for who manages access.
    expect((await call("GET", `/api/classrooms/${s.roomId}/sharing`, { cookie: reader.cookie })).body.invites).toEqual([]);

    for (const [method, path, opts] of mutations(s, ex)) {
      const r = await call(method, path, { cookie: reader.cookie, ...opts });
      expect(r.status, `${method} ${path} → ${JSON.stringify(r.body)}`).toBe(403);
      expect(r.body.error.code).toBe("forbidden");
    }
    const denied = await call("POST", `/api/activities/${s.activity.id}/publish`, { cookie: reader.cookie });
    expect(denied.body.error.message).toMatch(/lectura/);

    // Nothing changed.
    const room = await call("GET", `/api/classrooms/${s.roomId}`, { cookie: s.owner.cookie });
    expect(room.body.classroom.name).toBe("Social Studies- 1° ES");
    const [alert] = await db.select().from(schema.studentAlerts);
    expect(alert!.status).toBe("open");
    expect(await db.select().from(schema.activities)).toHaveLength(1);
    expect(aiMock.lastRequest()).toBeUndefined();

    // Lists across classrooms include it (alerts can be seen, not marked).
    const inbox = await call("GET", "/api/alerts", { cookie: reader.cookie });
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0]).toMatchObject({ id: s.alert.id, canEdit: false });
    expect((await call("GET", "/api/alerts/count", { cookie: reader.cookie })).body.open).toBe(1);
    const home = await call("GET", "/api/dashboard", { cookie: reader.cookie });
    expect(home.body.counts).toMatchObject({ classrooms: 1, openAlerts: 1 });
    expect(home.body.alerts).toHaveLength(1);
    const xray = await call("GET", "/api/sessions", { cookie: reader.cookie });
    expect(xray.body.items).toHaveLength(1);
    // Reports stay in each teacher's own classrooms.
    const report = await call("POST", "/api/reports", { cookie: reader.cookie, body: { kind: "group", classroomId: s.roomId } });
    expect(report.status).toBe(403);
    expect(report.body.error.message).toMatch(/compartida/);
  });

  it("an editor works on activities and students' work, but does not manage the classroom or its sharing", async () => {
    const s = await sharedRoom();
    const editor = await join(s.owner, s.roomId, "editor");
    const ex = await extras(s, editor);
    const forbiddenForEditor = new Set([
      `PATCH /api/classrooms/${s.roomId}`,
      `DELETE /api/classrooms/${s.roomId}`,
      `POST /api/classrooms/${s.roomId}/students`,
      `PATCH /api/classrooms/${s.roomId}/students/${s.student.id}`,
      `DELETE /api/classrooms/${s.roomId}/students/${s.student.id}`,
      `PUT /api/classrooms/${s.roomId}/alerts/builtin/low_engagement`,
      `POST /api/classrooms/${s.roomId}/alerts`,
      `PATCH /api/classrooms/${s.roomId}/alerts/${s.alertConfigId}`,
      `DELETE /api/classrooms/${s.roomId}/alerts/${s.alertConfigId}`,
      `POST /api/classrooms/${s.roomId}/invites`,
      `DELETE /api/classrooms/${s.roomId}/invites/${ex.inviteId}`,
      `PATCH /api/classrooms/${s.roomId}/members/${ex.otherMemberId}`,
      `DELETE /api/classrooms/${s.roomId}/members/${ex.otherMemberId}`,
      `POST /api/activities/${s.activity.id}/trash`,
      `POST /api/activities/${s.activity.id}/untrash`,
      `POST /api/activities/${s.activity.id}/reset`,
      `DELETE /api/activities/${s.activity.id}`,
      `DELETE /api/sessions/${s.session.id}`,
    ]);
    for (const [method, path, opts] of mutations(s, ex)) {
      if (!forbiddenForEditor.has(`${method} ${path}`)) continue;
      const r = await call(method, path, { cookie: editor.cookie, ...opts });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    const msg = await call("PATCH", `/api/classrooms/${s.roomId}`, { cookie: editor.cookie, body: { name: "x" } });
    expect(msg.body.error.message).toMatch(/admin/);

    // Allowed: create an activity (it lands in the owner's workspace), edit, publish, act on the work.
    const created = await call("POST", "/api/activities", { cookie: editor.cookie, body: { classroomId: s.roomId, title: "Las colonias", tutorId: ex.tutorId } });
    expect(created.status).toBe(201);
    expect(created.body.activity.role).toBe("editor");
    const [row] = await db.select().from(schema.activities).where(eq(schema.activities.id, created.body.activity.id));
    expect(row!.teacherId).toBe(s.owner.id);
    // The editor's own tutor is copied as a template, without linking a tutor of another workspace.
    expect(row!.tutorId).toBeNull();
    const ownerSees = await call("GET", `/api/classrooms/${s.roomId}/activities`, { cookie: s.owner.cookie });
    expect(ownerSees.body.activities.map((a: { id: string }) => a.id)).toContain(created.body.activity.id);
    expect((await call("GET", `/api/activities/${created.body.activity.id}`, { cookie: s.owner.cookie })).body.activity.role).toBe("owner");

    const edited = await call("PATCH", `/api/activities/${created.body.activity.id}`, { cookie: editor.cookie, body: { title: "Las colonias del Río de la Plata", instructions: "Contá cómo era la vida." } });
    expect(edited.status).toBe(200);
    expect((await call("POST", `/api/activities/${created.body.activity.id}/publish`, { cookie: editor.cookie })).status).toBe(200);
    expect((await call("POST", `/api/activities/${created.body.activity.id}/duplicate`, { cookie: editor.cookie, body: {} })).status).toBe(201);
    expect((await call("POST", `/api/activities/${created.body.activity.id}/archive`, { cookie: editor.cookie })).status).toBe(200);
    expect((await call("PATCH", `/api/live/${s.activity.id}/alerts/${s.alert.id}`, { cookie: editor.cookie, body: { status: "reviewed" } })).status).toBe(200);
    expect((await call("PATCH", `/api/alerts/${s.alert.id}`, { cookie: editor.cookie, body: { status: "dismissed" } })).status).toBe(200);
    expect((await call("PUT", `/api/sessions/${s.session.id}/rubric`, { cookie: editor.cookie, body: { levels: { arg: 2 }, confirm: true } })).status).toBe(200);
    const inbox = await call("GET", "/api/alerts?status=all", { cookie: editor.cookie });
    expect(inbox.body.items[0].canEdit).toBe(true);

    // AI on a shared classroom is counted in the owner's workspace.
    aiMock.json({ questions: ["¿Qué te sorprendió de la vida en las colonias?"] });
    const ai = await call("POST", `/api/activities/${created.body.activity.id}/ai/reflection`, { cookie: editor.cookie, body: { count: 1 } });
    expect(ai.status).toBe(200);
    const usage = await db.select().from(schema.aiUsage);
    expect(usage.map((u) => u.teacherId)).toEqual([s.owner.id]);
  });

  it("an admin does everything but deleting the classroom or removing its owner", async () => {
    const s = await sharedRoom();
    const admin = await join(s.owner, s.roomId, "admin");
    const other = await join(s.owner, s.roomId, "reader");
    const room = `/api/classrooms/${s.roomId}`;
    expect((await call("PATCH", room, { cookie: admin.cookie, body: { name: "Social Studies 1° ES" } })).status).toBe(200);
    expect((await call("POST", `${room}/students`, { cookie: admin.cookie, body: { names: ["Bruno Díaz"] } })).status).toBe(200);
    expect((await call("PUT", `${room}/alerts/builtin/low_engagement`, { cookie: admin.cookie, body: { enabled: false } })).status).toBe(200);
    const link = await call("POST", `${room}/invites`, { cookie: admin.cookie, body: { role: "editor" } });
    expect(link.status).toBe(201);
    const sharing = await call("GET", `${room}/sharing`, { cookie: admin.cookie });
    expect(sharing.body.invites).toHaveLength(1);
    expect((await call("PATCH", `${room}/members/${other.id}`, { cookie: admin.cookie, body: { role: "editor" } })).status).toBe(200);
    expect((await call("POST", `/api/activities/${s.activity.id}/trash`, { cookie: admin.cookie })).status).toBe(200);
    expect((await call("POST", `/api/activities/${s.activity.id}/untrash`, { cookie: admin.cookie })).status).toBe(200);
    expect((await call("DELETE", `${room}/members/${other.id}`, { cookie: admin.cookie })).status).toBe(200);
    expect((await call("GET", room, { cookie: other.cookie })).status).toBe(404);

    const del = await call("DELETE", room, { cookie: admin.cookie });
    expect(del.status).toBe(403);
    expect(del.body.error.message).toMatch(/Solo quien creó el aula puede eliminarla/);
    const removeOwner = await call("DELETE", `${room}/members/${s.owner.id}`, { cookie: admin.cookie });
    expect(removeOwner.status).toBe(400);
    expect((await call("PATCH", `${room}/members/${s.owner.id}`, { cookie: admin.cookie, body: { role: "reader" } })).status).toBe(404);
    expect((await call("GET", room, { cookie: s.owner.cookie })).body.classroom.role).toBe("owner");

    const actions = (await db.select().from(schema.auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["classroom_member_role_changed", "classroom_member_removed"]));
    // The owner still can.
    expect((await call("DELETE", room, { cookie: s.owner.cookie })).status).toBe(200);
    expect(await db.select().from(schema.classroomMembers)).toHaveLength(0);
  });

  it("a member can leave ('Dejar de ver esta aula'); the owner cannot", async () => {
    const s = await sharedRoom();
    const reader = await join(s.owner, s.roomId, "reader");
    const left = await call("DELETE", `/api/classrooms/${s.roomId}/members/${reader.id}`, { cookie: reader.cookie });
    expect(left.status).toBe(200);
    expect((await call("GET", `/api/classrooms/${s.roomId}`, { cookie: reader.cookie })).status).toBe(404);
    const owner = await call("DELETE", `/api/classrooms/${s.roomId}/members/${s.owner.id}`, { cookie: s.owner.cookie });
    expect(owner.status).toBe(400);
    expect(owner.body.error.message).toMatch(/archivala/);
    expect((await db.select().from(schema.auditLogs)).map((a) => a.action)).toContain("classroom_left");
  });

  it("duplicating to another workspace's classroom leaves the copy in that classroom owner's workspace", async () => {
    const s = await sharedRoom();
    const editor = await join(s.owner, s.roomId, "editor");
    const mine = await newClassroom(editor.cookie, "Mi aula");
    const copy = await call("POST", `/api/activities/${s.activity.id}/duplicate`, { cookie: editor.cookie, body: { classroomId: mine } });
    expect(copy.status).toBe(201);
    const [row] = await db.select().from(schema.activities).where(eq(schema.activities.id, copy.body.activity.id));
    expect(row).toMatchObject({ teacherId: editor.id, classroomId: mine });
    // And the other way: an editor's activity copied into the shared classroom belongs to its owner.
    const own = await insertActivity(editor.id, mine);
    const back = await call("POST", `/api/activities/${own.id}/duplicate`, { cookie: editor.cookie, body: { classroomId: s.roomId } });
    expect(back.status).toBe(201);
    const [backRow] = await db.select().from(schema.activities).where(eq(schema.activities.id, back.body.activity.id));
    expect(backRow!.teacherId).toBe(s.owner.id);
    // A reader cannot copy into the classroom.
    const reader = await join(s.owner, s.roomId, "reader");
    const readerRoom = await newClassroom(reader.cookie, "Aula del lector");
    const readerOwn = await insertActivity(reader.id, readerRoom);
    expect((await call("POST", `/api/activities/${readerOwn.id}/duplicate`, { cookie: reader.cookie, body: { classroomId: s.roomId } })).status).toBe(403);
  });

  it("the live stream opens for members", async () => {
    const s = await sharedRoom();
    const reader = await join(s.owner, s.roomId, "reader");
    const controller = new AbortController();
    const { app } = await import("./helpers");
    const res = await app.request(`/api/live/${s.activity.id}/stream`, { headers: { cookie: reader.cookie }, signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    controller.abort();
  });
});

describe("Compartir aula: espacios", () => {
  it("deleting a member's workspace removes only the membership; the owner's classroom stays", async () => {
    const s = await sharedRoom();
    const editor = await join(s.owner, s.roomId, "editor");
    const created = await call("POST", "/api/activities", { cookie: editor.cookie, body: { classroomId: s.roomId, title: "Hecha por el editor" } });
    expect(created.status).toBe(201);
    const gone = await call("DELETE", "/api/auth/workspace", { cookie: editor.cookie, body: { confirm: "BORRAR" } });
    expect(gone.status).toBe(200);
    expect(await db.select().from(schema.classroomMembers)).toHaveLength(0);
    const acts = await call("GET", `/api/classrooms/${s.roomId}/activities`, { cookie: s.owner.cookie });
    expect(acts.body.activities).toHaveLength(2);
    expect((await call("GET", `/api/sessions/${s.session.id}`, { cookie: s.owner.cookie })).status).toBe(200);
  });

  it("signing in on a device with a workspace merges it: shared classrooms follow the account", async () => {
    const s = await sharedRoom();
    const member = await newTeacher();
    const email = `fusion-${Date.now()}@escuela.edu.ar`;
    await call("POST", "/api/auth/register", { cookie: member.cookie, body: { email, password: "una-clave-larga-de-prueba" } });
    await call("POST", `/api/invites/${(await invite(s.owner, s.roomId, "editor")).token}/accept`, { cookie: member.cookie });
    // Another device: an anonymous workspace that owns a classroom shared with the account.
    const device = await newTeacher();
    const deviceRoom = await newClassroom(device.cookie, "Aula del dispositivo");
    await db.insert(schema.classroomMembers).values({ classroomId: deviceRoom, teacherId: member.id, role: "reader" });
    await db.insert(schema.activities).values({ classroomId: deviceRoom, teacherId: device.id, title: "Del dispositivo", linkToken: `tok-${Date.now()}` });
    const login = await call("POST", "/api/auth/login", { cookie: device.cookie, body: { email, password: "una-clave-larga-de-prueba" } });
    expect(login.status).toBe(200);
    expect(login.body.merged).toBe(true);
    const rows = await db.select().from(schema.classroomMembers);
    // The account owns the device's classroom now (no membership there) and keeps the shared one.
    expect(rows).toEqual([expect.objectContaining({ classroomId: s.roomId, teacherId: member.id, role: "editor" })]);
    const list = await call("GET", "/api/classrooms", { cookie: member.cookie });
    const roles = Object.fromEntries(list.body.classrooms.map((c: { id: string; role: string }) => [c.id, c.role]));
    expect(roles).toEqual({ [s.roomId]: "editor", [deviceRoom]: "owner" });
  });
});
