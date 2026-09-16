import { test, expect, type Page } from '@playwright/test';

const REVIEW_BASE = process.env.RENOVA_REVIEW_BASE_URL?.replace(/\/$/, '') || 'https://renova-review-full.onrender.com';
const API_HOST = 'renova-review-full-api.onrender.com';
const requestedBrowser = process.env.RENOVA_REVIEW_BROWSER;
if (requestedBrowser === 'chromium' || requestedBrowser === 'webkit' || requestedBrowser === 'firefox') {
  test.use({ browserName: requestedBrowser });
}

type Role = 'customer' | 'contractor';

async function enterRole(page: Page, role: Role) {
  await page.goto(`${REVIEW_BASE}/?review_capabilities=${role}-${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await expect(page.getByTestId('review-role-screen')).toBeVisible({ timeout: 60_000 });
  const auth = page.waitForResponse(
    (response) => response.url().includes('/api/v1/auth/demo') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId(`review-role-${role}`).click();
  expect((await auth).status()).toBe(200);
  await expect(page.getByText('Выберите объект', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByText(/Квартира|Дом/).first().click();
  await expect(page.getByTestId('os-home-ready')).toBeVisible({ timeout: 120_000 });
}

async function goHome(page: Page) {
  const home = page.getByRole('button', { name: 'Главная', exact: true }).first();
  if (await home.isVisible().catch(() => false)) {
    await home.click();
  } else {
    await page.goBack({ waitUntil: 'domcontentloaded' });
  }
  await expect(page.getByTestId('os-home-ready')).toBeVisible({ timeout: 60_000 });
}

async function openHomeSummary(page: Page) {
  const toggle = page.getByRole('button', { name: 'Раскрыть: Сводка' }).first();
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await toggle.click();
}

function watchServerErrors(page: Page) {
  const errors: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes(API_HOST) && response.status() >= 500) {
      errors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  return errors;
}

test.describe('deployed review surfaced capabilities', () => {
  test('customer: management, schedule, supervision, warranty and budget planner are discoverable', async ({ page }) => {
    test.setTimeout(420_000);
    const serverErrors = watchServerErrors(page);
    await enterRole(page, 'customer');

    await expect(page.getByRole('button', { name: 'График и сроки' })).toBeVisible();
    await page.getByRole('button', { name: 'График и сроки' }).click();
    await expect(page).toHaveURL(/calendar/, { timeout: 30_000 });
    await goHome(page);

    await expect(page.getByRole('button', { name: 'Технадзор и контроль качества' })).toBeVisible();
    await page.getByRole('button', { name: 'Технадзор и контроль качества' }).click();
    await expect(page.getByText('Технический надзор', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Демо · Технический надзор Renova', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Гарантия/).first()).toBeVisible({ timeout: 30_000 });
    await goHome(page);

    await openHomeSummary(page);
    await expect(page.getByRole('button', { name: 'Управленческая сводка' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отчёты' })).toBeVisible();
    await page.getByRole('button', { name: 'Управленческая сводка' }).click();
    await expect(page.getByText('Управленческая сводка', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('os-home-ready')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Деньги', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Планировщик бюджета' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Планировщик бюджета' }).click();
    await expect(page.getByText('Планировщик бюджета', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    expect(serverErrors, '5xx responses from canonical review API').toEqual([]);
  });

  test('contractor: portfolio, reports, schedule, control and market estimate are discoverable', async ({ page }) => {
    test.setTimeout(420_000);
    const serverErrors = watchServerErrors(page);
    await enterRole(page, 'contractor');

    await expect(page.getByRole('button', { name: 'График и сроки' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Контроль качества' })).toBeVisible();

    await openHomeSummary(page);
    await expect(page.getByRole('button', { name: 'Управленческая сводка' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отчёты' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Портфель объектов' })).toBeVisible();
    await page.getByRole('button', { name: 'Портфель объектов' }).click();
    await expect(page.getByText(/Портфель/).first()).toBeVisible({ timeout: 30_000 });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('os-home-ready')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Бюджет', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Рыночная оценка' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Рыночная оценка' }).click();
    await expect(page.getByText('Планировщик бюджета', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    expect(serverErrors, '5xx responses from canonical review API').toEqual([]);
  });
});
