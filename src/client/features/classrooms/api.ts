import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { ClassroomInput, ClassroomStudent, ClassroomSummary } from "@shared/contracts/classrooms";
import type { ActivitySummary } from "@shared/contracts/activities";
import type { AlertDefinition } from "@shared/domain/alerts";

export const classroomKeys = {
  all: ["classrooms"] as const,
  list: (archived: boolean) => ["classrooms", "list", archived] as const,
  one: (id: string) => ["classrooms", id] as const,
  activities: (id: string) => ["classrooms", id, "activities"] as const,
  students: (id: string) => ["classrooms", id, "students"] as const,
  alerts: (id: string) => ["classrooms", id, "alerts"] as const,
};

export function useClassrooms(archived = false) {
  return useQuery({
    queryKey: classroomKeys.list(archived),
    queryFn: ({ signal }) => api.get<{ classrooms: ClassroomSummary[] }>(`/api/classrooms${archived ? "?archived=1" : ""}`, signal),
    select: (d) => d.classrooms,
  });
}

export function useClassroom(id: string) {
  return useQuery({
    queryKey: classroomKeys.one(id),
    queryFn: ({ signal }) => api.get<{ classroom: ClassroomSummary }>(`/api/classrooms/${id}`, signal),
    select: (d) => d.classroom,
  });
}

export function useClassroomActivities(id: string) {
  return useQuery({
    queryKey: classroomKeys.activities(id),
    queryFn: ({ signal }) => api.get<{ activities: ActivitySummary[] }>(`/api/classrooms/${id}/activities`, signal),
    select: (d) => d.activities,
    refetchInterval: 30_000,
  });
}

export function useClassroomStudents(id: string) {
  return useQuery({
    queryKey: classroomKeys.students(id),
    queryFn: ({ signal }) => api.get<{ students: ClassroomStudent[] }>(`/api/classrooms/${id}/students`, signal),
    select: (d) => d.students,
  });
}

export function useSaveClassroom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: Partial<ClassroomInput> & { isArchived?: boolean; requestId?: string } }) =>
      id
        ? api.patch<{ classroom: ClassroomSummary }>(`/api/classrooms/${id}`, data)
        : api.post<{ classroom: ClassroomSummary }>("/api/classrooms", data),
    onSuccess: (r, vars) => {
      qc.setQueryData(classroomKeys.one(r.classroom.id), { classroom: r.classroom });
      void qc.invalidateQueries({ queryKey: ["classrooms", "list"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (vars.data.isArchived !== undefined) {
        // Archiving closes every link of the classroom: the activity states change too.
        void qc.invalidateQueries({ queryKey: classroomKeys.activities(r.classroom.id) });
        void qc.invalidateQueries({ queryKey: ["activities"] });
      }
    },
  });
}

export function useDeleteClassroom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/api/classrooms/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: classroomKeys.one(id) });
      void qc.invalidateQueries({ queryKey: classroomKeys.all });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useStudentMutations(classroomId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: classroomKeys.students(classroomId) });
    void qc.invalidateQueries({ queryKey: classroomKeys.one(classroomId) });
  };
  return {
    add: useMutation({
      mutationFn: (names: string[]) => api.post<{ added: number; skipped: number }>(`/api/classrooms/${classroomId}/students`, { names }),
      onSuccess: refresh,
    }),
    rename: useMutation({
      mutationFn: ({ id, ...changes }: { id: string; fullName?: string; division?: string }) =>
        api.patch<{ ok: true }>(`/api/classrooms/${classroomId}/students/${id}`, changes),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del<{ ok: true }>(`/api/classrooms/${classroomId}/students/${id}`),
      onSuccess: () => {
        refresh();
        void qc.invalidateQueries({ queryKey: classroomKeys.activities(classroomId) });
      },
    }),
  };
}

export interface ClassroomAlertsResponse {
  builtins: (AlertDefinition & { enabled: boolean })[];
  custom: { id: string; name: string; description: string; category: string; severity: string; enabled: boolean }[];
}

export function useClassroomAlerts(id: string) {
  return useQuery({
    queryKey: classroomKeys.alerts(id),
    queryFn: ({ signal }) => api.get<ClassroomAlertsResponse>(`/api/classrooms/${id}/alerts`, signal),
  });
}

export function useAlertMutations(classroomId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: classroomKeys.alerts(classroomId) });
  return {
    toggleBuiltin: useMutation({
      mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
        api.put<{ ok: true }>(`/api/classrooms/${classroomId}/alerts/builtin/${key}`, { enabled }),
      onSuccess: refresh,
    }),
    create: useMutation({
      mutationFn: (data: { name: string; description: string; category: string; severity: string }) =>
        api.post(`/api/classrooms/${classroomId}/alerts`, data),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; category?: string; severity?: string; enabled?: boolean }) =>
        api.patch(`/api/classrooms/${classroomId}/alerts/${id}`, data),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/api/classrooms/${classroomId}/alerts/${id}`),
      onSuccess: refresh,
    }),
  };
}
