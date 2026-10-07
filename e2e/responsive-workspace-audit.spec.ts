import { expect, test } from '@playwright/test';
import {
  API, apiReachable, authHeaders, pickPrimaryDemoProject,
  seedDemoCustomerSession, webReachable,
  type DemoProject, type DemoUser,
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
  test(`estimate workspace @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/object?tab=estimate', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Итого по смете', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `test-results/workspace-estimate-${viewport.name}.png`, fullPage: true });
  });

  test(`stage workspace @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/repair', { waitUntil: 'domcontentloaded' });
    const firstStage = page.getByRole('button', { name: /^Открыть этап / }).first();
    await expect(firstStage).toBeVisible({ timeout: 15_000 });
    await firstStage.click();
    await expect(page.getByText('Контекст этапа', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `test-results/workspace-stage-${viewport.name}.png`, fullPage: true });
  });

  test(`documents workspace @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/documents', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(/Единый индекс|Сначала зафиксируйте смету/i, { timeout: 15_000 });
    await page.screenshot({ path: `test-results/workspace-documents-${viewport.name}.png`, fullPage: true });
  });

  test(`chat workspace @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Чаты', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `test-results/workspace-chat-${viewport.name}.png`, fullPage: true });
  });
}
