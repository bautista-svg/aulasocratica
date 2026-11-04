import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { DefenseResponse, StudentCodeResponse, TeacherCodeBody } from "@shared/contracts/code-defense";

const key = (activityId: string) => ["code-defense", activityId] as const;

export function useCodeDefense(activityId: string) {
  return useQuery({
    queryKey: key(activityId),
    queryFn: ({ signal }) => api.get<DefenseResponse>(`/api/code-defense/${activityId}`, signal),
    refetchInterval: 15_000,
  });
}

export function useStudentCode(activityId: string, studentId: string | null) {
  return useQuery({
    queryKey: [...key(activityId), "code", studentId],
    queryFn: ({ signal }) => api.get<StudentCodeResponse>(`/api/code-defense/${activityId}/students/${studentId}/code`, signal),
    enabled: Boolean(studentId),
  });
}

export function useLoadStudentCode(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TeacherCodeBody) => api.put<{ ok: true; studentId: string }>(`/api/code-defense/${activityId}/code`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(activityId) }),
  });
}
