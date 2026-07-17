/**
 * P3-W12 — archive/trash lifecycle + documents list smoke (API E2E).
 */
import { test, expect } from '@playwright/test';
import { API } from './helpers';

test.describe('P3-W12 Project lifecycle', () => {
  test('archive → trash → restore + guest forbidden + documents list', async ({ request }) => {
    const cust = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json();
    const guest = await (await request.post(`${API}/api/v1/auth/demo/guest`, { data: {} })).json();
    const hCust = { 'X-User-Id': cust.id as string };
    const hGuest = { 'X-User-Id': guest.id as string };

    const projects = (await (await request.get(`${API}/api/v1/projects`, { headers: hCust })).json()) as {
      id: string;
      access_mode: string;
    }[];
    expect(projects.length).toBeGreaterThan(0);
    const pid = projects[0].id;
    expect(projects[0].access_mode).toBe('owner');

    const guestProjects = (await (await request.get(`${API}/api/v1/projects`, { headers: hGuest })).json()) as {
      id: string;
      access_mode: string;
    }[];
    const guestRow = guestProjects.find((p) => p.id === pid);
    expect(guestRow?.access_mode).toBe('guest');

    const guestArchive = await request.post(`${API}/api/v1/projects/${pid}/archive`, { headers: hGuest });
    expect(guestArchive.status()).toBe(403);

    const archived = await request.post(`${API}/api/v1/projects/${pid}/archive`, { headers: hCust });
    expect(archived.ok()).toBeTruthy();
    expect((await archived.json()).is_archived).toBe(true);

    const trashed = await request.post(`${API}/api/v1/projects/${pid}/trash`, { headers: hCust });
    expect(trashed.ok()).toBeTruthy();

    const restored = await request.post(`${API}/api/v1/projects/${pid}/restore`, { headers: hCust });
    expect(restored.ok()).toBeTruthy();
    expect((await restored.json()).trashed_at).toBeNull();

    const docs = await request.get(`${API}/api/v1/projects/${pid}/documents`, { headers: hCust });
    expect(docs.status()).toBe(200);
    expect(Array.isArray(await docs.json())).toBe(true);
  });
});
