import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /gp\d+\..*\.spec\.ts$/,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  workers: 1,
  use: {
    baseURL: process.env.EXPO_WEB_URL || 'http://127.0.0.1:8081',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
