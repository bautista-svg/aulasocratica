// "Compartir aula": request bodies and responses of /api/classrooms/:id/sharing|invites|members
// and /api/invites/:token.
import { z } from "zod";
import { MEMBER_ROLES, type ClassroomRole, type MemberRole } from "../domain/sharing";

const role = z.enum(MEMBER_ROLES, { message: "Elegí un rol: Admin, Editor o Lector." });

export const inviteCreateBody = z.object({ role });
export const memberRoleBody = z.object({ role });

export interface SharingPerson {
  teacherId: string;
  /** Display name, or the email when the teacher has none. */
  name: string;
  email: string | null;
  isMe: boolean;
}

export interface ClassroomMemberView extends SharingPerson {
  role: MemberRole;
  since: string;
}

/** An invitation link not used yet (its token is shown only once, when it is created). */
export interface PendingInvite {
  id: string;
  role: MemberRole;
  createdAt: string;
  expiresAt: string;
  createdByName: string;
}

export interface ClassroomSharing {
  myRole: ClassroomRole;
  owner: SharingPerson;
  members: ClassroomMemberView[];
  /** Only for who can manage the classroom (owner and admins); empty otherwise. */
  invites: PendingInvite[];
}

export interface InviteCreated {
  invite: PendingInvite;
  /** Goes in the link (/invitacion/<token>); the server keeps only its hash. */
  token: string;
}

export type InviteStatus = "valid" | "expired" | "used" | "revoked";

export interface InvitePreview {
  status: InviteStatus;
  role: MemberRole;
  classroom: { id: string; label: string; school: string };
  ownerName: string;
  invitedByName: string;
  expiresAt: string;
  viewer: {
    /** There is a workspace on this device. */
    signedIn: boolean;
    /** That workspace has an account (email + password or Google): needed to accept. */
    hasAccount: boolean;
    /** Role the viewer already has in this classroom ("owner" if it is theirs), or null. */
    currentRole: ClassroomRole | null;
  };
}

export interface InviteAccepted {
  classroomId: string;
  role: MemberRole;
}
