import { useQuery } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { DashboardResponse } from "@shared/contracts/dashboard";

export const dashboardKey = ["dashboard"] as const;

/** Inicio. Refreshes every 20 s so "Ahora en clase" stays current while the tab is open. */
export function useDashboard() {
  return useQuery({
    queryKey: dashboardKey,
    queryFn: ({ signal }) => api.get<DashboardResponse>("/api/dashboard", signal),
    refetchInterval: 20_000,
  });
}
