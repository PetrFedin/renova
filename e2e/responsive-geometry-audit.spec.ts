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

const VIEWPORTS = [
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`side navigation preference survives navigation @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/object', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('os-side-nav')).toBeVisible({ timeout: 15_000 });

    const before = await page.getByTestId('os-side-nav').boundingBox();
    expect(before).not.toBeNull();
    await page.getByTestId('os-side-nav-toggle').click();
    const toggled = await page.getByTestId('os-side-nav').boundingBox();
    expect(toggled).not.toBeNull();
    expect(Math.abs(toggled!.width - before!.width)).toBeGreaterThan(80);

    await page.getByRole('button', { name: 'Ремонт' }).first().click();
    await expect(page).toHaveURL(/\/repair/);
    const afterNav = await page.getByTestId('os-side-nav').boundingBox();
    expect(afterNav).not.toBeNull();
    expect(Math.abs(afterNav!.width - toggled!.width)).toBeLessThanOrEqual(1);
  });

  for (const route of [
    { name: 'home', path: '/' },
    { name: 'object', path: '/object' },
    { name: 'repair', path: '/repair' },
    { name: 'budget', path: '/budget' },
    { name: 'chat', path: '/chat' },
  ] as const) {
    test(`primary CTA geometry ${route.name} @ ${viewport.name}`, async ({ page, request }) => {
      test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seed(page, request);
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('body')).toContainText('RENOVA', { timeout: 15_000 });
      await page.waitForTimeout(500);

      const buttons = page.getByTestId('renova-primary-button');
      const count = await buttons.count();
      for (let i = 0; i < count; i += 1) {
        const box = await buttons.nth(i).boundingBox();
        if (!box) continue;
        expect(box.width, `${route.name} CTA ${i} is too wide`).toBeLessThanOrEqual(440.5);
        expect(box.height, `${route.name} CTA ${i} touch height`).toBeGreaterThanOrEqual(40);
      }
    });
  }

  test(`navigation target geometry @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/object', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Комнаты', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    const logo = await page.getByRole('button', { name: 'Renova — на главную' }).boundingBox();
    expect(logo).not.toBeNull();
    expect(logo!.height).toBeGreaterThanOrEqual(40);

    const tabs = page.getByRole('tab');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(0);
    for (let i = 0; i < tabCount; i += 1) {
      const box = await tabs.nth(i).boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }

    const railItems = page.locator('[data-testid^="os-dock-"]');
    const railCount = await railItems.count();
    expect(railCount).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < railCount; i += 1) {
      const box = await railItems.nth(i).boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
}
