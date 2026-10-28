// "Compartir aula": who has access to a classroom, one-time invitation links and members' roles.
// Mounted twice: `classroomSharingRoutes` under /api/classrooms (/:id/sharing, /:id/invites,
// /:id/members) and `inviteRoutes` under /api/invites (the page the link opens, and accepting it).
// Only the owner and admins manage access; the owner cannot be removed and is never a member row.
import { Hono } from "hono";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { badRequest, conflict, HttpError, notFound, readJson, tooMany } from "../lib/errors";
import { hit, rateLimit } from "../lib/rate-limit";
import { randomToken, sha256 } from "../lib/crypto";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { isUuid, ownedClassroom, requireRole } from "../services/access";
import { audit } from "../services/audit";
import { classroomLabel } from "@shared/contracts/classrooms";
import { inviteCreateBody, memberRoleBody } from "@shared/contracts/sharing";
import type { ClassroomSharing, InviteAccepted, InviteCreated, InvitePreview, InviteStatus, PendingInvite } from "@shared/contracts/sharing";
import { can, INVITE_DAYS, MAX_MEMBERS, MAX_PENDING_INVITES, type ClassroomRole, type MemberRole } from "@shared/domain/sharing";

const members = schema.classroomMembers;
const invites = schema.classroomInvites;
const teachers = schema.teachers;

/** What other teachers see of someone: their name, or their email when they have none. */
const personName = (t: { displayName: string; email: string | null } | null | undefined) =>
  t ? t.displayName.trim() || t.email || "Docente sin nombre" : "Docente";

const nameSql = sql<string>`coalesce(nullif(${teachers.displayName}, ''), ${teachers.email}, 'Docente sin nombre')`;

