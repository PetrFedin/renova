import { defineConfig } from '@playwright/test';

const jsonReport = process.env.RENOVA_PLAYWRIGHT_JSON_REPORT?.trim();

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 0,
  /** Demo API — один customer/contractor на БД; параллель ломает бюджет (scan/delete). */
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: jsonReport
    ? [['line'], ['json', { outputFile: jsonReport }]]
    : 'line',
  use: { baseURL: 'http://127.0.0.1:8081', trace: 'on-first-retry' },
  webServer: undefined,
});
