import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Me, MeResponse } from "@shared/contracts/auth";

export const meKey = ["me"] as const;

// Small device memories, read by the "no workspace on this device" screen so it can say what
// happened instead of offering to start an empty workspace:
// - SESSION_LOST (this tab): the server stopped recognizing the session while the app was open
//   (password changed or recovered on another device, or the session expired).
// - HAD_ACCOUNT (this browser): a workspace with an account was open here, so signing in is
//   the likely way back. It holds a flag only, never the email.
const SESSION_LOST = "aula:session-lost";
const HAD_ACCOUNT = "aula:had-account";

// Private mode or blocked storage: these are hints only, the screen falls back to the generic text.
function store(kind: "session" | "local") {
  const get = (): Storage | null => {
    try {
      return kind === "session" ? window.sessionStorage : window.localStorage;
    } catch {
      return null;
    }
  };
  return {
    getItem: (k: string) => {
      try {
        return get()?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (k: string, v: string) => {
      try {
        get()?.setItem(k, v);
      } catch {
        /* ignore */
      }
    },
    removeItem: (k: string) => {
      try {
        get()?.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };
}

export type LostSession = "account" | "anonymous";

export function markSessionLost(kind: LostSession) {
  store("session").setItem(SESSION_LOST, kind);
}

/** How the session that was open in this tab ended, if it did. */
export function sessionWasLost(): LostSession | null {
  const v = store("session").getItem(SESSION_LOST);
  return v === "account" || v === "anonymous" ? v : null;
}

export function deviceHadAccount(): boolean {
  return store("local").getItem(HAD_ACCOUNT) === "1";
}

/** Called whenever "me" is known: keeps the device memories in sync with the session. */
export function rememberSession(me: Me | null) {
  if (!me) return;
  store("session").removeItem(SESSION_LOST);
  if (me.hasAccount) store("local").setItem(HAD_ACCOUNT, "1");
}

/** After an explicit sign out or deleting the workspace: nothing to explain next time. */
export function forgetDeviceSession() {
  store("session").removeItem(SESSION_LOST);
  store("local").removeItem(HAD_ACCOUNT);
}

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      const r = await api.get<MeResponse>("/api/auth/me");
      rememberSession(r.teacher);
      return r;
    },
    staleTime: 60_000,
  });
}

export function useStartWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (displayName?: string) => api.post<{ teacher: Me }>("/api/auth/start", displayName ? { displayName } : {}),
    onSuccess: (r) => {
      rememberSession(r.teacher);
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
