import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Me, MeResponse } from "@shared/contracts/auth";

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => api.get<MeResponse>("/api/auth/me"),
    staleTime: 60_000,
  });
}

export function useStartWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (displayName?: string) => api.post<{ teacher: Me }>("/api/auth/start", displayName ? { displayName } : {}),
    onSuccess: (r) => {
      qc.setQueryData(meKey, { teacher: r.teacher });
    },
  });
}

export function useAiStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["ai-status"],
    queryFn: () => api.get<{ ai: "ok" | "not_configured" | "unavailable" }>("/api/health/ai"),
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: (q) => (q.state.data?.ai === "ok" ? false : 60_000),
  });
}
