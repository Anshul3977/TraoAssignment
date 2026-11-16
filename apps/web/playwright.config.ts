import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Expects `next build` to have run. No LLM key: the real /api/demo answers 503.
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/demo`,
    reuseExistingServer: !process.env.CI,
    env: { GROQ_API_KEY: "", GEMINI_API_KEY: "" },
  },
});
