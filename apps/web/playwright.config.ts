import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../../.env.test"), override: true });

const WEB_PORT = process.env.WEB_PORT ?? "3100";
const API_PORT = process.env.API_PORT ?? "4100";
const baseURL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-360", use: { viewport: { width: 360, height: 740 } } },
  ],
  webServer: [
    {
      command: "node ../api/dist/main.js",
      port: Number(API_PORT),
      env: process.env as Record<string, string>,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `next dev -p ${WEB_PORT}`,
      port: Number(WEB_PORT),
      env: process.env as Record<string, string>,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
