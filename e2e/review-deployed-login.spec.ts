import { test, expect, type Page } from '@playwright/test';

const REVIEW_BASE = process.env.RENOVA_REVIEW_BASE_URL?.replace(/\/$/, '') || 'https://renova-review-full.onrender.com';

async function enterRoleAndOpenProject(page: Page, role: 'customer' | 'contractor') {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(`${REVIEW_BASE}/?review_smoke=${role}-${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  await expect(page.getByTestId('review-role-screen')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('сервер при необходимости запустится', { exact: false })).toBeVisible({ timeout: 60_000 });

  const authResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/auth/demo') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );

  await page.getByTestId(`review-role-${role}`).click();
  await expect(page.getByTestId('review-login-status')).toBeVisible({ timeout: 10_000 });

  const authResponse = await authResponsePromise;
  expect(authResponse.status(), `demo auth failed for ${role}: ${await authResponse.text()}`).toBe(200);

  await expect(page.getByText('Выберите объект', { exact: true })).toBeVisible({ timeout: 60_000 });
  const firstProjectMeta = page.getByText(/Квартира|Дом/).first();
  await expect(firstProjectMeta).toBeVisible({ timeout: 60_000 });

  const projectResponsePromise = page.waitForResponse(
    (response) => /\/api\/v1\/projects\/[0-9a-f-]{36}$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET',
    { timeout: 60_000 },
  );
  await firstProjectMeta.click();
  const projectResponse = await projectResponsePromise;
  expect(projectResponse.status(), `project load failed for ${role}: ${await projectResponse.text()}`).toBe(200);

  await expect(page.getByTestId('os-home-ready')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('os-home-error')).toHaveCount(0);
  await expect(page.getByText('Не удалось загрузить главную', { exact: true })).toHaveCount(0);

  const fatalConsoleErrors = consoleErrors.filter((message) =>
    /uncaught|unhandled|referenceerror|typeerror|syntaxerror/i.test(message),
  );
  expect(fatalConsoleErrors, `fatal browser console errors for ${role}`).toEqual([]);
}

test.describe('deployed review role and project entry', () => {
  test.describe.configure({ mode: 'serial' });

  test('customer enters project and sees loaded home', async ({ page }) => {
    test.setTimeout(240_000);
    await enterRoleAndOpenProject(page, 'customer');
  });

  test('contractor enters project and sees loaded home', async ({ page }) => {
    test.setTimeout(240_000);
    await enterRoleAndOpenProject(page, 'contractor');
  });
});
