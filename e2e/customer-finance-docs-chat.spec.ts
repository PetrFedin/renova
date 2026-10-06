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
  test(`payments @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/budget?tab=payments', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Оплаты', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[aria-label^="Открыть счёт"]').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `test-results/payments-${viewport.name}.png`, fullPage: true });
  });

  test(`payment detail @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/budget?tab=payments', { waitUntil: 'domcontentloaded' });
    const firstPayment = page.locator('[aria-label^="Открыть счёт"]').first();
    await expect(firstPayment).toBeVisible({ timeout: 15_000 });
    await firstPayment.click();
    await expect(page.getByLabel('Детали счёта')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `test-results/payment-detail-${viewport.name}.png`, fullPage: true });
  });

  test(`documents @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/documents', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Документы', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/Документы проекта|Нужно подписать|Договор/i, { timeout: 15_000 });
    await page.screenshot({ path: `test-results/documents-${viewport.name}.png`, fullPage: true });
  });

  test(`chat list @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Чаты', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `test-results/chat-list-${viewport.name}.png`, fullPage: true });
  });
}
