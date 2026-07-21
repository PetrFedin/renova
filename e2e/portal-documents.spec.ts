/**
 * P3-W13 — portal magic link, documents list, daily report smoke (API E2E).
 */
import { test, expect } from '@playwright/test';
import { API, pickPrimaryDemoProject, type DemoProject, authHeaders, DemoUser } from './helpers';

test.describe('P3-W13 Portal + documents + reports', () => {
  test('portal-link → session + documents + daily report', async ({ request }) => {
    const cust = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json();
    const hCust = authHeaders(cust as DemoUser);

    const projects = (await (await request.get(`${API}/api/v1/projects`, { headers: hCust })).json()) as DemoProject[];
    expect(projects.length).toBeGreaterThan(0);
    const project = pickPrimaryDemoProject(projects);
    const pid = project.id;

    const linkRes = await request.post(`${API}/api/v1/projects/${pid}/portal-link`, {
      headers: hCust,
      data: {},
    });
    expect(linkRes.ok()).toBeTruthy();
    const link = (await linkRes.json()) as { token: string; url: string };
    expect(link.token).toBeTruthy();

    const sessionRes = await request.post(`${API}/api/v1/auth/portal/session`, {
      data: { token: link.token },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = (await sessionRes.json()) as { project_id: string; user_id: string; read_only: boolean };
    expect(session.project_id).toBe(pid);
    expect(session.user_id).toBe(cust.id);
    expect(session.read_only).toBe(true);

    const docsRes = await request.get(`${API}/api/v1/projects/${pid}/documents`, { headers: hCust });
    expect(docsRes.status()).toBe(200);
    const docsBody = (await docsRes.json()) as { items?: unknown[] };
    expect(Array.isArray(docsBody.items)).toBe(true);

    const dailyRes = await request.get(`${API}/api/v1/projects/${pid}/reports/daily`, { headers: hCust });
    expect(dailyRes.status()).toBe(200);
    const daily = await dailyRes.json();
    expect(daily).toBeTruthy();
  });
});
