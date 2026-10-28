// "Compartir aula": who has access, invitation links and members' roles.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import { classroomKeys } from "@client/features/classrooms/api";
import type { ClassroomSharing, InviteAccepted, InviteCreated, InvitePreview } from "@shared/contracts/sharing";
import type { MemberRole } from "@shared/domain/sharing";

export const sharingKey = (classroomId: string) => [...classroomKeys.one(classroomId), "sharing"] as const;

export function useSharing(classroomId: string, enabled = true) {
  return useQuery({
    queryKey: sharingKey(classroomId),
    queryFn: ({ signal }) => api.get<ClassroomSharing>(`/api/classrooms/${classroomId}/sharing`, signal),
    enabled,
  });
}

export function useSharingMutations(classroomId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: sharingKey(classroomId) });
    void qc.invalidateQueries({ queryKey: ["classrooms", "list"] });
  };
  const base = `/api/classrooms/${classroomId}`;
  return {
    createInvite: useMutation({
      mutationFn: (role: MemberRole) => api.post<InviteCreated>(`${base}/invites`, { role }),
      onSuccess: refresh,
    }),
    revokeInvite: useMutation({
      mutationFn: (inviteId: string) => api.del(`${base}/invites/${inviteId}`),
      onSuccess: refresh,
    }),
    changeRole: useMutation({
      mutationFn: ({ teacherId, role }: { teacherId: string; role: MemberRole }) => api.patch(`${base}/members/${teacherId}`, { role }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (teacherId: string) => api.del(`${base}/members/${teacherId}`),
      onSuccess: refresh,
    }),
  };
}

/** "Dejar de ver esta aula": the classroom leaves every list of this teacher. */
export function useLeaveClassroom(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (myId: string) => api.del(`/api/classrooms/${classroomId}/members/${myId}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: classroomKeys.one(classroomId) });
      void qc.invalidateQueries({ queryKey: classroomKeys.all });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}

export const inviteKey = (token: string) => ["invite", token] as const;

export function useInvite(token: string) {
  return useQuery({
    queryKey: inviteKey(token),
    queryFn: ({ signal }) => api.get<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`, signal),
    retry: false,
  });
}

export function useAcceptInvite(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<InviteAccepted>(`/api/invites/${encodeURIComponent(token)}/accept`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: classroomKeys.all });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: inviteKey(token) });
    },
  });
}
