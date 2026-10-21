import { defineConfig, devices } from "@playwright/test";

// E2E against a running app. Locally: `npm run dev` (http://localhost:5173).
// Against production: E2E_BASE_URL=https://aulasocratica.becode.com.ar npx playwright test --grep @smoke
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
  },
  projects: [
    { name: "mobile-375", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, channel: "chrome" } },
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, channel: "chrome" } },
  ],
});
