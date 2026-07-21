/**
 * P3-W14 — browser UI smoke: /portal и /documents (Expo web :8081).
 * Требует: backend :8100 + mobile web :8081.
 */
import { test, expect } from '@playwright/test';
import { API, pickPrimaryDemoProject, seedDemoCustomerSession, apiReachable, webReachable, authHeaders, DemoUser } from './helpers';

test.describe('P3-W14 Portal + documents UI', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need API :8100 and web :8081');
    await page.goto('/');
  });

  test('portal magic link renders snapshot', async ({ page, request }) => {
    const cust = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json()) as DemoUser;
    const hCust = authHeaders(cust);
    const projects = (await (await request.get(`${API}/api/v1/projects`, { headers: hCust })).json()) as {
      id: string;
      name: string;
    }[];
    const pid = pickPrimaryDemoProject(projects).id;
    const link = (await (
      await request.post(`${API}/api/v1/projects/${pid}/portal-link`, { headers: hCust, data: {} })
    ).json()) as { token: string };

    await page.goto(`/portal?token=${encodeURIComponent(link.token)}`);
    await expect(page.getByText('Renova · портал заказчика')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Расписание').first()).toBeVisible();
  });

  test('documents hub opens after demo session', async ({ page, request }) => {
    const cust = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json()) as DemoUser;
    const hCust = authHeaders(cust);
    const projects = (await (await request.get(`${API}/api/v1/projects`, { headers: hCust })).json()) as {
      id: string;
      name: string;
    }[];
    const pid = pickPrimaryDemoProject(projects).id;
    await seedDemoCustomerSession(page, cust.id, pid, cust.access_token);
    await page.goto('/documents');
    await expect(page.getByText('Документы').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Загрузить документ')).toBeVisible({ timeout: 10_000 });
  });
});
