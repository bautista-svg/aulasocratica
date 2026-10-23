import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { ChangeRequestView } from "@shared/contracts/requests";

export const requestKeys = {
  all: ["requests"] as const,
  list: ["requests", "list"] as const,
  one: (id: string) => ["requests", id] as const,
};

type One = { request: ChangeRequestView };

export function useRequests() {
  return useQuery({
    queryKey: requestKeys.list,
    queryFn: ({ signal }) => api.get<{ requests: ChangeRequestView[] }>("/api/requests", signal),
    select: (d) => d.requests,
  });
}

export function useRequest(id: string) {
  return useQuery({
    queryKey: requestKeys.one(id),
    queryFn: ({ signal }) => api.get<One>(`/api/requests/${id}`, signal),
    select: (d) => d.request,
  });
}

export function useRequestMutations(id?: string) {
  const qc = useQueryClient();
  const store = (d: One) => {
    qc.setQueryData(requestKeys.one(d.request.id), d);
    void qc.invalidateQueries({ queryKey: requestKeys.list });
  };
  const refetchOne = () => (id ? qc.invalidateQueries({ queryKey: requestKeys.one(id) }) : undefined);
  return {
    open: useMutation({ mutationFn: () => api.post<One>("/api/requests"), onSuccess: store }),
    send: useMutation({
      mutationFn: ({ text, files }: { text: string; files: File[] }) => {
        const form = new FormData();
        form.set("text", text);
        for (const f of files) form.append("file", f);
        return api.post<One>(`/api/requests/${id}/messages`, form);
      },
      onSuccess: store,
    }),
    // The AI's answer to her last message; on failure the page offers to retry.
    reply: useMutation({ mutationFn: () => api.post<One>(`/api/requests/${id}/reply`), onSuccess: store, onError: () => void refetchOne() }),
    submit: useMutation({ mutationFn: () => api.post<One>(`/api/requests/${id}/submit`), onSuccess: store }),
    withdraw: useMutation({ mutationFn: () => api.post<One>(`/api/requests/${id}/withdraw`), onSuccess: store }),
    discard: useMutation({
      mutationFn: () => api.del<{ ok: true }>(`/api/requests/${id}`),
      onSuccess: () => {
        if (id) qc.removeQueries({ queryKey: requestKeys.one(id) });
        void qc.invalidateQueries({ queryKey: requestKeys.list });
      },
    }),
  };
}
