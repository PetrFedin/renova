import { expect, test } from '@playwright/test';
import {
  API, apiReachable, authHeaders, pickPrimaryDemoProject,
  seedDemoCustomerSession, seedDemoContractorSession, webReachable,
  type DemoProject, type DemoUser,
} from './helpers';

async function demo(request: any, role: 'customer' | 'contractor') {
  const user = (await (
    await request.post(`${API}/api/v1/auth/demo`, { data: { role } })
  ).json()) as DemoUser;
  const projects = (await (
    await request.get(`${API}/api/v1/projects`, { headers: authHeaders(user) })
  ).json()) as DemoProject[];
  const project = pickPrimaryDemoProject(projects);
  expect(project?.id).toBeTruthy();
  return { user, project };
}

async function seed(page: any, request: any, role: 'customer' | 'contractor') {
  const { user, project } = await demo(request, role);
  if (role === 'customer') {
    await seedDemoCustomerSession(page, user.id, project.id, user.access_token);
  } else {
    await seedDemoContractorSession(page, user.id, project.id, user.access_token);
  }
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844, expectedFirstRow: 1 },
  { name: 'tablet', width: 834, height: 1112, expectedFirstRow: 2 },
  { name: 'desktop', width: 1440, height: 900, expectedFirstRow: 3 },
] as const) {
  for (const role of ['customer', 'contractor'] as const) {
    test(`room grid ${role} @ ${viewport.name}`, async ({ page, request }) => {
      test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seed(page, request, role);
      await page.goto('/object', { waitUntil: 'domcontentloaded' });

      const rooms = page.locator('[aria-label^="Открыть комнату "]');
      await expect(rooms.first()).toBeVisible({ timeout: 15_000 });
      const count = await rooms.count();
      expect(count).toBeGreaterThanOrEqual(3);

      const boxes = [];
      for (let i = 0; i < Math.min(count, 3); i += 1) {
        const box = await rooms.nth(i).boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box!);
      }

      const firstY = Math.round(boxes[0].y);
      const firstRow = boxes.filter((box) => Math.abs(Math.round(box.y) - firstY) <= 2).length;
      expect(firstRow).toBe(viewport.expectedFirstRow);

      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport + 1);

      await page.screenshot({
        path: `test-results/room-grid-${role}-${viewport.name}.png`,
        fullPage: true,
      });
    });
  }
}
