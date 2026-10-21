import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { markSessionLost, meKey } from "./session";
import type { MeResponse } from "@shared/contracts/auth";

/**
 * The teacher's session ended while a screen of /app was open (password changed or recovered on
 * another device, session expired, workspace deleted elsewhere): every request answers 401
 * "no_session". Instead of failing one by one in silence, refetch "me" — it comes back without a
 * teacher, so the /app layout swaps the whole panel for the "no workspace on this device" screen,
 * which explains what happened (see `sessionWasLost`). Student screens (/clase) have their own
 * session with the same code and handle it themselves.
 */
function onApiError(err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 401 || err.code !== "no_session") return;
  if (typeof window === "undefined" || !window.location.pathname.startsWith("/app")) return;
  const before = queryClient.getQueryData<MeResponse>(meKey)?.teacher;
  if (!before) return; // no workspace was open: the layout already shows the right screen
  markSessionLost(before.hasAccount ? "account" : "anonymous");
  void queryClient.invalidateQueries({ queryKey: meKey, refetchType: "all" });
}

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        // Never retry client errors (not found, forbidden…); retry network/5xx twice.
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
        return count < 2;
      },
    },
    mutations: { retry: false },
  },
});