async function pendingInvites(classroomId: string): Promise<PendingInvite[]> {
  const rows = await db
    .select({ i: invites, by: nameSql })
    .from(invites)
    .leftJoin(teachers, eq(teachers.id, invites.createdBy))
    .where(and(eq(invites.classroomId, classroomId), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
    .orderBy(asc(invites.createdAt));
  return rows.map(({ i, by }) => inviteView(i, by));
}

function inviteView(i: typeof invites.$inferSelect, createdByName: string | null): PendingInvite {
  return {
    id: i.id,
    role: i.role as MemberRole,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
    createdByName: createdByName ?? "Docente",
  };
}

async function memberRow(classroomId: string, teacherId: string) {
  if (!isUuid(teacherId)) return null;
  const [row] = await db
    .select()
    .from(members)
    .where(and(eq(members.classroomId, classroomId), eq(members.teacherId, teacherId)))
    .limit(1);
  return row ?? null;
}

export const classroomSharingRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  // Everyone with access sees who else has it; pending links only who manages access.
  .get("/:id/sharing", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const [ownerRows, memberRows, pending] = await Promise.all([
      db.select().from(teachers).where(eq(teachers.id, room.teacherId)).limit(1),
      db
        .select({ m: members, t: { id: teachers.id, displayName: teachers.displayName, email: teachers.email } })
        .from(members)
        .innerJoin(teachers, eq(teachers.id, members.teacherId))
        .where(eq(members.classroomId, room.id))
        .orderBy(asc(members.createdAt)),
      can(room.role, "manage") ? pendingInvites(room.id) : Promise.resolve([]),
    ]);
    const owner = ownerRows[0];
    const body: ClassroomSharing = {
      myRole: room.role,
      owner: { teacherId: room.teacherId, name: personName(owner), email: owner?.email ?? null, isMe: room.teacherId === t.id },
      members: memberRows.map(({ m, t: who }) => ({
        teacherId: who.id,
        name: personName(who),
        email: who.email,
        isMe: who.id === t.id,
        role: m.role as MemberRole,
        since: m.createdAt.toISOString(),
      })),
      invites: pending,
    };
    return c.json(body);
  })

  // A new one-time link (valid INVITE_DAYS days) for one role.
  .post("/:id/invites", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    requireRole(room, "manage");
    const { role } = await readJson(c, inviteCreateBody);
    if (!hit(`invite-create:${t.id}`, 30, 60 * 60_000)) throw tooMany("Creaste muchos enlaces seguidos. Esperá un rato y probá de nuevo.");
    const pending = await pendingInvites(room.id);
    if (pending.length >= MAX_PENDING_INVITES) {
      throw badRequest(`Ya hay ${MAX_PENDING_INVITES} enlaces sin usar. Anulá alguno para crear otro.`);
    }
    const token = randomToken(32);
    const [row] = await db
      .insert(invites)
      .values({ classroomId: room.id, role, tokenHash: sha256(token), createdBy: t.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) })
      .returning();
    await audit(c, t.id, "classroom_invite_created", "classroom", room.id, { role, inviteId: row!.id });
    const body: InviteCreated = { invite: inviteView(row!, t.displayName.trim() || t.email || "Docente"), token };
    return c.json(body, 201);
  })

  .delete("/:id/invites/:inviteId", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    requireRole(room, "manage");
    const inviteId = c.req.param("inviteId");
    if (!isUuid(inviteId)) throw notFound("La invitación");
    const [row] = await db
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.id, inviteId), eq(invites.classroomId, room.id), isNull(invites.usedAt), isNull(invites.revokedAt)))
      .returning({ id: invites.id });
    if (!row) throw notFound("La invitación");
    await audit(c, t.id, "classroom_invite_revoked", "classroom", room.id, { inviteId });
    return c.json({ ok: true });
  })

  .patch("/:id/members/:teacherId", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    requireRole(room, "manage");
    const { role } = await readJson(c, memberRoleBody);
    const member = await memberRow(room.id, c.req.param("teacherId"));
    if (!member) throw notFound("Ese docente");
    if (member.role !== role) {
      await db.update(members).set({ role }).where(and(eq(members.classroomId, room.id), eq(members.teacherId, member.teacherId)));
      await audit(c, t.id, "classroom_member_role_changed", "classroom", room.id, { memberId: member.teacherId, from: member.role, to: role });
    }
    return c.json({ ok: true, role });
  })

  // Removing someone (owner or admin), or a member leaving ("Dejar de ver esta aula").
  .delete("/:id/members/:teacherId", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const targetId = c.req.param("teacherId");
    if (targetId === room.teacherId) {
      throw badRequest(
        room.role === "owner"
          ? "Creaste esta aula: no podés dejarla. Si ya no la usás, archivala."
          : "A quien creó el aula no se la puede quitar.",
      );
    }
    const leaving = targetId === t.id;
    if (!leaving) requireRole(room, "manage");
    const member = await memberRow(room.id, targetId);
    if (!member) throw notFound("Ese docente");
    await db.delete(members).where(and(eq(members.classroomId, room.id), eq(members.teacherId, member.teacherId)));
    await audit(c, t.id, leaving ? "classroom_left" : "classroom_member_removed", "classroom", room.id, { memberId: member.teacherId, role: member.role });
    return c.json({ ok: true });
  });

/** The invitation behind a link, with its classroom, owner and who created it. */
async function inviteByToken(token: string) {
  if (token.length < 20 || token.length > 100) throw notFound("La invitación");
  const [row] = await db
    .select({
      invite: invites,
      classroom: schema.classrooms,
      ownerName: sql<string>`(select coalesce(nullif(o.display_name, ''), o.email, 'Docente') from teachers o where o.id = ${schema.classrooms.teacherId})`,
      createdByName: sql<string | null>`(select coalesce(nullif(b.display_name, ''), b.email) from teachers b where b.id = ${invites.createdBy})`,
    })
    .from(invites)
    .innerJoin(schema.classrooms, eq(schema.classrooms.id, invites.classroomId))
    .where(eq(invites.tokenHash, sha256(token)))
    .limit(1);
  if (!row) throw new HttpError(404, "Este enlace de invitación no existe. Pedile a quien te lo mandó que cree uno nuevo.", "not_found");
  return row;
}

