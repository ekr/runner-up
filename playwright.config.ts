import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'fs';

const NIXOS_CHROMIUM = '/run/current-system/sw/bin/chromium';
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync(NIXOS_CHROMIUM) ? NIXOS_CHROMIUM : undefined);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 4,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3003',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: ['**/mobile.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: chromiumExecutable ? {
          executablePath: chromiumExecutable,
        } : undefined,
      },
    },
    {
      name: 'mobile',
      testMatch: ['**/mobile.spec.ts'],
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        launchOptions: chromiumExecutable ? {
          executablePath: chromiumExecutable,
        } : undefined,
      },
    },
  ],
  webServer: {
    command: 'PORT=3003 node app.js',
    url: 'http://localhost:3003',
    reuseExistingServer: !process.env.CI,
  },
});
