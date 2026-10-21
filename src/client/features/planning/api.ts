import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import type { CreateFromProposalInput, CreateFromProposalResponse, ProposalsInput, ProposalsResponse } from "@shared/contracts/planning";

export function useGenerateProposals() {
  return useMutation({
    mutationFn: (body: ProposalsInput) => api.post<ProposalsResponse>("/api/planning/proposals", body),
  });
}

export function useCreateFromProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFromProposalInput) => api.post<CreateFromProposalResponse>("/api/planning/create", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["classrooms"] });
      void qc.invalidateQueries({ queryKey: ["tutors"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
