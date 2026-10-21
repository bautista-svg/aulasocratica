import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { AlertCountResponse, AlertInboxResponse, AlertInboxStatus } from "@shared/contracts/alerts";
import type { AlertStatus } from "@shared/contracts/live";

export interface AlertFilters {
  status: AlertInboxStatus;
  classroomId?: string;
  activityId?: string;
  severity?: "immediate" | "review";
  origin?: "ai" | "observed";
}

export const alertKeys = {
  all: ["alerts"] as const,
  inbox: (f: AlertFilters) => ["alerts", "inbox", f] as const,
  count: ["alerts", "count"] as const,
};

/** The panel refreshes itself; new alerts show up without reloading. */
export const ALERTS_POLL_MS = 20_000;

export function useAlertInbox(f: AlertFilters) {
  return useInfiniteQuery({
    queryKey: alertKeys.inbox(f),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ status: f.status });
      if (f.classroomId) p.set("classroomId", f.classroomId);
      if (f.activityId) p.set("activityId", f.activityId);
      if (f.severity) p.set("severity", f.severity);
      if (f.origin) p.set("origin", f.origin);
      if (pageParam) p.set("cursor", pageParam);
      return api.get<AlertInboxResponse>(`/api/alerts?${p.toString()}`, signal);
    },
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: ALERTS_POLL_MS,
  });
}

/** Open alerts of the whole workspace, for the navigation badge. */
export function useAlertCount() {
  return useQuery({
    queryKey: alertKeys.count,
    queryFn: ({ signal }) => api.get<AlertCountResponse>("/api/alerts/count", signal),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAlertMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: alertKeys.all });
    // The same alerts show in the live view of each activity and on the home page.
    void qc.invalidateQueries({ queryKey: ["live"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  return {
    setStatus: useMutation({
      mutationFn: ({ id, status }: { id: string; status: AlertStatus }) =>
        api.patch<{ alert: { id: string; status: AlertStatus } }>(`/api/alerts/${id}`, { status }),
      onSettled: refresh,
    }),
    bulk: useMutation({
      mutationFn: ({ ids, status }: { ids: string[]; status: AlertStatus }) => api.post<{ updated: number }>("/api/alerts/bulk", { ids, status }),
      onSettled: refresh,
    }),
  };
}
