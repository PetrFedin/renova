import { test, expect, type Page } from '@playwright/test';

const REVIEW_BASE = process.env.RENOVA_REVIEW_BASE_URL?.replace(/\/$/, '') || 'https://renova-review-full.onrender.com';
const requestedBrowser = process.env.RENOVA_REVIEW_BROWSER;
if (requestedBrowser === 'chromium' || requestedBrowser === 'webkit' || requestedBrowser === 'firefox') {
  test.use({ browserName: requestedBrowser });
}

type Role = 'customer' | 'contractor';

type BrowserEvidence = {
  fatalConsoleErrors: string[];
  serverErrors: string[];
};

function watchBrowser(page: Page): BrowserEvidence {
  const evidence: BrowserEvidence = { fatalConsoleErrors: [], serverErrors: [] };
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/uncaught|unhandled|referenceerror|typeerror|syntaxerror/i.test(text)) {
      evidence.fatalConsoleErrors.push(text);
    }
  });
  page.on('response', (response) => {
    if (response.status() < 500) return;
    if (!response.url().includes('renova-review-fast-api.onrender.com')) return;
    evidence.serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return evidence;
}

async function settle(page: Page, ms = 650) {
  await page.waitForTimeout(ms);
  await expect(page.getByText('Не удалось загрузить главную', { exact: true })).toHaveCount(0);
}

async function enterRoleAndProject(page: Page, role: Role, projectIndex = 0) {
  await page.goto(`${REVIEW_BASE}/?review_product=${role}-${projectIndex}-${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await expect(page.getByTestId('review-role-screen')).toBeVisible({ timeout: 60_000 });

  const authResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/auth/demo') && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByTestId(`review-role-${role}`).click();
  expect((await authResponsePromise).status()).toBe(200);

  await expect(page.getByText('Выберите объект', { exact: true })).toBeVisible({ timeout: 60_000 });
  const projects = page.getByText(/Квартира|Дом/);
  await expect(projects.nth(projectIndex)).toBeVisible({ timeout: 60_000 });
  await projects.nth(projectIndex).click();
  await expect(page.getByTestId('os-home-ready')).toBeVisible({ timeout: 120_000 });
}

async function clickButton(page: Page, name: string | RegExp) {
  const button = page.getByRole('button', { name }).first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
  await settle(page);
}

async function clickTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true });
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await settle(page);
}

async function clickOptionalDock(page: Page, label: string | RegExp): Promise<boolean> {
  const button = page.getByRole('button', { name: label }).first();
  if (!(await button.count())) return false;
  if (!(await button.isVisible().catch(() => false))) return false;
  await button.click();
  await settle(page);
  return true;
}

async function returnHome(page: Page) {
  const home = page.getByRole('button', { name: 'Главная', exact: true }).first();
  if (await home.isVisible().catch(() => false)) {
    await home.click();
    await expect(page.getByTestId('os-home-ready')).toBeVisible({ timeout: 60_000 });
    return;
  }
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('os-home-ready')).toBeVisible({ timeout: 60_000 });
}

async function assertEvidence(evidence: BrowserEvidence) {
  expect(evidence.fatalConsoleErrors, 'fatal browser console errors').toEqual([]);
  expect(evidence.serverErrors, '5xx responses from review API').toEqual([]);
}

async function openMore(page: Page) {
  const more = page.getByRole('button', { name: /^Ещё/ }).first();
  await expect(more).toBeVisible({ timeout: 30_000 });
  await more.click();
  await expect(page.getByText('Ещё', { exact: true })).toBeVisible();
}

async function closeOverlayByLabelOrBackdrop(page: Page, label: string, fallbackY = 300) {
  const labeled = page.getByLabel(label).first();
  if (await labeled.isVisible().catch(() => false)) {
    await labeled.click();
  } else {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(150);
    if (await page.getByText('Объекты', { exact: true }).first().isVisible().catch(() => false)) {
      await page.mouse.click(8, fallbackY);
    }
  }
  await settle(page, 250);
}

async function closeSearch(page: Page) {
  const semanticClose = page.getByRole('button', { name: 'Закрыть поиск' }).first();
  if (await semanticClose.isVisible().catch(() => false)) {
    await semanticClose.click();
  } else {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(150);
    if (await page.getByPlaceholder(/Поиск/).isVisible().catch(() => false)) {
      const viewport = page.viewportSize();
      await page.mouse.click((viewport?.width ?? 1280) / 2, 66);
    }
  }
  await expect(page.getByPlaceholder(/Поиск/)).toHaveCount(0, { timeout: 10_000 });
  await settle(page, 250);
}

async function openQuickFab(page: Page) {
  await clickButton(page, 'Быстрые действия');
  await expect(page.getByText('Создать', { exact: true })).toBeVisible();
}

async function testQuickActions(page: Page, role: Role) {
  await openQuickFab(page);
  await expect(page.getByText('Расход', { exact: true })).toBeVisible();
  await expect(page.getByText('Сообщение', { exact: true })).toBeVisible();
  if (role === 'contractor') {
    await expect(page.getByText('Работа', { exact: true })).toBeVisible();
  }
  await page.getByText('Расход', { exact: true }).click();
  await expect(page.getByText('Добавить расход', { exact: true })).toBeVisible();
  await expect(page.getByText('Скан чека', { exact: true })).toBeVisible();
  await expect(page.getByText('Вручную', { exact: true })).toBeVisible();
  await page.getByText('Отмена', { exact: true }).last().click();

  await openQuickFab(page);
  await page.getByText('Сообщение', { exact: true }).click();
  await expect(page.getByText('Создать чат', { exact: true })).toBeVisible();
  await expect(page.getByText('Все чаты', { exact: true })).toBeVisible();
  await page.getByText('Отмена', { exact: true }).last().click();

  if (role === 'contractor') {
    await openQuickFab(page);
    await page.getByText('Работа', { exact: true }).click();
    await expect(page.getByText('Новая работа', { exact: true })).toBeVisible();
    await expect(page.getByText('Заполнение', { exact: true })).toBeVisible();
    await expect(page.getByText('Калькулятор', { exact: true })).toBeVisible();
    await page.getByText('Отмена', { exact: true }).last().click();
  }
}

async function testObjectHub(page: Page) {
  await clickTab(page, 'Комнаты');
  await clickTab(page, 'Смета');
  const all = page.getByRole('button', { name: 'Все вкладки' });
  if (await all.isVisible().catch(() => false)) await all.click();
  await clickTab(page, 'План');
  await clickTab(page, 'Данные');
}

async function testRepairHub(page: Page) {
  await clickTab(page, 'Этапы');
  await clickTab(page, 'Приёмка');
  const all = page.getByRole('button', { name: 'Все вкладки' });
  if (await all.isVisible().catch(() => false)) await all.click();
  await clickTab(page, 'Материалы');
  await clickTab(page, 'Подбор');
}

async function testBudgetHub(page: Page) {
  await clickTab(page, 'План–факт');
  await clickTab(page, 'Оплаты');
  const all = page.getByRole('button', { name: 'Все вкладки' });
  if (await all.isVisible().catch(() => false)) await all.click();
  await clickTab(page, 'Расходы');
  await clickTab(page, 'Отклонения');
}

test.describe('deployed review product controls', () => {
  for (const role of ['customer', 'contractor'] as const) {
    test(`${role}: shell controls, dock, header and quick actions`, async ({ page }) => {
      test.setTimeout(360_000);
      const evidence = watchBrowser(page);
      await enterRoleAndProject(page, role, 0);

      await clickButton(page, /^Сообщения/);
      await expect(page.getByText('Сообщения', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await returnHome(page);

      await clickButton(page, /^Проект:/);
      await expect(page.getByText('Объекты', { exact: true }).first()).toBeVisible();
      await closeOverlayByLabelOrBackdrop(page, 'Закрыть');

      await clickButton(page, 'Профиль');
      await settle(page);
      await returnHome(page);

      await openMore(page);
      await expect(page.getByText('Документы проекта', { exact: true })).toBeVisible();
      await expect(page.getByText('Входящие', { exact: true })).toBeVisible();
      await expect(page.getByText('История проекта', { exact: true })).toBeVisible();
      if (role === 'customer') {
        await expect(page.getByText('Согласования', { exact: true })).toBeVisible();
      }
      await page.keyboard.press('Escape').catch(() => undefined);
      if (await page.getByText('Ещё', { exact: true }).isVisible().catch(() => false)) {
        await page.mouse.click(8, 300);
      }

      if (role === 'contractor') {
        await clickButton(page, /^Поиск/);
        await expect(page.getByPlaceholder(/Поиск/)).toBeVisible();
        await closeSearch(page);
      }

      await testQuickActions(page, role);

      const dockCandidates: Array<string | RegExp> = [
        'Объект',
        'Ремонт',
        role === 'customer' ? 'Деньги' : 'Бюджет',
        'Сроки',
        'Смета',
        'Исполнитель',
      ];
      for (const label of dockCandidates) {
        const opened = await clickOptionalDock(page, label);
        if (opened) await returnHome(page);
      }

      await assertEvidence(evidence);
    });

    test(`${role}: object, repair and budget hub tabs are interactive`, async ({ page }) => {
      test.setTimeout(420_000);
      const evidence = watchBrowser(page);
      await enterRoleAndProject(page, role, 0);

      await clickButton(page, 'Объект');
      await testObjectHub(page);
      await returnHome(page);

      if (await clickOptionalDock(page, 'Ремонт')) {
        await testRepairHub(page);
        await returnHome(page);
      }
      if (await clickOptionalDock(page, role === 'customer' ? 'Деньги' : 'Бюджет')) {
        await testBudgetHub(page);
        await returnHome(page);
      }

      await assertEvidence(evidence);
    });
  }
});
