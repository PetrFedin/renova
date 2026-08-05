import { test, expect } from '@playwright/test';
import { API, WEB, apiReachable, webReachable } from './helpers';

const NATIVE_NOTIFICATION_NOISE = /expo-notifications|notifications\.(?:category|listener|setup|conflict)|setNotificationCategoryAsync|scheduleNotificationAsync/i;

test('Expo web bootstrap never loads or calls native notification APIs', async ({ page }) => {
  expect(await apiReachable(), `Required E2E API is unavailable at ${API}`).toBe(true);
  expect(await webReachable(), `Required E2E web app is unavailable at ${WEB}`).toBe(true);

  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('body')).toBeVisible({ timeout: 20_000 });
  // Give root effects, network recovery and online flush enough time to run.
  await page.waitForTimeout(2_000);

  const violations = [...consoleMessages, ...pageErrors].filter((message) =>
    NATIVE_NOTIFICATION_NOISE.test(message),
  );
  expect(
    violations,
    `Web runtime emitted native-notification noise:\n${violations.join('\n')}`,
  ).toEqual([]);
});
