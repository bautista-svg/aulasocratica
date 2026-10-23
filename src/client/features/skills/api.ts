import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@client/lib/api";
import type { ActivitySkills, SkillSettingsInput, SkillSettingsResponse } from "@shared/contracts/skills";

export const skillKeys = {
  activity: (id: string) => ["activity-skills", id] as const,
  settings: ["skill-settings"] as const,
};

export function useActivitySkills(activityId: string) {
  return useQuery({
    queryKey: skillKeys.activity(activityId),
    queryFn: ({ signal }) => api.get<ActivitySkills>(`/api/activities/${activityId}/skills`, signal),
    staleTime: 10_000,
  });
}

export function useSkillSettings(enabled = true) {
  return useQuery({
    queryKey: skillKeys.settings,
    queryFn: ({ signal }) => api.get<SkillSettingsResponse>("/api/skills", signal),
    enabled,
    staleTime: 60_000,
  });
}

export function useSaveSkillSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SkillSettingsInput) => api.put<SkillSettingsResponse>("/api/skills", body),
    onSuccess: (r) => {
      qc.setQueryData(skillKeys.settings, r);
      // Every view shows the chosen skills.
      void qc.invalidateQueries({ queryKey: ["activity-skills"] });
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      void qc.invalidateQueries({ queryKey: ["students"] });
    },
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
 * Evaluates the finished works still pending, two at a time, so the chart fills in as they
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
            await api.post(`/api/sessions/${id}/skills/analyze`);
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
          void qc.invalidateQueries({ queryKey: skillKeys.activity(activityId) });
          void qc.invalidateQueries({ queryKey: ["sessions", id] });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    const final = { running: false, done, total: sessionIds.length, failed };
    if (!stopped.current) setRun(final);
    void qc.invalidateQueries({ queryKey: skillKeys.activity(activityId) });
    void qc.invalidateQueries({ queryKey: ["students"] });
    return final;
  }

  return { run, start };
}
