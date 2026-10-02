import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/chain",
  testMatch: "checkout-chain.spec.ts",
  timeout: 240000,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4184", serviceWorkers: "block", trace: "retain-on-failure" },
  projects: [
    {
      name: "local-chain",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      command: "npm run preview",
      url: "http://127.0.0.1:4184",
      reuseExistingServer: !process.env.CI,
      timeout: 240000,
    },
    {
      command: "anvil --port 8547 --chain-id 11155111 --silent",
      url: "http://127.0.0.1:8547",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