function statusOf(i: typeof invites.$inferSelect, now = Date.now()): InviteStatus {
  if (i.revokedAt) return "revoked";
  if (i.usedAt) return "used";
  if (i.expiresAt.getTime() <= now) return "expired";
  return "valid";
}

const NOT_VALID: Record<Exclude<InviteStatus, "valid">, string> = {
  expired: `Este enlace venció (dura ${INVITE_DAYS} días). Pedile a quien te invitó que cree uno nuevo.`,
  used: "Este enlace ya se usó: sirve una sola vez. Pedile a quien te invitó que cree uno nuevo.",
  revoked: "Este enlace fue anulado. Pedile a quien te invitó que cree uno nuevo.",
};

async function currentRole(classroom: typeof schema.classrooms.$inferSelect, teacherId: string | undefined): Promise<ClassroomRole | null> {
  if (!teacherId) return null;
  if (classroom.teacherId === teacherId) return "owner";
  const m = await memberRow(classroom.id, teacherId);
  return (m?.role as MemberRole | undefined) ?? null;
}

export const inviteRoutes = new Hono<AppEnv>()
  // The page the link opens: also without a workspace on this device (it asks to sign in).
  .get("/:token", rateLimit("invite-view", 60, 15 * 60_000), async (c) => {
    const row = await inviteByToken(c.req.param("token"));
    const t = c.get("teacher");
    const body: InvitePreview = {
      status: statusOf(row.invite),
      role: row.invite.role as MemberRole,
      classroom: { id: row.classroom.id, label: classroomLabel(row.classroom), school: row.classroom.school },
      ownerName: row.ownerName,
      invitedByName: row.createdByName ?? row.ownerName,
      expiresAt: row.invite.expiresAt.toISOString(),
      viewer: { signedIn: Boolean(t), hasAccount: Boolean(t?.hasAccount), currentRole: await currentRole(row.classroom, t?.id) },
    };
    return c.json(body);
  })

  .post("/:token/accept", requireTeacher, rateLimit("invite-accept", 20, 15 * 60_000), async (c) => {
    const t = teacherOf(c);
    if (!t.hasAccount) {
      throw new HttpError(
        403,
        "Para sumarte a un aula compartida necesitás una cuenta: creala o entrá con Google o con tu correo, y volvé a abrir el enlace.",
        "account_required",
      );
    }
    const row = await inviteByToken(c.req.param("token"));
    const status = statusOf(row.invite);
    if (status !== "valid") throw new HttpError(410, NOT_VALID[status], `invite_${status}`);
    if (row.classroom.teacherId === t.id) throw conflict("Esta aula es tuya: no hace falta aceptar la invitación. Compartí el enlace con quien quieras sumar.");
    const role = row.invite.role as MemberRole;
    const before = await currentRole(row.classroom, t.id);
    if (!before) {
      const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(members).where(eq(members.classroomId, row.classroom.id));
      if ((n?.n ?? 0) >= MAX_MEMBERS) throw conflict(`Esta aula ya está compartida con ${MAX_MEMBERS} docentes, el máximo. Pedile a quien te invitó que quite a alguien.`);
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      // One use only: the update wins once even if the link is opened twice at the same time.
      const [used] = await tx
        .update(invites)
        .set({ usedAt: now, usedBy: t.id })
        .where(and(eq(invites.id, row.invite.id), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now)))
        .returning({ id: invites.id });
      if (!used) throw new HttpError(410, NOT_VALID.used, "invite_used");
      // A member who accepts another link gets its role.
      await tx
        .insert(members)
        .values({ classroomId: row.classroom.id, teacherId: t.id, role, invitedBy: row.invite.createdBy })
        .onConflictDoUpdate({ target: [members.classroomId, members.teacherId], set: { role, invitedBy: row.invite.createdBy } });
    });
    await audit(c, t.id, "classroom_invite_accepted", "classroom", row.classroom.id, { role, previousRole: before, inviteId: row.invite.id });
    const body: InviteAccepted = { classroomId: row.classroom.id, role };
    return c.json(body);
  });
