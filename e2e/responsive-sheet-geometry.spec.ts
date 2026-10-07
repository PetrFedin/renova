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
  test(`KPI sheet geometry @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const kpi = page.getByTestId('os-widget-cell').first();
    await expect(kpi).toBeVisible({ timeout: 15_000 });
    await kpi.click();
    const panel = page.getByTestId('home-kpi-detail-sheet');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(680.5);
    expect(box!.width).toBeLessThan(viewport.width * 0.9);
    await page.screenshot({ path: `test-results/sheet-kpi-${viewport.name}.png`, fullPage: true });
  });

  test(`Create room sheet geometry @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/object', { waitUntil: 'domcontentloaded' });

    const addRoom = page.getByRole('button', { name: 'Запросить новую комнату' });
    await expect(addRoom).toBeVisible({ timeout: 15_000 });
    await addRoom.click();
    const panel = page.getByTestId('sheet-surface-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(720.5);
    expect(box!.width).toBeLessThan(viewport.width * 0.9);
    await page.screenshot({ path: `test-results/sheet-room-${viewport.name}.png`, fullPage: true });
  });

  test(`Payment detail sheet geometry @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/budget?tab=payments', { waitUntil: 'domcontentloaded' });

    const firstPayment = page.locator('[aria-label^="Открыть счёт"]').first();
    await expect(firstPayment).toBeVisible({ timeout: 15_000 });
    await firstPayment.click();
    const panel = page.getByTestId('sheet-surface-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(760.5);
    expect(box!.width).toBeLessThan(viewport.width * 0.92);
    await page.screenshot({ path: `test-results/sheet-payment-${viewport.name}.png`, fullPage: true });
  });
}
