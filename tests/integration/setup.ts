import { afterAll, beforeAll, beforeEach } from "vitest";
import { startAiMock, stopAiMock, aiMock } from "./ai-mock";
import { resetRateLimits } from "@server/lib/rate-limit";

beforeAll(async () => {
  await startAiMock();
  const { runMigrations } = await import("@server/db/migrate");
  await runMigrations();
});

beforeEach(async () => {
  aiMock.reset();
  resetRateLimits();
  const { resetDb } = await import("./helpers");
  await resetDb();
});

afterAll(async () => {
  await stopAiMock();
});
