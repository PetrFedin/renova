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
  { name: 'phone', width: 390, height: 844, wide: false },
  { name: 'tablet', width: 834, height: 1112, wide: true },
  { name: 'desktop', width: 1440, height: 900, wide: true },
] as const) {
  test(`payment list responsive table @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/budget?tab=payments', { waitUntil: 'domcontentloaded' });

    const rows = page.locator('[aria-label^="Открыть счёт"]');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(2);

    if (viewport.wide) {
      await expect(page.getByTestId('payment-table-header')).toBeVisible();

      const title = await rows.first().getByTestId('payment-title-cell').boundingBox();
      const type = await rows.first().getByTestId('payment-type-cell').boundingBox();
      const amount = await rows.first().getByTestId('payment-amount-cell').boundingBox();
      const status = await rows.first().getByTestId('payment-status-cell').boundingBox();
      expect(title && type && amount && status).toBeTruthy();
      expect(title!.x).toBeLessThan(type!.x);
      expect(type!.x).toBeLessThan(amount!.x);
      expect(amount!.x).toBeLessThan(status!.x);
      expect(status!.x + status!.width).toBeLessThanOrEqual(viewport.width + 1);
    } else {
      await expect(page.getByTestId('payment-table-header')).toHaveCount(0);
      await expect(rows.first().getByTestId('payment-title-cell')).toHaveCount(0);
    }

    await rows.first().click();
    await expect(page.getByLabel('Детали счёта')).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: `test-results/payment-table-${viewport.name}.png`,
      fullPage: true,
    });
  });
}
