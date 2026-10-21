import { afterAll, beforeAll, beforeEach } from "vitest";
import { startAiMock, stopAiMock, aiMock } from "./ai-mock";
import { resetRateLimits } from "@server/lib/rate-limit";

beforeAll(async () => {
  await startAiMock(Number(process.env.AI_MOCK_PORT ?? 47811));
  const { runMigrations } = await import("@server/db/migrate");
  await runMigrations();
});

beforeEach(async () => {
  aiMock.reset();
  resetRateLimits();
  (await import("@server/ai/client")).resetAiSpendCache();
  const { resetDb } = await import("./helpers");
  await resetDb();
});

afterAll(async () => {
  await stopAiMock();
});
