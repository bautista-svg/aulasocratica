import { useQuery } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { DashboardActivitiesResponse, DashboardResponse } from "@shared/contracts/dashboard";

export const dashboardKey = ["dashboard"] as const;
export const allActivitiesKey = ["dashboard", "activities"] as const;

/** Every activity of the classrooms the teacher sees ("Actividades" and the search). */
export function useAllActivities(enabled = true) {
  return useQuery({
    queryKey: allActivitiesKey,
    queryFn: ({ signal }) => api.get<DashboardActivitiesResponse>("/api/dashboard/activities", signal),
    enabled,
    staleTime: 15_000,
  });
}

/** Inicio. Refreshes every 20 s so "Ahora en clase" stays current while the tab is open. */
export function useDashboard() {
  return useQuery({
    queryKey: dashboardKey,
    queryFn: ({ signal }) => api.get<DashboardResponse>("/api/dashboard", signal),
    refetchInterval: 20_000,
  });
}
