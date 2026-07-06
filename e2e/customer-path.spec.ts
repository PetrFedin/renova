/**
 * Чеклист пути заказчика (API) — зеркало ручного прогона «серьёзный клиент».
 * Запуск: npx playwright test e2e/customer-path.spec.ts
 */
import { test, expect } from '@playwright/test';
import { API, pickPrimaryDemoProject } from './helpers';

test.describe('Customer path checklist (API)', () => {
  test('full budget chain: scan → fact → delete', async ({ request }) => {
    const cust = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json();
    const cid = cust.id as string;
    const projects = await (await request.get(`${API}/api/v1/projects`, { headers: { 'X-User-Id': cid } })).json();
    expect(projects.length).toBeGreaterThanOrEqual(1);
    const pid = pickPrimaryDemoProject(projects).id as string;

    const proj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json();
    expect(proj.rooms?.length).toBeGreaterThan(0);
    const roomId = proj.rooms[0].id as string;
    const spent0 = proj.budget_spent as number;

    const summary0 = await (await request.get(`${API}/api/v1/projects/${pid}/analytics/expenses-summary`, {
      headers: { 'X-User-Id': cid },
    })).json();
    expect(Math.abs(spent0 - (summary0.expenses_total as number))).toBeLessThan(1);

    const scan = await request.post(`${API}/api/v1/projects/${pid}/receipts/scan`, {
      headers: { 'X-User-Id': cid },
      data: {
        qr_raw: `t=20260627T1200&s=199.00&fn=9999078901234567&i=${Date.now()}&fp=1234567890&n=1`,
        room_id: roomId,
        expense_category: 'materials',
      },
    });
    expect(scan.ok()).toBeTruthy();
    const rec = await scan.json();

    const proj1 = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json();
    expect(proj1.budget_spent as number).toBeGreaterThan(spent0);

    const del = await request.delete(`${API}/api/v1/projects/${pid}/receipts/${rec.id}`, {
      headers: { 'X-User-Id': cid },
    });
    expect(del.ok()).toBeTruthy();

    const proj2 = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json();
    const spent2 = proj2.budget_spent as number;
    const spent1 = proj1.budget_spent as number;
    const summary2 = await (await request.get(`${API}/api/v1/projects/${pid}/analytics/expenses-summary`, {
      headers: { 'X-User-Id': cid },
    })).json();
    expect(spent2).toBeLessThan(spent1);
    expect(spent1 - spent2).toBeGreaterThanOrEqual(199);
    expect(Math.abs((summary0.expenses_total as number) - spent2)).toBeLessThan(1);
  });

  test('communications and materials', async ({ request }) => {
    const cust = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json();
    const cid = cust.id as string;
    const projects = await (await request.get(`${API}/api/v1/projects`, { headers: { 'X-User-Id': cid } })).json();
    const pid = pickPrimaryDemoProject(projects).id as string;

    const picks = await (await request.get(`${API}/api/v1/projects/${pid}/material-picks`, { headers: { 'X-User-Id': cid } })).json();
    expect(Array.isArray(picks)).toBeTruthy();

    const chat = await request.post(`${API}/api/v1/projects/${pid}/chats`, {
      headers: { 'X-User-Id': cid },
      data: { title: 'Walkthrough', topic: 'general' },
    });
    expect(chat.ok()).toBeTruthy();

    const payments = await (await request.get(`${API}/api/v1/projects/${pid}/payments`, { headers: { 'X-User-Id': cid } })).json();
    expect(Array.isArray(payments)).toBeTruthy();
  });
});
