import { serve } from "@hono/node-server";
import { env, isProd } from "./env";
import { createApp, defaultStaticDir } from "./app";
import { runMigrations } from "./db/migrate";
import { sqlClient } from "./db/client";
import { ensureStorage } from "./lib/storage";
import { log, errorFields } from "./lib/logger";
import { startJobs, stopJobs } from "./jobs";
import { markInterruptedAtBoot } from "./services/file-jobs";
import "./services/retention";

async function main() {
  ensureStorage();
  await runMigrations();
  await markInterruptedAtBoot();
  const app = createApp({ staticDir: isProd ? defaultStaticDir() : null });
  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" }, (info) => {
    log.info("server_started", { port: info.port, env: env.NODE_ENV });
  });
  startJobs();

  const shutdown = async (signal: string) => {
    log.info("shutdown", { signal });
    stopJobs();
    server.close();
    // Give in-flight requests (e.g. a tutor reply being streamed) a moment to finish.
    setTimeout(async () => {
      await sqlClient.end({ timeout: 5 });
      process.exit(0);
    }, 3000).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

process.on("unhandledRejection", (err) => log.error("unhandled_rejection", errorFields(err)));

main().catch((err) => {
  log.error("startup_failed", errorFields(err));
  process.exit(1);
});
