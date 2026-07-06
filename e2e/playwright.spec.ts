import { test, expect } from '@playwright/test';
import { API, pickPrimaryDemoProject } from './helpers';

test.describe('Renova critical path (API)', () => {
  test('full renovation cycle', async ({ request }) => {
    const cust = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json();
    const cont = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })).json();
    const cid = cust.id as string;
    const kid = cont.id as string;

    const projects = await (await request.get(`${API}/api/v1/projects`, { headers: { 'X-User-Id': cid } })).json();
    expect(projects.length).toBeGreaterThanOrEqual(2);
    const pid = pickPrimaryDemoProject(projects).id as string;

    await request.post(`${API}/api/v1/subscription/checkout`, { headers: { 'X-User-Id': kid } });
    await request.post(`${API}/api/v1/projects/${pid}/assign`, { headers: { 'X-User-Id': kid } });

    const proj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json();
    expect(proj.rooms?.length).toBeGreaterThan(0);
    const roomId = proj.rooms[0].id as string;
    const stage = proj.stages.find((s: any) => s.status === 'active') ?? proj.stages[0];

    if (stage.status === 'active') {
      await request.post(`${API}/api/v1/projects/${pid}/stages/${stage.id}/submit`, { headers: { 'X-User-Id': kid } });
    }
    if (stage.status === 'review' || (await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json()).stages.find((s: any) => s.id === stage.id)?.status === 'review') {
      await request.post(`${API}/api/v1/projects/${pid}/stages/${stage.id}/accept`, { headers: { 'X-User-Id': cid } });
    }

    const receipt = await request.post(`${API}/api/v1/projects/${pid}/receipts/scan`, {
      headers: { 'X-User-Id': kid },
      data: { qr_raw: `t=20260627T1200&s=1500.00&fn=9999078901234567&i=${Date.now()}&fp=1234567890&n=1`, room_id: roomId, expense_category: 'materials' },
    });
    expect(receipt.ok()).toBeTruthy();
    const recBody = await receipt.json();
    expect(recBody.amount).toBeGreaterThan(0);

    const manual = await request.post(`${API}/api/v1/projects/${pid}/receipts/manual`, {
      headers: { 'X-User-Id': kid },
      data: { amount: 2500, description: 'E2E manual', expense_category: 'labor', room_id: roomId, stage_id: stage.id },
    });
    expect(manual.ok()).toBeTruthy();

    const beforeProj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json();
    const spentBefore = beforeProj.budget_spent as number;
    const del = await request.delete(`${API}/api/v1/projects/${pid}/receipts/${recBody.id as string}`, {
      headers: { 'X-User-Id': kid },
    });
    expect(del.ok()).toBeTruthy();

    let spentAfter = spentBefore;
    for (let i = 0; i < 8; i++) {
      const afterProj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json();
      spentAfter = afterProj.budget_spent as number;
      if (spentAfter < spentBefore) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(spentAfter).toBeLessThan(spentBefore);

    const summary = await (await request.get(`${API}/api/v1/projects/${pid}/analytics/expenses-summary`, { headers: { 'X-User-Id': cid } })).json();
    expect(summary.by_room?.length).toBeGreaterThan(0);
    expect(summary.receipts_total).toBeGreaterThan(0);

    const csv = await request.get(`${API}/api/v1/projects/${pid}/analytics/expenses.csv`, { headers: { 'X-User-Id': cid } });
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain('Итого');

    const chat = await request.post(`${API}/api/v1/projects/${pid}/chats`, { headers: { 'X-User-Id': cid }, data: { title: 'E2E', topic: 'general' } });
    expect(chat.ok()).toBeTruthy();

    const pdf = await request.get(`${API}/api/v1/projects/${pid}/estimate.pdf`, { headers: { 'X-User-Id': cid } });
    expect(pdf.status()).toBe(200);

    const viewer = await (await request.post(`${API}/api/v1/auth/demo/guest`, { data: {} })).json();
    const vProjects = await (await request.get(`${API}/api/v1/projects`, { headers: { 'X-User-Id': viewer.id } })).json();
    expect(vProjects.length).toBeGreaterThanOrEqual(2);
    const forbidden = await request.post(`${API}/api/v1/projects/${pid}/stages/${stage.id}/accept`, { headers: { 'X-User-Id': viewer.id } });
    expect(forbidden.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe('Web UI (optional)', () => {
  test.skip(() => !process.env.RENOVA_WEB_E2E, 'Set RENOVA_WEB_E2E=1 and start expo web :8081');
  test('onboarding loads', async ({ page }) => {
    await page.goto('/onboarding/role');
    await expect(page.getByText('Заказчик')).toBeVisible();
  });
});
