import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { CreateReportInput, ReportDetail, ReportDraftResponse, ReportListResponse, ReportResponse } from "@shared/contracts/reports";

export const reportKeys = {
  all: ["reports"] as const,
  list: ["reports", "list"] as const,
  one: (id: string) => ["reports", id] as const,
};

export function useReports() {
  return useQuery({
    queryKey: reportKeys.list,
    queryFn: ({ signal }) => api.get<ReportListResponse>("/api/reports", signal),
    select: (d) => d.reports,
  });
}

export function useReport(id: string) {
  return useQuery({
    queryKey: reportKeys.one(id),
    queryFn: ({ signal }) => api.get<ReportResponse>(`/api/reports/${id}`, signal),
    select: (d) => d.report,
    // The teacher may be typing: never replace the screen's data on window focus.
    refetchOnWindowFocus: false,
  });
}

function useStore() {
  const qc = useQueryClient();
  return (report: ReportDetail) => {
    qc.setQueryData(reportKeys.one(report.id), { report });
    void qc.invalidateQueries({ queryKey: reportKeys.list });
  };
}

export function useCreateReport() {
  const store = useStore();
  return useMutation({
    mutationFn: (body: CreateReportInput) => api.post<ReportResponse>("/api/reports", body as Record<string, unknown>),
    onSuccess: (r) => store(r.report),
  });
}

export function useReportMutations(id: string) {
  const store = useStore();
  const qc = useQueryClient();
  return {
    save: useMutation({
      mutationFn: (body: { title?: string; narrative?: Record<string, string> }) => api.patch<ReportResponse>(`/api/reports/${id}`, body),
      onSuccess: (r) => store(r.report),
    }),
    refresh: useMutation({
      mutationFn: () => api.post<ReportResponse>(`/api/reports/${id}/refresh`),
      onSuccess: (r) => store(r.report),
    }),
    validate: useMutation({
      mutationFn: () => api.post<ReportResponse>(`/api/reports/${id}/validate`),
      onSuccess: (r) => store(r.report),
    }),
    draft: useMutation({
      mutationFn: () => api.post<ReportDraftResponse>(`/api/reports/${id}/ai`),
    }),
    remove: useMutation({
      mutationFn: () => api.del<{ ok: true }>(`/api/reports/${id}`),
      onSuccess: () => {
        qc.removeQueries({ queryKey: reportKeys.one(id) });
        void qc.invalidateQueries({ queryKey: reportKeys.list });
      },
    }),
  };
}
