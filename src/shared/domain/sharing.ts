// "Compartir aula": who can do what in a classroom shared with other teachers. The owner (the
// workspace that created it) can do everything; members get one of three roles. The server checks
// every mutation with `can`; the client uses the same rules to hide or disable what is not allowed.

export const MEMBER_ROLES = ["admin", "editor", "reader"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type ClassroomRole = "owner" | MemberRole;

/**
 * - edit: activities (create, edit, publish, duplicate, archive, trash) and the students' work
 *   (alerts, evaluation, ending works).
 * - manage: the classroom itself (its data, alert settings, students) and who it is shared with.
 * - own: deleting the whole classroom.
 */
export type ClassroomAction = "edit" | "manage" | "own";

const LEVEL: Record<ClassroomRole, number> = { reader: 0, editor: 1, admin: 2, owner: 3 };
const NEEDS: Record<ClassroomAction, number> = { edit: 1, manage: 2, own: 3 };

export function can(role: ClassroomRole, action: ClassroomAction): boolean {
  return LEVEL[role] >= NEEDS[action];
}

export const isMemberRole = (v: unknown): v is MemberRole => typeof v === "string" && (MEMBER_ROLES as readonly string[]).includes(v);

/** The owner is "Titular": neutral, and what schools call the teacher in charge of a course. */
export const ROLE_LABEL: Record<ClassroomRole, string> = { owner: "Titular", admin: "Admin", editor: "Editor", reader: "Lector" };

export const ROLE_INFO: Record<MemberRole, string> = {
  admin: "Hace todo lo que hace quien creó el aula, menos eliminarla.",
  editor: "Crea y edita actividades y trabaja con los alumnos. No cambia el aula ni a quién se comparte.",
  reader: "Solo mira: actividades, En vivo, alertas y el trabajo de los alumnos.",
};

/** Why the server refused (403): one message per role, in plain words and with what to do. */
export function deniedMessage(role: ClassroomRole, action: ClassroomAction): string {
  if (role === "reader") return "Tenés acceso de lectura a esta aula: podés ver todo, pero no hacer cambios. Si necesitás editar, pedile a quien la comparte que te cambie el rol.";
  if (action === "own") return "Solo quien creó el aula puede eliminarla.";
  return "Solo quien creó el aula o un admin pueden cambiar esto.";
}

/** An invitation link works once and expires after these days. */
export const INVITE_DAYS = 7;
/** Members per classroom (plus the owner), and pending links at the same time. */
export const MAX_MEMBERS = 30;
export const MAX_PENDING_INVITES = 20;
