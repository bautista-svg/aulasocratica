import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@client/lib/api";
import type { ActivityAspects } from "@shared/contracts/sessions";

export const aspectKeys = {
  activity: (id: string) => ["activity-aspects", id] as const,
};

export function useActivityAspects(activityId: string) {
  return useQuery({
    queryKey: aspectKeys.activity(activityId),
    queryFn: ({ signal }) => api.get<ActivityAspects>(`/api/activities/${activityId}/aspects`, signal),
    staleTime: 10_000,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GroupRun {
  running: boolean;
  done: number;
  total: number;
  failed: number;
}

/**
 * Analyzes the finished works still pending, two at a time, so the chart fills in as they
 * finish. A busy server (429) gets one more try after a pause; leaving the page stops the run.
 */
export function useGroupAnalysis(activityId: string) {
  const qc = useQueryClient();
  const [run, setRun] = useState<GroupRun>({ running: false, done: 0, total: 0, failed: 0 });
  const stopped = useRef(false);
  useEffect(
    () => () => {
      stopped.current = true;
    },
    [],
  );

  async function start(sessionIds: string[]): Promise<GroupRun> {
    stopped.current = false;
    let done = 0;
    let failed = 0;
    let next = 0;
    setRun({ running: true, done, total: sessionIds.length, failed });
    const worker = async () => {
      while (!stopped.current && next < sessionIds.length) {
        const id = sessionIds[next++]!;
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok && !stopped.current; attempt++) {
          try {
            await api.post(`/api/sessions/${id}/aspects/analyze`);
            ok = true;
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 429) || attempt > 0) break;
            await sleep(20_000);
          }
        }
        done++;
        if (!ok) failed++;
        if (stopped.current) return;
        setRun({ running: true, done, total: sessionIds.length, failed });
        if (ok) {
          void qc.invalidateQueries({ queryKey: aspectKeys.activity(activityId) });
          void qc.invalidateQueries({ queryKey: ["sessions", id] });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    const final = { running: false, done, total: sessionIds.length, failed };
    if (!stopped.current) setRun(final);
    void qc.invalidateQueries({ queryKey: aspectKeys.activity(activityId) });
    void qc.invalidateQueries({ queryKey: ["students"] });
    return final;
  }

  return { run, start };
}
