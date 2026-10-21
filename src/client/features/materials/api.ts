import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, uploadWithProgress } from "@client/lib/api";
import type {
  AttachResponse,
  CreateMaterialInput,
  MaterialDetail,
  MaterialListResponse,
  MaterialSummary,
  MaterialTextPage,
  UpdateMaterialInput,
  UploadResponse,
} from "@shared/contracts/materials";
import type { ActivitySummary } from "@shared/contracts/activities";
import { PREVIEW_PAGE_CHARS } from "@shared/domain/library";
import { classroomKeys } from "@client/features/classrooms/api";

export interface MaterialFilters {
  q: string;
  /** null = every folder; "" = without folder. */
  folder: string | null;
  tag: string | null;
}

export const NO_FILTERS: MaterialFilters = { q: "", folder: null, tag: null };

export const materialKeys = {
  all: ["materials"] as const,
  list: (f: MaterialFilters) => ["materials", "list", f] as const,
  one: (id: string) => ["materials", id] as const,
  text: (id: string, offset: number) => ["materials", id, "text", offset] as const,
};

export const isBusy = (m: Pick<MaterialSummary, "processingStatus">) => m.processingStatus === "pending" || m.processingStatus === "processing";

function listUrl(f: MaterialFilters) {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.folder !== null) p.set("folder", f.folder);
  if (f.tag) p.set("tag", f.tag);
  const s = p.toString();
  return `/api/materials${s ? `?${s}` : ""}`;
}

/** The library (filtered). Polls while any file is still being read. */
export function useMaterials(filters: MaterialFilters = NO_FILTERS, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: materialKeys.list(filters),
    queryFn: ({ signal }) => api.get<MaterialListResponse>(listUrl(filters), signal),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.materials.some(isBusy) ? 3000 : false),
  });
}

export function useMaterial(id: string | null | undefined) {
  return useQuery({
    queryKey: materialKeys.one(id ?? "none"),
    queryFn: ({ signal }) => api.get<{ material: MaterialDetail }>(`/api/materials/${id}`, signal),
    select: (d) => d.material,
    enabled: Boolean(id),
  });
}

export function useMaterialText(id: string | null, offset: number) {
  return useQuery({
    queryKey: materialKeys.text(id ?? "none", offset),
    queryFn: ({ signal }) => api.get<MaterialTextPage>(`/api/materials/${id}/text?offset=${offset}&limit=${PREVIEW_PAGE_CHARS}`, signal),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useMaterialMutations() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: materialKeys.all });
  return {
    create: useMutation({
      mutationFn: (data: CreateMaterialInput) => api.post<{ material: MaterialDetail }>("/api/materials", data),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: UpdateMaterialInput }) => api.patch<{ material: MaterialDetail }>(`/api/materials/${id}`, data),
      onSuccess: (r) => {
        qc.setQueryData(materialKeys.one(r.material.id), { material: r.material });
        refresh();
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del<{ ok: true }>(`/api/materials/${id}`),
      onSuccess: refresh,
    }),
    retry: useMutation({
      mutationFn: (id: string) => api.post<{ material: MaterialSummary }>(`/api/materials/${id}/retry`),
      onSuccess: refresh,
    }),
    attach: useMutation({
      mutationFn: ({ id, activityId }: { id: string; activityId: string }) => api.post<AttachResponse>(`/api/materials/${id}/attach`, { activityId }),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ["activities"] });
      },
    }),
  };
}

/** Activities of a classroom (same cache as the classroom page); disabled until a classroom is chosen. */
export function useActivitiesOf(classroomId: string) {
  return useQuery({
    queryKey: classroomKeys.activities(classroomId),
    queryFn: ({ signal }) => api.get<{ activities: ActivitySummary[] }>(`/api/classrooms/${classroomId}/activities`, signal),
    select: (d) => d.activities,
    enabled: Boolean(classroomId),
  });
}

/** One file per request (the server limit is 60 MB per request), with upload progress. */
export function uploadMaterialFile(file: File, extra: { folder?: string; tags?: string }, onProgress: (f: number) => void) {
  const form = new FormData();
  form.append("file", file, file.name);
  if (extra.folder) form.append("folder", extra.folder);
  if (extra.tags) form.append("tags", extra.tags);
  return uploadWithProgress<UploadResponse>("/api/materials/files", form, onProgress);
}
