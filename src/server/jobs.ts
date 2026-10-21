// Background work that runs inside the API process (single instance).
import { log } from "./lib/logger";

type Job = { name: string; everyMs: number; run: () => Promise<void> };
const jobs: Job[] = [];
const timers: NodeJS.Timeout[] = [];

export function registerJob(job: Job) {
  jobs.push(job);
}

export function startJobs() {
  for (const job of jobs) {
    const tick = async () => {
      try {
        await job.run();
      } catch (err) {
        log.error("job_failed", { job: job.name, error: (err as Error).message });
      }
    };
    // First run shortly after boot, then on its interval.
    timers.push(setTimeout(tick, 5_000));
    timers.push(setInterval(tick, job.everyMs));
  }
}

export function stopJobs() {
  for (const t of timers) clearTimeout(t);
}
