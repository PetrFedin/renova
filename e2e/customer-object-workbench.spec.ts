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
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
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
  test(`object rooms @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/object', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Ванная', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `test-results/object-rooms-${viewport.name}.png`, fullPage: true });
  });

  test(`room detail @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/object', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Ванная', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByText('Ванная', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/room\//, { timeout: 10_000 });
    await expect(page.locator('body')).not.toContainText(/Загрузка|Загружаем/i, { timeout: 15_000 });
    await page.screenshot({ path: `test-results/room-detail-${viewport.name}.png`, fullPage: true });
  });

  test(`estimate @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/object?tab=estimate', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Итого по смете', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `test-results/object-estimate-${viewport.name}.png`, fullPage: true });
  });
}
