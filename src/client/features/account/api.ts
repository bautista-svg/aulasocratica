// Account and workspace mutations. Signing in, creating an account or signing out changes
// whose data every screen shows, so the ["me"] query is updated and everything else refetched.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@client/lib/api";
import { meKey } from "@client/lib/session";
import type { Me, RecoveryCodeResponse } from "@shared/contracts/auth";

export function useUpdateName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) => api.patch<{ teacher: Me }>("/api/auth/me", { displayName }),
    onSuccess: (r) => {
      qc.setQueryData(meKey, { teacher: r.teacher });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** `onRegistered` runs before "me" changes (the form unmounts once the workspace has an account). */
export function useRegister(onRegistered?: (r: RecoveryCodeResponse) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string; displayName?: string }) => api.post<RecoveryCodeResponse>("/api/auth/register", body),
    onSuccess: (r) => {
      onRegistered?.(r);
      qc.setQueryData(meKey, { teacher: r.teacher });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== meKey[0] });
    },
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<{ teacher: Me; merged: boolean }>("/api/auth/login", body),
    onSuccess: (r) => {
      qc.setQueryData(meKey, { teacher: r.teacher });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== meKey[0] });
    },
  });
}

/** `onRecovered` runs before "me" changes, so the screen can keep showing the new code. */
export function useRecover(onRecovered?: (r: RecoveryCodeResponse) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; recoveryCode: string; newPassword: string }) => api.post<RecoveryCodeResponse>("/api/auth/recover", body),
    onSuccess: (r) => {
      onRecovered?.(r);
      qc.setQueryData(meKey, { teacher: r.teacher });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== meKey[0] });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post<{ ok: true; recoveryCode: string }>("/api/auth/password", body),
  });
}

export function useNewRecoveryCode() {
  return useMutation({ mutationFn: () => api.post<{ recoveryCode: string }>("/api/auth/recovery-code") });
}

/** Clears every cached screen after the workspace is no longer open on this device. */
export function useForgetWorkspace() {
  const qc = useQueryClient();
  return () => {
    qc.clear();
    qc.setQueryData(meKey, { teacher: null });
  };
}

export function useLogout() {
  return useMutation({ mutationFn: () => api.post<{ ok: true }>("/api/auth/logout") });
}

export function useDeleteWorkspace() {
  return useMutation({ mutationFn: () => api.del<{ ok: true }>("/api/auth/workspace", { confirm: "BORRAR" }) });
}
