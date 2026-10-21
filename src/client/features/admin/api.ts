import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@client/lib/api";
import type { AdminOverview, AdminSessionResponse, AdminWorkspacesResponse } from "@shared/contracts/admin";

export const adminKeys = {
  all: ["admin"] as const,
  session: ["admin", "session"] as const,
  overview: ["admin", "overview"] as const,
  workspaces: ["admin", "workspaces"] as const,
};

/** `disabled` when the server has no ADMIN_PASSWORD (the panel answers 404). */
export function useAdminSession() {
  return useQuery({
    queryKey: adminKeys.session,
    queryFn: async ({ signal }) => {
      try {
        const r = await api.get<AdminSessionResponse>("/api/admin/session", signal);
        return { disabled: false, authenticated: r.authenticated };
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return { disabled: true, authenticated: false };
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

function useOnExpired() {
  const qc = useQueryClient();
  return (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) void qc.invalidateQueries({ queryKey: adminKeys.session });
  };
}

export function useAdminOverview(enabled: boolean) {
  const onExpired = useOnExpired();
  return useQuery({
    queryKey: adminKeys.overview,
    queryFn: async ({ signal }) => {
      try {
        return await api.get<AdminOverview>("/api/admin/overview", signal);
      } catch (e) {
        onExpired(e);
        throw e;
      }
    },
    enabled,
    refetchInterval: 60_000,
  });
}

export function useAdminWorkspaces(enabled: boolean) {
  const onExpired = useOnExpired();
  return useInfiniteQuery({
    queryKey: adminKeys.workspaces,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      try {
        return await api.get<AdminWorkspacesResponse>(`/api/admin/workspaces${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`, signal);
      } catch (e) {
        onExpired(e);
        throw e;
      }
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useAdminLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post<{ ok: true }>("/api/admin/login", { password }),
    onSuccess: () => {
      qc.setQueryData(adminKeys.session, { disabled: false, authenticated: true });
    },
  });
}

export function useAdminLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/api/admin/logout"),
    onSettled: () => {
      qc.removeQueries({ queryKey: adminKeys.overview });
      qc.removeQueries({ queryKey: adminKeys.workspaces });
      qc.setQueryData(adminKeys.session, { disabled: false, authenticated: false });
    },
  });
}

export function useSuspend() {
  const qc = useQueryClient();
  const onExpired = useOnExpired();
  return useMutation({
    mutationFn: ({ id, suspend }: { id: string; suspend: boolean }) =>
      api.post<{ ok: true; suspended: boolean }>(`/api/admin/workspaces/${id}/${suspend ? "suspend" : "unsuspend"}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.workspaces });
      void qc.invalidateQueries({ queryKey: adminKeys.overview });
    },
    onError: onExpired,
  });
}
