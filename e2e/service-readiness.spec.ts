import { test, expect } from '@playwright/test';
import { API, WEB, apiReachable, webReachable } from './helpers';

test('required API and Expo web services are reachable', async () => {
  expect(
    await apiReachable(),
    `Required E2E API is unavailable at ${API}`,
  ).toBe(true);
  expect(
    await webReachable(),
    `Required E2E web application is unavailable at ${WEB}`,
  ).toBe(true);
});
