import { expect, type Page } from '@playwright/test';
import {
  API,
  authHeaders,
  pickPrimaryDemoProject,
  seedDemoContractorSession,
  seedDemoCustomerSession,
  type DemoProject,
  type DemoUser,
} from '../../../../e2e/helpers';

export { API, authHeaders };

export async function openGoldenSurface(
  page: Page,
  request: any,
  role: 'customer' | 'contractor',
  path: string,
): Promise<{ user: DemoUser; project: DemoProject }> {
  const user = (await (
    await request.post(`${API}/api/v1/auth/demo`, { data: { role } })
  ).json()) as DemoUser;
  const projects = (await (
    await request.get(`${API}/api/v1/projects`, { headers: authHeaders(user) })
  ).json()) as DemoProject[];
  const project = pickPrimaryDemoProject(projects);
  expect(project?.id, `${role} must have a seeded project`).toBeTruthy();
  if (role === 'customer') {
    await seedDemoCustomerSession(page, user.id, project.id, user.access_token);
  } else {
    await seedDemoContractorSession(page, user.id, project.id, user.access_token);
  }
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response?.status() ?? 500).toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    /Unhandled Runtime Error|Application error|Cannot read properties of|TODO|заглушка|не реализовано|coming soon/i,
  );
  expect(errors).toEqual([]);
  return { user, project };
}

export async function expectHumanAction(page: Page, pattern: RegExp): Promise<void> {
  const action = page.getByRole('button', { name: pattern }).or(page.getByRole('link', { name: pattern }));
  await expect(action.first(), `Expected human action matching ${pattern}`).toBeVisible();
}
