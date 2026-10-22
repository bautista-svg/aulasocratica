import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@client/lib/api";
import type {
  RubricAssessmentView,
  RubricSaveInput,
  RubricSuggestResult,
  SessionDetail,
  SummaryView,
  XrayAnalyzeResult,
  XrayListResponse,
  XrayView,
} from "@shared/contracts/sessions";
import type { SummaryBasis } from "@shared/domain/session-summary";
import type { XrayItem, XrayStatus } from "@shared/domain/thinking-xray";

export const sessionKeys = {
  all: ["sessions"] as const,
  one: (id: string) => ["sessions", id] as const,
  xrayList: (f: XrayFilters) => ["sessions", "xray-list", f] as const,
};

export function useSession(id: string) {
  return useQuery({
    queryKey: sessionKeys.one(id),
    queryFn: ({ signal }) => api.get<SessionDetail>(`/api/sessions/${id}`, signal),
    // While the student works, refresh as a fallback to the live stream.
    refetchInterval: (q) => (q.state.data?.session.status === "in_progress" ? 10_000 : false),
    staleTime: 3_000,
  });
}

export function useSessionMutations(id: string) {
  const qc = useQueryClient();
  const patch = (fn: (d: SessionDetail) => SessionDetail) => qc.setQueryData<SessionDetail>(sessionKeys.one(id), (d) => (d ? fn(d) : d));
  const refreshLive = (activityId?: string) => {
    void qc.invalidateQueries({ queryKey: sessionKeys.one(id) });
    if (activityId) void qc.invalidateQueries({ queryKey: ["live", activityId] });
    void qc.invalidateQueries({ queryKey: ["students"] });
  };
  return {
    end: useMutation({
      mutationFn: (_activityId: string) => api.post<{ ok: true; changed: boolean }>(`/api/sessions/${id}/end`),
      onSuccess: (_r, activityId) => refreshLive(activityId),
    }),
    reopen: useMutation({
      mutationFn: (_activityId: string) => api.post<{ ok: true; changed: boolean }>(`/api/sessions/${id}/reopen`),
      onSuccess: (_r, activityId) => refreshLive(activityId),
    }),
    remove: useMutation({
      mutationFn: () => api.del<{ ok: true; activityId: string; classroomId: string }>(`/api/sessions/${id}`, { confirm: true }),
      onSuccess: (r) => {
        // Stop polling the deleted work; the page removes it from the cache once it navigated away.
        void qc.cancelQueries({ queryKey: sessionKeys.one(id) });
        void qc.invalidateQueries({ queryKey: ["live", r.activityId] });
        void qc.invalidateQueries({ queryKey: ["students"] });
        void qc.invalidateQueries({ queryKey: ["classrooms"] });
      },
    }),
    suggestRubric: useMutation({
      mutationFn: () => api.post<RubricSuggestResult>(`/api/sessions/${id}/rubric/suggest`),
      onSuccess: (r) => patch((d) => ({ ...d, rubric: r.rubric })),
    }),
    clearSuggestion: useMutation({
      mutationFn: (criterionId?: string) =>
        api.del<{ rubric: RubricAssessmentView }>(
          `/api/sessions/${id}/rubric/suggestion${criterionId ? `?criterionId=${encodeURIComponent(criterionId)}` : ""}`,
        ),
      onSuccess: (r) => patch((d) => ({ ...d, rubric: r.rubric })),
    }),
    saveRubric: useMutation({
      mutationFn: (body: RubricSaveInput) => api.put<{ rubric: RubricAssessmentView }>(`/api/sessions/${id}/rubric`, body),
      onSuccess: (r) => patch((d) => ({ ...d, rubric: r.rubric })),
    }),
    summarize: useMutation({
      mutationFn: (basis: SummaryBasis[]) => api.post<{ summary: SummaryView }>(`/api/sessions/${id}/summary`, { basis }),
      onSuccess: (r) => patch((d) => ({ ...d, summary: r.summary })),
    }),
    analyzeXray: useMutation({
      mutationFn: () => api.post<XrayAnalyzeResult>(`/api/sessions/${id}/xray/analyze`),
      onSuccess: (r) => {
        patch((d) => ({ ...d, xray: r.xray }));
        void qc.invalidateQueries({ queryKey: ["sessions", "xray-list"] });
      },
    }),
    patchXray: useMutation({
      mutationFn: ({ itemId, ...body }: { itemId: string; status?: XrayStatus; interpretation?: string }) =>
        api.patch<{ item: XrayItem; xray: XrayView }>(`/api/sessions/${id}/xray/items/${itemId}`, body),
      onSuccess: (r) => {
        patch((d) => ({ ...d, xray: r.xray }));
        void qc.invalidateQueries({ queryKey: ["sessions", "xray-list"] });
      },
    }),
  };
}

