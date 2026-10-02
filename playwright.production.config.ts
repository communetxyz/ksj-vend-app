import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/production",
  testMatch: "production.spec.ts",
  workers: 1,
  timeout: 180000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4184", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run preview",
    url: "http://127.0.0.1:4184",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
