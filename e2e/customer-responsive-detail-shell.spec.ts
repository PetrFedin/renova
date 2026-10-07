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

for (const viewport of [
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
] as const) {
  test(`room detail keeps object rail @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/object', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Ванная', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByText('Ванная', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/room\//, { timeout: 10_000 });
    await expect(page.getByText('Контур комнаты', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Загрузка комнаты…', { exact: true })).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('os-side-nav')).toHaveCount(1);
    await expect(page.getByTestId('os-dock-object-active')).toBeVisible();
    await page.screenshot({ path: `test-results/detail-room-${viewport.name}.png`, fullPage: true });
  });

  test(`stage detail keeps repair rail @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/repair', { waitUntil: 'domcontentloaded' });
    const firstStage = page.getByRole('button', { name: /^Открыть этап / }).first();
    await expect(firstStage).toBeVisible({ timeout: 15_000 });
    await firstStage.click();
    await expect(page).toHaveURL(/\/stage\//, { timeout: 10_000 });
    await expect(page.getByText('Контекст этапа', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Загрузка…', { exact: true })).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('os-side-nav')).toHaveCount(1);
    await expect(page.getByTestId('os-dock-repair-active')).toBeVisible();
    await page.screenshot({ path: `test-results/detail-stage-${viewport.name}.png`, fullPage: true });
  });

  test(`documents keeps rail without false home active @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/documents', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Документы', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/Сначала зафиксируйте смету|Единый индекс|Документы проекта/i, { timeout: 15_000 });
    await expect(page.locator('body')).not.toContainText('Нет проектов', { timeout: 15_000 });
    await expect(page.getByTestId('os-side-nav')).toHaveCount(1);
    await expect(page.getByTestId(/os-dock-.*-active/)).toHaveCount(0);
    await page.screenshot({ path: `test-results/detail-documents-${viewport.name}.png`, fullPage: true });
  });
}

test('phone detail routes do not get desktop rail', async ({ page, request }) => {
  test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, request);
  await page.goto('/documents', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Документы', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('os-side-nav')).toHaveCount(0);
});
