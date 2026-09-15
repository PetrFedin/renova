import { test, expect, type Page } from '@playwright/test';

const REVIEW_BASE = process.env.RENOVA_REVIEW_BASE_URL?.replace(/\/$/, '') || 'https://renova-review-full.onrender.com';
const requestedBrowser = process.env.RENOVA_REVIEW_BROWSER;
if (requestedBrowser === 'chromium' || requestedBrowser === 'webkit' || requestedBrowser === 'firefox') {
  test.use({ browserName: requestedBrowser });
}

async function enterRoleAndOpenProject(page: Page, role: 'customer' | 'contractor', projectIndex: number) {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });

  await page.goto(`${REVIEW_BASE}/?review_smoke=${role}-${projectIndex}-${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
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
  const projectMetas = page.getByText(/Квартира|Дом/);
  const projectCount = await projectMetas.count();
  expect(projectCount, `${role} should expose both canonical demo objects`).toBeGreaterThanOrEqual(2);
  expect(projectIndex, 'project index must exist').toBeLessThan(projectCount);

  const selectedProjectMeta = projectMetas.nth(projectIndex);
  await expect(selectedProjectMeta).toBeVisible({ timeout: 60_000 });

  const projectResponsePromise = page.waitForResponse(
    (response) => /\/api\/v1\/projects\/[0-9a-f-]{36}$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET',
    { timeout: 90_000 },
  );
  await selectedProjectMeta.click();
  const projectResponse = await projectResponsePromise;
  expect(projectResponse.status(), `project load failed for ${role} project ${projectIndex}: ${await projectResponse.text()}`).toBe(200);

  try {
    await expect(page.getByTestId('os-home-ready')).toBeVisible({ timeout: 120_000 });
  } catch (error) {
    const bodyText = (await page.locator('body').innerText()).slice(0, 5000);
    throw new Error([
      `home did not become ready for ${role} project ${projectIndex}`,
      `URL: ${page.url()}`,
      `Failed responses: ${failedResponses.join(' | ') || 'none'}`,
      `Console errors: ${consoleErrors.join(' | ') || 'none'}`,
      `Body: ${bodyText}`,
      `Original: ${error instanceof Error ? error.message : String(error)}`,
    ].join('\n'));
  }

  await expect(page.getByTestId('os-home-error')).toHaveCount(0);
  await expect(page.getByText('Не удалось загрузить главную', { exact: true })).toHaveCount(0);

  const fatalConsoleErrors = consoleErrors.filter((message) =>
    /uncaught|unhandled|referenceerror|typeerror|syntaxerror/i.test(message),
  );
  expect(fatalConsoleErrors, `fatal browser console errors for ${role} project ${projectIndex}`).toEqual([]);
}

test.describe('deployed review role and project entry', () => {
  test.describe.configure({ mode: 'serial' });

  for (const role of ['customer', 'contractor'] as const) {
    for (const projectIndex of [0, 1]) {
      test(`${role} opens demo project ${projectIndex + 1} and sees loaded home`, async ({ page }) => {
        test.setTimeout(300_000);
        await enterRoleAndOpenProject(page, role, projectIndex);
      });
    }
  }
});
