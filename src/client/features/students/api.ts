import { useQuery } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { StudentDetail } from "@shared/contracts/students";

export const studentKeys = {
  one: (id: string) => ["students", id] as const,
};

export function useStudent(id: string) {
  return useQuery({
    queryKey: studentKeys.one(id),
    queryFn: ({ signal }) => api.get<StudentDetail>(`/api/students/${id}`, signal),
  });
}
