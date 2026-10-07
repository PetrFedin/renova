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
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
] as const) {
  test(`KPI grid density @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(page, request);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const grid = page.getByTestId('os-widget-grid').first();
    await expect(grid).toBeVisible({ timeout: 15_000 });

    const gridBox = await grid.boundingBox();
    expect(gridBox).not.toBeNull();
    const cells = grid.getByTestId('os-widget-cell');
    const count = await cells.count();
    expect(count).toBeGreaterThan(0);

    const boxes = [];
    for (let i = 0; i < count; i += 1) {
      const box = await cells.nth(i).boundingBox();
      if (box) boxes.push(box);
    }
    expect(boxes.length).toBeGreaterThan(0);
    const firstRowY = Math.round(boxes[0].y);
    const firstRowCount = boxes.filter((b) => Math.abs(Math.round(b.y) - firstRowY) <= 2).length;

    if (gridBox!.width >= 900 && count >= 4) expect(firstRowCount).toBe(4);
    else if (gridBox!.width >= 620 && count >= 3) expect(firstRowCount).toBe(3);
    else if (count >= 2) expect(firstRowCount).toBe(2);

    for (const box of boxes) {
      expect(box.width).toBeGreaterThan(110);
    }

    await page.screenshot({ path: `test-results/kpi-density-${viewport.name}.png`, fullPage: true });
  });
}
