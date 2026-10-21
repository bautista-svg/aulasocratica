import path from "node:path";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

const fileEnv = loadEnv("test", process.cwd(), "");
// Parallel workers (e.g. several agents) can each use their own DB, mock port and data dir.
const testDb = process.env.DATABASE_URL_TEST ?? fileEnv.DATABASE_URL_TEST ?? "";
const mockPort = process.env.AI_MOCK_PORT ?? "47811";
const dataDir = process.env.TEST_DATA_DIR ?? "./data-test";
const alias = {
  "@shared": path.resolve(__dirname, "src/shared"),
  "@server": path.resolve(__dirname, "src/server"),
  "@client": path.resolve(__dirname, "src/client"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // One shared database: files run one after another.
          fileParallelism: false,
          setupFiles: ["tests/integration/setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            NODE_ENV: "test",
            DATABASE_URL: testDb,
            DATA_DIR: dataDir,
            AI_MOCK_PORT: mockPort,
            PUBLIC_URL: "http://localhost:5173",
            ANTHROPIC_API_KEY: "test-key",
            ANTHROPIC_BASE_URL: `http://127.0.0.1:${mockPort}`,
            ADMIN_PASSWORD: "test-admin-password-123456",
            AI_DAILY_TOKENS_PER_WORKSPACE: "4000000",
          },
        },
      },
    ],
  },
});
