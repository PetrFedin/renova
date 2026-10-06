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

for (const viewport of VIEWPORTS) {
  test(`customer home is usable at ${viewport.name} ${viewport.width}x${viewport.height}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need API :8100 and web :8081');

    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    const customer = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })
    ).json()) as DemoUser;
    const projects = (await (
      await request.get(`${API}/api/v1/projects`, { headers: authHeaders(customer) })
    ).json()) as DemoProject[];
    const project = pickPrimaryDemoProject(projects);
    expect(project?.id, 'Demo customer must have a project').toBeTruthy();

    await seedDemoCustomerSession(page, customer.id, project.id, customer.access_token);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Unhandled Runtime Error|Something went wrong|Application error|Cannot read properties of/i);
    await expect(page.locator('body')).toContainText('RENOVA', { timeout: 15_000 });
    await expect(page.locator('body')).toContainText(/Демо-квартира|Квартира/i, { timeout: 15_000 });

    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    }));

    expect(layout.scrollWidth, `${viewport.name}: document horizontal overflow`).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.bodyWidth, `${viewport.name}: body horizontal overflow`).toBeLessThanOrEqual(layout.viewport + 1);
    expect(pageErrors, `${viewport.name}: uncaught browser exceptions`).toEqual([]);

    await page.screenshot({
      path: `test-results/customer-home-${viewport.name}.png`,
      fullPage: true,
    });
  });
}
