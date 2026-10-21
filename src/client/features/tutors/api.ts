import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { TutorDetail, TutorInput, TutorPatch, TutorSummary } from "@shared/contracts/tutors";

export const tutorKeys = {
  all: ["tutors"] as const,
  list: ["tutors", "list"] as const,
  one: (id: string) => ["tutors", id] as const,
};

/** All tutors of the workspace (built-in presets are seeded on first use, so this is never empty). */
export function useTutors() {
  return useQuery({
    queryKey: tutorKeys.list,
    queryFn: ({ signal }) => api.get<{ tutors: TutorSummary[] }>("/api/tutors", signal),
    select: (d) => d.tutors,
    staleTime: 60_000,
  });
}

/** Full configuration of one tutor (null id = disabled). */
export function useTutor(id: string | null | undefined) {
  return useQuery({
    queryKey: tutorKeys.one(id ?? "none"),
    queryFn: ({ signal }) => api.get<{ tutor: TutorDetail }>(`/api/tutors/${id}`, signal),
    select: (d) => d.tutor,
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useTutorMutations() {
  const qc = useQueryClient();
  const done = (r: { tutor: TutorDetail }) => {
    qc.setQueryData(tutorKeys.one(r.tutor.id), { tutor: r.tutor });
    void qc.invalidateQueries({ queryKey: tutorKeys.list });
  };
  return {
    create: useMutation({
      mutationFn: (data: TutorInput) => api.post<{ tutor: TutorDetail }>("/api/tutors", data),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: TutorPatch }) => api.patch<{ tutor: TutorDetail }>(`/api/tutors/${id}`, data),
      onSuccess: done,
    }),
    restore: useMutation({
      mutationFn: (id: string) => api.post<{ tutor: TutorDetail }>(`/api/tutors/${id}/restore`),
      onSuccess: done,
    }),
    duplicate: useMutation({
      mutationFn: (id: string) => api.post<{ tutor: TutorDetail }>(`/api/tutors/${id}/duplicate`),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del<{ ok: true }>(`/api/tutors/${id}`),
      onSuccess: (_r, id) => {
        qc.removeQueries({ queryKey: tutorKeys.one(id) });
        void qc.invalidateQueries({ queryKey: tutorKeys.list });
      },
    }),
  };
}
