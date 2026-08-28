/**
 * Playwright E2E configuration for EventPulse Expo app.
 *
 * Run E2E tests:
 *   npx playwright test                  # run all test files
 *   npx playwright test e2e/home.test.mjs  # run home screen tests only
 *
 * The Metro dev server must be running on port 8081 before running tests:
 *   cd 06-UI && npx expo start --host lan --port 8081
 *
 * Or set BASE_URL to point at any running EventPulse instance:
 *   BASE_URL=http://localhost:8081 npx playwright test
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8081',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
