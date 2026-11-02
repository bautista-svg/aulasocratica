import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type {
  ClassroomCourse,
  ClassroomGradesBody,
  ClassroomGradesResponse,
  ClassroomGradesResult,
  ClassroomImportResult,
  ClassroomLink,
  ClassroomPublishBody,
  ClassroomRosterStudent,
  ClassroomStatus,
} from "@shared/contracts/classroom";

export const classroomKeys = {
  status: ["classroom", "status"] as const,
  courses: ["classroom", "courses"] as const,
  link: (activityId: string) => ["classroom", "link", activityId] as const,
  grades: (activityId: string) => ["classroom", "grades", activityId] as const,
};

/** Where Google sends the teacher back after connecting (the same screen, with ?classroom=…). */
export function connectUrl(next: string) {
  return `/api/classroom/connect?next=${encodeURIComponent(next)}`;
}

export function useClassroomStatus() {
  return useQuery({
    queryKey: classroomKeys.status,
    queryFn: ({ signal }) => api.get<ClassroomStatus>("/api/classroom/status", signal),
    staleTime: 60_000,
  });
}

export function useClassroomCourses(enabled: boolean) {
  return useQuery({
    queryKey: classroomKeys.courses,
    queryFn: ({ signal }) => api.get<{ courses: ClassroomCourse[] }>("/api/classroom/courses", signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useClassroomRoster(courseId: string | null) {
  return useQuery({
    queryKey: ["classroom", "roster", courseId],
    queryFn: ({ signal }) => api.get<{ students: ClassroomRosterStudent[] }>(`/api/classroom/courses/${encodeURIComponent(courseId!)}/students`, signal),
    enabled: Boolean(courseId),
    retry: false,
  });
}

export function useClassroomLink(activityId: string, enabled: boolean) {
  return useQuery({
    queryKey: classroomKeys.link(activityId),
    queryFn: ({ signal }) => api.get<{ link: ClassroomLink | null }>(`/api/classroom/activities/${activityId}`, signal),
    enabled,
  });
}

export function usePublishToClassroom(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ClassroomPublishBody) => api.post<{ link: ClassroomLink }>(`/api/classroom/activities/${activityId}/publish`, body),
    onSuccess: (r) => qc.setQueryData(classroomKeys.link(activityId), { link: r.link }),
  });
}

export function useUnlinkClassroom(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<{ ok: true }>(`/api/classroom/activities/${activityId}`),
    onSuccess: () => qc.setQueryData(classroomKeys.link(activityId), { link: null }),
  });
}

export function useClassroomGrades(activityId: string, enabled: boolean) {
  return useQuery({
    queryKey: classroomKeys.grades(activityId),
    queryFn: ({ signal }) => api.get<ClassroomGradesResponse>(`/api/classroom/activities/${activityId}/grades`, signal),
    enabled,
    retry: false,
  });
}

export function useSendGrades(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ClassroomGradesBody) => api.post<ClassroomGradesResult>(`/api/classroom/activities/${activityId}/grades`, body),
    onSettled: () => void qc.invalidateQueries({ queryKey: classroomKeys.grades(activityId) }),
  });
}

export function useDisconnectClassroom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/api/classroom/disconnect"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["classroom"] }),
  });
}

export function useImportRoster(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (courseId: string) => api.post<ClassroomImportResult>(`/api/classroom/classrooms/${classroomId}/import`, { courseId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["classrooms"] }),
  });
}
