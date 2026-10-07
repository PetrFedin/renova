import { expect, test } from '@playwright/test';

import {
  API,
  apiReachable,
  authHeaders,
  pickPrimaryDemoProject,
  seedDemoCustomerSession,
  webReachable,
  type DemoProject,
  type DemoUser,
} from './helpers';

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, side: false },
  { name: 'tablet', width: 834, height: 1112, side: true },
  { name: 'desktop', width: 1440, height: 900, side: true },
] as const;

async function seed(page: any, request: any) {
  const customer = (await (
    await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })
  ).json()) as DemoUser;
  const projects = (await (
    await request.get(`${API}/api/v1/projects`, { headers: authHeaders(customer) })
  ).json()) as DemoProject[];
  const project = pickPrimaryDemoProject(projects);
  expect(project?.id).toBeTruthy();
  await seedDemoCustomerSession(page, customer.id, project.id, customer.access_token);
}

for (const viewport of VIEWPORTS) {
  test(`responsive shell @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/object', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Комнаты', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: `test-results/responsive-shell-${viewport.name}.png`, fullPage: true });

    if (viewport.side) {
      await expect(page.getByTestId('os-side-nav')).toBeVisible();
      await expect(page.getByTestId('os-bottom-nav')).toHaveCount(0);
      const side = await page.getByTestId('os-side-nav').boundingBox();
      expect(side).not.toBeNull();
      expect(side!.x).toBeLessThan(330);
      expect(side!.height).toBeGreaterThan(500);

      const before = side!.width;
      await page.getByTestId('os-side-nav-toggle').click();
      const afterBox = await page.getByTestId('os-side-nav').boundingBox();
      expect(afterBox).not.toBeNull();
      expect(Math.abs(afterBox!.width - before)).toBeGreaterThan(80);
      await page.screenshot({ path: `test-results/responsive-shell-${viewport.name}-toggled.png`, fullPage: true });
    } else {
      await expect(page.getByTestId('os-bottom-nav')).toBeVisible();
      await expect(page.getByTestId('os-side-nav')).toHaveCount(0);
      const bottom = await page.getByTestId('os-bottom-nav').boundingBox();
      expect(bottom).not.toBeNull();
      expect(bottom!.y).toBeGreaterThan(viewport.height - 130);
    }

    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport + 1);

  });

  test(`responsive buttons @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/object', { waitUntil: 'domcontentloaded' });
    const action = page.getByRole('button', { name: 'Запросить новую комнату' });
    await expect(action).toBeVisible({ timeout: 15_000 });
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    if (viewport.side) {
      expect(box!.width).toBeLessThanOrEqual(440);
      expect(box!.width).toBeLessThan(viewport.width * 0.7);
    } else {
      expect(box!.width).toBeGreaterThan(viewport.width * 0.75);
    }
  });
}


for (const viewport of VIEWPORTS.filter((item) => item.side)) {
  test(`detail routes keep side navigation @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);

    await page.goto('/object', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Ванная', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByText('Ванная', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/room\//, { timeout: 10_000 });
    await expect(page.getByTestId('os-side-nav')).toBeVisible();
    await expect(page.getByTestId('os-dock-object-active')).toBeVisible();
    await expect(page.getByText('Контур комнаты', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `test-results/responsive-room-${viewport.name}.png`, fullPage: true });

    await page.goto('/repair', { waitUntil: 'domcontentloaded' });
    const firstStage = page.getByRole('button', { name: /^Открыть этап / }).first();
    await expect(firstStage).toBeVisible({ timeout: 15_000 });
    await firstStage.click();
    await expect(page).toHaveURL(/\/stage\//, { timeout: 10_000 });
    await expect(page.getByTestId('os-side-nav')).toBeVisible();
    await expect(page.getByTestId('os-dock-repair-active')).toBeVisible();
    await expect(page.getByText('Контекст этапа', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `test-results/responsive-stage-${viewport.name}.png`, fullPage: true });

    await page.goto('/documents', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('os-side-nav')).toBeVisible();
    await expect(page.getByTestId('os-side-nav').locator('[data-testid$="-active"]')).toHaveCount(0);
    await expect(page.getByText('Документы', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Сначала зафиксируйте смету', { exact: true })).toBeVisible({ timeout: 15_000 });
    const cta = page.getByRole('button', { name: 'К смете' });
    const ctaBox = await cta.boundingBox();
    expect(ctaBox).not.toBeNull();
    expect(ctaBox!.width).toBeLessThanOrEqual(440);

    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport + 1);
    await page.screenshot({ path: `test-results/responsive-documents-${viewport.name}.png`, fullPage: true });
  });
}
