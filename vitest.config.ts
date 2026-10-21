import path from "node:path";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

const fileEnv = loadEnv("test", process.cwd(), "");
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
            DATABASE_URL: fileEnv.DATABASE_URL_TEST ?? process.env.DATABASE_URL_TEST ?? "",
            DATA_DIR: "./data-test",
            PUBLIC_URL: "http://localhost:5173",
            ANTHROPIC_API_KEY: "test-key",
            ANTHROPIC_BASE_URL: "http://127.0.0.1:47811",
            ADMIN_PASSWORD: "test-admin-password-123456",
            AI_DAILY_TOKENS_PER_WORKSPACE: "4000000",
          },
        },
      },
    ],
  },
});
