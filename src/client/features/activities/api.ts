import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type {
  ActivityEditorData,
  ActivityFile,
  ActivityPatch,
  ActivityResponse,
  ActivityWithFilesResponse,
  AiReflectionInput,
  AiRubricInput,
  DuplicateResponse,
  FileTextResponse,
  LinkPatch,
  ReflectionProposalResponse,
  ResetResponse,
  RubricImportResponse,
  RubricProposalResponse,
} from "@shared/contracts/activities";

export const activityKeys = {
  one: (id: string) => ["activities", id] as const,
  files: (id: string) => ["activities", id, "files"] as const,
  text: (id: string, fileId: string) => ["activities", id, "files", fileId, "text"] as const,
};

const isBusy = (f: ActivityFile) => f.processingStatus === "pending" || f.processingStatus === "processing";

export function useActivity(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: activityKeys.one(id),
    queryFn: async ({ signal }) => {
      const r = await api.get<ActivityWithFilesResponse>(`/api/activities/${id}`, signal);
      qc.setQueryData(activityKeys.files(id), { files: r.files });
      return r;
    },
    select: (d) => d.activity,
    // Keeps the participant counts in the header fresh; unsaved edits are never touched by a refetch.
    refetchInterval: 30_000,
  });
}

/** Files of an activity; polls while any of them is still being read. */
export function useActivityFiles(id: string) {
  return useQuery({
    queryKey: activityKeys.files(id),
    queryFn: ({ signal }) => api.get<{ files: ActivityFile[] }>(`/api/activities/${id}/files`, signal),
    select: (d) => d.files,
    refetchInterval: (q) => (q.state.data?.files.some(isBusy) ? 2500 : false),
  });
}

/** Puts a fresh activity in the cache and refreshes the lists that show it. */
export function storeActivity(qc: QueryClient, activity: ActivityEditorData) {
  qc.setQueryData<ActivityWithFilesResponse>(activityKeys.one(activity.id), (old) =>
    old ? { ...old, activity } : { activity, files: qc.getQueryData<{ files: ActivityFile[] }>(activityKeys.files(activity.id))?.files ?? [] },
  );
  void qc.invalidateQueries({ queryKey: ["classrooms", activity.classroomId, "activities"] });
  void qc.invalidateQueries({ queryKey: ["classrooms", activity.classroomId], exact: true });
  void qc.invalidateQueries({ queryKey: ["dashboard"] });
}

export function useSaveActivity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ActivityPatch) => api.patch<ActivityResponse>(`/api/activities/${id}`, patch as Record<string, unknown>),
    onSuccess: (r) => storeActivity(qc, r.activity),
  });
}

export type LifecycleAction = "publish" | "unpublish" | "archive" | "restore" | "untrash" | "link/regenerate";

export function useActivityAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: LifecycleAction) => api.post<ActivityResponse>(`/api/activities/${id}/${action}`),
    onSuccess: (r) => storeActivity(qc, r.activity),
  });
}

export function useApplyTutor(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tutorId: string) => api.post<ActivityResponse>(`/api/activities/${id}/tutor`, { tutorId }),
    onSuccess: (r) => {
      storeActivity(qc, r.activity);
      void qc.invalidateQueries({ queryKey: ["tutors"] });
    },
  });
}

export function useUpdateLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: LinkPatch) => api.patch<ActivityResponse>(`/api/activities/${id}/link`, patch as Record<string, unknown>),
    onSuccess: (r) => storeActivity(qc, r.activity),
  });
}

export function useDuplicateActivity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { classroomId: string; requestId: string }) => api.post<DuplicateResponse>(`/api/activities/${id}/duplicate`, body),
    onSuccess: (r) => storeActivity(qc, r.activity),
  });
}

/** Drops every cached query of a deleted activity (call after navigating away from it). */
export function forgetActivity(qc: QueryClient, id: string) {
  qc.removeQueries({ queryKey: activityKeys.one(id) });
  qc.removeQueries({ queryKey: ["live", id] });
}

export function useResetActivity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { regenerateLink: boolean }) => api.post<ResetResponse>(`/api/activities/${id}/reset`, { confirm: "REINICIAR", ...opts }),
    onSuccess: (r) => {
      storeActivity(qc, r.activity);
      // Everything that showed students' work in this activity is stale now.
      void qc.invalidateQueries({ queryKey: ["live"] });
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      void qc.invalidateQueries({ queryKey: ["classrooms", r.activity.classroomId, "students"] });
    },
  });
}

export function useDeleteActivity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<{ ok: true; classroomId: string }>(`/api/activities/${id}`, { confirm: "BORRAR" }),
    onSuccess: (r) => {
      // Stop the editor's polling (activity, files, live); the queries are removed after leaving the page.
      void qc.cancelQueries({ queryKey: activityKeys.one(id) });
      void qc.cancelQueries({ queryKey: ["live", id] });
      void qc.invalidateQueries({ queryKey: ["classrooms", r.classroomId] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ── Files ──

function patchFiles(qc: QueryClient, id: string, fn: (files: ActivityFile[]) => ActivityFile[]) {
  qc.setQueryData<{ files: ActivityFile[] }>(activityKeys.files(id), (old) => ({ files: fn(old?.files ?? []) }));
}

export function addUploadedFiles(qc: QueryClient, id: string, files: ActivityFile[]) {
  patchFiles(qc, id, (list) => [...list.filter((f) => !files.some((n) => n.id === f.id)), ...files]);
}

export function useFileMutations(id: string) {
  const qc = useQueryClient();
  const replace = (file: ActivityFile) => patchFiles(qc, id, (list) => list.map((f) => (f.id === file.id ? file : f)));
  return {
    note: useMutation({
      mutationFn: ({ fileId, teacherNote }: { fileId: string; teacherNote: string }) =>
        api.patch<{ file: ActivityFile }>(`/api/activities/${id}/files/${fileId}`, { teacherNote }),
      onSuccess: (r) => replace(r.file),
    }),
    retry: useMutation({
      mutationFn: (fileId: string) => api.post<{ file: ActivityFile }>(`/api/activities/${id}/files/${fileId}/retry`),
      onSuccess: (r) => replace(r.file),
    }),
    remove: useMutation({
      mutationFn: (fileId: string) => api.del<{ ok: true }>(`/api/activities/${id}/files/${fileId}`),
      onSuccess: (_r, fileId) => patchFiles(qc, id, (list) => list.filter((f) => f.id !== fileId)),
    }),
  };
}

export function fetchFileText(id: string, fileId: string, offset: number, limit = 20_000) {
  return api.get<FileTextResponse>(`/api/activities/${id}/files/${fileId}/text?offset=${offset}&limit=${limit}`);
}

export const fileDownloadUrl = (id: string, fileId: string, inline = false) =>
  `/api/activities/${id}/files/${fileId}/download${inline ? "?inline=1" : ""}`;

// ── AI design helpers (return suggestions; nothing is saved) ──

export function useAiDesign(id: string) {
  return {
    rubric: useMutation({
      mutationFn: (input: AiRubricInput) => api.post<RubricProposalResponse>(`/api/activities/${id}/ai/rubric`, input as Record<string, unknown>),
    }),
    reflection: useMutation({
      mutationFn: (input: AiReflectionInput) =>
        api.post<ReflectionProposalResponse>(`/api/activities/${id}/ai/reflection`, input as Record<string, unknown>),
    }),
    importRubric: useMutation({
      mutationFn: (file: File) => {
        const form = new FormData();
        form.append("file", file);
        return api.post<RubricImportResponse>(`/api/activities/${id}/rubric/import`, form);
      },
    }),
  };
}
