import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 0,
  /** Demo API — один customer/contractor на БД; параллель ломает бюджет (scan/delete). */
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:8081', trace: 'on-first-retry' },
  webServer: undefined,
});
