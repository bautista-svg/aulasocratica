import { useQuery } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { TutorSummary } from "@shared/contracts/tutors";

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
