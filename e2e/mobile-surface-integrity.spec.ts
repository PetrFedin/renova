import { test, expect, type Page } from '@playwright/test';

import { RENOVA_ROUTES } from '../apps/mobile/lib/routeRegistry';
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

const CUSTOMER_SURFACES = RENOVA_ROUTES.filter((route) => {
  if (route.status === 'wip') return false;
  if (route.audience === 'contractor') return false;
  if (route.path.includes('[')) return false;
  if (route.id === 'portal') return false;
  return true;
});

function browserPath(path: string): string {
  if (path === '/index') return '/';
  return path;
}

async function assertNoDeadInteractions(page: Page, routeId: string): Promise<void> {
  const emptyControls = await page.locator('button:visible, [role="button"]:visible, a:visible').evaluateAll((nodes) =>
    nodes.flatMap((node, index) => {
      const element = node as HTMLElement;
      const tag = element.tagName.toLowerCase();
      const label = (
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.innerText ||
        (tag === 'a' ? element.getAttribute('href') : '') ||
        ''
      ).trim();
      const rect = element.getBoundingClientRect();
      const reasons: string[] = [];
      if (!label) reasons.push('missing accessible name');
      if (rect.width <= 0 || rect.height <= 0) reasons.push('zero-sized interactive control');
      if (tag === 'a') {
        const href = (element.getAttribute('href') || '').trim().toLowerCase();
        if (!href || href === '#' || href.startsWith('javascript:')) reasons.push(`invalid href: ${href || '<empty>'}`);
      }
      return reasons.length ? [{ index, tag, label, reasons }] : [];
    }),
  );

  expect(emptyControls, `${routeId}: dead or inaccessible controls`).toEqual([]);
}

for (const route of CUSTOMER_SURFACES) {
  test(`customer surface ${route.id} renders without dead controls`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need API :8100 and web :8081');

    const customer = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })
    ).json()) as DemoUser;
    const projects = (await (
      await request.get(`${API}/api/v1/projects`, { headers: authHeaders(customer) })
    ).json()) as DemoProject[];
    const project = pickPrimaryDemoProject(projects);
    expect(project?.id, 'Demo customer must have a project for full-surface smoke').toBeTruthy();

    await seedDemoCustomerSession(page, customer.id, project.id, customer.access_token);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const response = await page.goto(browserPath(route.path), { waitUntil: 'domcontentloaded' });
    expect(response, `${route.id}: navigation did not return a document response`).not.toBeNull();
    expect(response?.status(), `${route.id}: document status`).toBeLessThan(400);

    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Unhandled Runtime Error|Something went wrong|Application error|Cannot read properties of/i);
    await expect(page.locator('body')).not.toContainText(/TODO|заглушка|не реализовано|coming soon/i);

    expect(pageErrors, `${route.id}: uncaught browser exceptions`).toEqual([]);
    await assertNoDeadInteractions(page, route.id);
  });
}
