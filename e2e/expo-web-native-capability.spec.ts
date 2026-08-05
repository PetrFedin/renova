import { test, expect, type Page } from '@playwright/test';
import {
  API,
  WEB,
  apiReachable,
  authHeaders,
  pickPrimaryDemoProject,
  webReachable,
  type DemoUser,
} from './helpers';

const NATIVE_NOTIFICATION_NOISE = /expo-notifications|notifications\.(?:category|listener|setup|conflict)|setNotificationHandler|setNotificationCategoryAsync|scheduleNotificationAsync|requestPermissionsAsync|getExpoPushTokenAsync|typeof global === ["']undefined["']/i;

function captureRuntimeNoise(page: Page) {
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
  return messages;
}

async function assertNoNativeNotificationNoise(messages: string[]) {
  const violations = messages.filter((message) => NATIVE_NOTIFICATION_NOISE.test(message));
  expect(
    violations,
    `Web runtime emitted native-notification noise:\n${violations.join('\n')}`,
  ).toEqual([]);
}

test.beforeEach(async () => {
  expect(await apiReachable(), `Required E2E API is unavailable at ${API}`).toBe(true);
  expect(await webReachable(), `Required E2E web app is unavailable at ${WEB}`).toBe(true);
});

test('anonymous Expo web bootstrap never loads native notification APIs', async ({ page }) => {
  const messages = captureRuntimeNoise(page);

  await page.goto('/');
  await expect(page.locator('body')).toBeVisible({ timeout: 20_000 });
  // Give root effects, network recovery and online flush enough time to run.
  await page.waitForTimeout(2_000);

  await assertNoNativeNotificationNoise(messages);
});

test('authenticated Expo web bootstrap never requests push permissions or token', async ({ page, request }) => {
  const contractor = (await (
    await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })
  ).json()) as DemoUser;
  const projects = await (
    await request.get(`${API}/api/v1/projects`, { headers: authHeaders(contractor) })
  ).json();
  const projectId = pickPrimaryDemoProject(projects).id;

  await page.addInitScript(
    ({ userId, activeProjectId, accessToken }) => {
      localStorage.setItem('renova_user_id', userId);
      localStorage.setItem('renova_project_id', activeProjectId);
      localStorage.setItem('renova_user_role', 'contractor');
      localStorage.setItem('renova_detail_quiz_done', '1');
      localStorage.setItem('renova_project_explicitly_picked', '1');
      localStorage.removeItem('renova_pending_project_pick');
      if (accessToken) localStorage.setItem('renova_access_token', accessToken);
    },
    {
      userId: contractor.id,
      activeProjectId: projectId,
      accessToken: contractor.access_token?.trim() || '',
    },
  );

  const messages = captureRuntimeNoise(page);
  await page.goto('/outbox-dead-letters');
  await expect(page.locator('body')).toBeVisible({ timeout: 20_000 });
  // Auth/session bootstrap used to import expo-notifications here and emit
  // setNotificationHandler + `global` warnings on every protected route.
  await page.waitForTimeout(2_000);

  await assertNoNativeNotificationNoise(messages);
});
