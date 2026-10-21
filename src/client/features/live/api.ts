import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@client/lib/api";
import type { AlertStatus, EndAllResponse, LiveSnapshot, LiveWindow } from "@shared/contracts/live";

export const liveKeys = {
  all: (activityId: string) => ["live", activityId] as const,
  snapshot: (activityId: string, window: LiveWindow) => ["live", activityId, window] as const,
};

/** Fallback polling when the event stream is down (or blocked by a proxy). */
export const LIVE_POLL_MS = 15_000;

export function useLiveSnapshot(activityId: string, window: LiveWindow) {
  return useQuery({
    queryKey: liveKeys.snapshot(activityId, window),
    queryFn: ({ signal }) => api.get<LiveSnapshot>(`/api/live/${activityId}?window=${window}`, signal),
    refetchInterval: LIVE_POLL_MS,
    placeholderData: keepPreviousData,
    staleTime: 2_000,
  });
}

export interface LiveChange {
  types: string[];
  sessionIds: string[];
}

/**
 * Subscribes to the activity's Server-Sent Events. The browser reconnects on its own;
 * `connected` tells the UI whether updates are instant or only by polling.
 */
export function useActivityStream(activityId: string | undefined, onChange: (e: LiveChange) => void, enabled = true) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onChange);
  handler.current = onChange;
  useEffect(() => {
    if (!activityId || !enabled || typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/live/${activityId}/stream`, { withCredentials: true });
    const onReady = () => setConnected(true);
    const onError = () => setConnected(false);
    const onMessage = (ev: MessageEvent<string>) => {
      try {
        const data = JSON.parse(ev.data) as Partial<LiveChange>;
        handler.current({ types: data.types ?? [], sessionIds: data.sessionIds ?? [] });
      } catch {
        handler.current({ types: [], sessionIds: [] });
      }
    };
    es.addEventListener("ready", onReady);
    es.addEventListener("ping", onReady);
    es.addEventListener("change", onMessage as EventListener);
    es.addEventListener("error", onError);
    return () => {
      es.close();
      setConnected(false);
    };
  }, [activityId, enabled]);
  return { connected };
}

/** Runs `fn` at most once every `ms` (trailing call kept), so bursts of events cause one refetch. */
export function useThrottled(fn: () => void, ms: number) {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return useRef(() => {
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      fnRef.current();
    } else if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        last.current = Date.now();
        fnRef.current();
      }, wait);
    }
  }).current;
}

/** Re-renders every `ms` so "hace X s" labels stay current. */
export function useNow(ms = 5_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useLiveMutations(activityId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: liveKeys.all(activityId) });
    void qc.invalidateQueries({ queryKey: ["sessions"] });
  };
  return {
    alertStatus: useMutation({
      mutationFn: ({ alertId, status }: { alertId: string; status: AlertStatus }) =>
        api.patch<{ alert: { id: string; status: AlertStatus } }>(`/api/live/${activityId}/alerts/${alertId}`, { status }),
      onSuccess: refresh,
    }),
    endAll: useMutation({
      mutationFn: ({ closeLink }: { closeLink: boolean }) => api.post<EndAllResponse>(`/api/live/${activityId}/end-all`, { confirm: true, closeLink }),
      onSuccess: (r) => {
        refresh();
        // The link state shows in the activity header and in Compartir.
        if (r.linkClosed) void qc.invalidateQueries({ queryKey: ["activities", activityId] });
        void qc.invalidateQueries({ queryKey: ["classrooms"] });
      },
    }),
  };
}