/** End / let continue any work of an activity (used by the live list rows). */
export function useSessionActions(activityId: string) {
  const qc = useQueryClient();
  const refresh = (sessionId: string) => {
    void qc.invalidateQueries({ queryKey: ["live", activityId] });
    void qc.invalidateQueries({ queryKey: sessionKeys.one(sessionId) });
  };
  return {
    end: useMutation({
      mutationFn: (sessionId: string) => api.post<{ ok: true; changed: boolean }>(`/api/sessions/${sessionId}/end`),
      onSuccess: (_r, sessionId) => refresh(sessionId),
    }),
    reopen: useMutation({
      mutationFn: (sessionId: string) => api.post<{ ok: true; changed: boolean }>(`/api/sessions/${sessionId}/reopen`),
      onSuccess: (_r, sessionId) => refresh(sessionId),
    }),
    /** "Eliminar trabajo" from the live list (e.g. someone entered with a classmate's name). */
    remove: useMutation({
      mutationFn: (sessionId: string) => api.del<{ ok: true; activityId: string; classroomId: string }>(`/api/sessions/${sessionId}`, { confirm: true }),
      onSuccess: (r, sessionId) => {
        qc.removeQueries({ queryKey: sessionKeys.one(sessionId) });
        void qc.invalidateQueries({ queryKey: ["live", activityId] });
        void qc.invalidateQueries({ queryKey: ["activities", activityId] });
        void qc.invalidateQueries({ queryKey: ["classrooms", r.classroomId] });
        void qc.invalidateQueries({ queryKey: ["students"] });
      },
    }),
  };
}

function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] ?? null;
}

/** Downloads the journey PDF (fetch + blob so errors can be shown instead of a JSON page). */
export function useJourneyDownload() {
  const [busyId, setBusyId] = useState<string | null>(null);
  async function download(sessionId: string) {
    if (busyId) return;
    setBusyId(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/journey.pdf`, { credentials: "same-origin", headers: { "x-aula-client": "1" } });
      if (!res.ok) {
        let message = "No se pudo generar el PDF. Probá de nuevo en unos segundos.";
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          if (data.error?.message) message = data.error.message;
        } catch {
          /* not JSON */
        }
        throw new ApiError(res.status, message, "pdf_failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileNameFrom(res.headers.get("content-disposition")) ?? "Recorrido.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("PDF descargado");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo descargar el PDF. Revisá tu conexión y probá de nuevo.");
    } finally {
      setBusyId(null);
    }
  }
  return { download, busyId };
}

// ── Radiografía list ──

export interface XrayFilters {
  classroomId?: string;
  activityId?: string;
  q?: string;
}

export function useXrayList(f: XrayFilters) {
  return useInfiniteQuery({
    queryKey: sessionKeys.xrayList(f),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ view: "radiografia" });
      if (f.classroomId) p.set("classroomId", f.classroomId);
      if (f.activityId) p.set("activityId", f.activityId);
      if (f.q?.trim()) p.set("q", f.q.trim());
      if (pageParam) p.set("cursor", pageParam);
      return api.get<XrayListResponse>(`/api/sessions?${p.toString()}`, signal);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}
