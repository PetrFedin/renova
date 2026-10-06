import { expect, test } from '@playwright/test';

import {
  API,
  apiReachable,
  authHeaders,
  pickPrimaryDemoProject,
  seedDemoContractorSession,
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
  const contractor = (await (
    await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })
  ).json()) as DemoUser;
  const projects = (await (
    await request.get(`${API}/api/v1/projects`, { headers: authHeaders(contractor) })
  ).json()) as DemoProject[];
  const project = pickPrimaryDemoProject(projects);
  expect(project?.id, 'Demo contractor must have a project').toBeTruthy();
  await seedDemoContractorSession(page, contractor.id, project.id, contractor.access_token);
}

const SURFACES = [
  { name: 'home', path: '/', marker: /Демо-квартира|Квартира/i },
  { name: 'object', path: '/object', marker: /Комнаты|Смета/i },
  { name: 'repair', path: '/repair', marker: /Этапы/i },
  { name: 'budget', path: '/budget', marker: /План-факт|Бюджет/i },
] as const;

for (const viewport of VIEWPORTS) {
  for (const surface of SURFACES) {
    test(`contractor ${surface.name} @ ${viewport.name}`, async ({ page, request }) => {
      test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seed(page, request);

      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      const response = await page.goto(surface.path, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator('body')).toContainText('RENOVA', { timeout: 15_000 });
      await expect(page.locator('body')).toContainText(surface.marker, { timeout: 15_000 });
      await expect(page.locator('body')).not.toContainText(/Unhandled Runtime Error|Something went wrong|Application error|Cannot read properties of/i);

      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
      expect(errors).toEqual([]);

      await page.screenshot({
        path: `test-results/contractor-${surface.name}-${viewport.name}.png`,
        fullPage: true,
      });
    });
  }
}
