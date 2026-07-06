/**
 * P0.1 — чеклист пути заказчика (15 сценариев, API-регресс).
 * Зеркало ручного UAT на iPhone preview / web.
 * Запуск: npx playwright test e2e/customer-path.spec.ts
 */
import { test, expect } from '@playwright/test';
import { API, pickPrimaryDemoProject } from './helpers';

async function demoCustomer(request: import('@playwright/test').APIRequestContext) {
  const cust = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json();
  const cid = cust.id as string;
  const projects = await (await request.get(`${API}/api/v1/projects`, { headers: { 'X-User-Id': cid } })).json();
  expect(projects.length).toBeGreaterThanOrEqual(1);
  const pid = pickPrimaryDemoProject(projects).id as string;
  return { cid, pid, projects };
}

test.describe('P0.1 Customer path checklist (API)', () => {
  test('01 — вход demo + выбор объекта', async ({ request }) => {
    const { cid, pid, projects } = await demoCustomer(request);
    expect(cid).toBeTruthy();
    expect(pid).toBeTruthy();
    expect(projects.some((p: { id: string }) => p.id === pid)).toBeTruthy();
  });

  test('02 — объект: комнаты и смета', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const proj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json();
    expect(proj.rooms?.length).toBeGreaterThan(0);
    expect((proj.estimate_lines?.length ?? 0) + (proj.budget_planned ?? 0)).toBeGreaterThan(0);
  });

  test('03 — бюджет: сводка расходов', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const summary = await (await request.get(`${API}/api/v1/projects/${pid}/analytics/expenses-summary`, {
      headers: { 'X-User-Id': cid },
    })).json();
    expect(typeof summary.expenses_total).toBe('number');
  });

  test('04 — оплата: список счетов', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const payments = await (await request.get(`${API}/api/v1/projects/${pid}/payments`, { headers: { 'X-User-Id': cid } })).json();
    expect(Array.isArray(payments)).toBeTruthy();
  });

  test('05 — чек ↔ paymentId (P3.6)', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const proj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json();
    const roomId = proj.rooms?.[0]?.id as string;
    const payments = await (await request.get(`${API}/api/v1/projects/${pid}/payments`, { headers: { 'X-User-Id': cid } })).json();
    const pending = payments.find((p: { status: string }) => p.status === 'pending');
    test.skip(!pending, 'нет pending payment в demo');

    const scan = await request.post(`${API}/api/v1/projects/${pid}/receipts/scan`, {
      headers: { 'X-User-Id': cid },
      data: {
        qr_raw: `t=20260627T1200&s=50.00&fn=9999078901234567&i=${Date.now()}&fp=1234567890&n=1`,
        room_id: roomId,
        payment_id: pending.id,
      },
    });
    expect(scan.ok()).toBeTruthy();
    const rec = await scan.json();
    expect(rec.payment_id).toBe(pending.id);

    const payments2 = await (await request.get(`${API}/api/v1/projects/${pid}/payments`, { headers: { 'X-User-Id': cid } })).json();
    const linked = payments2.find((p: { id: string }) => p.id === pending.id);
    expect(linked?.receipt_id).toBe(rec.id);

    await request.delete(`${API}/api/v1/projects/${pid}/receipts/${rec.id}`, { headers: { 'X-User-Id': cid } });
  });

  test('06 — scan → fact → delete (бюджет)', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const proj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json();
    const roomId = proj.rooms[0].id as string;
    const spent0 = proj.budget_spent as number;
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
    await request.delete(`${API}/api/v1/projects/${pid}/receipts/${rec.id}`, { headers: { 'X-User-Id': cid } });
  });

  test('07 — чат: создать thread', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const chat = await request.post(`${API}/api/v1/projects/${pid}/chats`, {
      headers: { 'X-User-Id': cid },
      data: { title: 'UAT checklist', topic: 'general' },
    });
    expect(chat.ok()).toBeTruthy();
  });

  test('08 — материалы', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const picks = await (await request.get(`${API}/api/v1/projects/${pid}/material-picks`, { headers: { 'X-User-Id': cid } })).json();
    expect(Array.isArray(picks)).toBeTruthy();
  });

  test('09 — этапы / ремонт', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const proj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: { 'X-User-Id': cid } })).json();
    expect(Array.isArray(proj.stages)).toBeTruthy();
  });

  test('10 — приёмка: pending count', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const r = await request.get(`${API}/api/v1/projects/${pid}/acceptances/pending-count`, { headers: { 'X-User-Id': cid } });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(typeof body.count).toBe('number');
  });

  test('11 — activity / архив', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const feed = await (await request.get(`${API}/api/v1/projects/${pid}/activity`, { headers: { 'X-User-Id': cid } })).json();
    expect(Array.isArray(feed)).toBeTruthy();
  });

  test('12 — календарь', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const cal = await request.get(`${API}/api/v1/projects/${pid}/calendar`, { headers: { 'X-User-Id': cid } });
    expect(cal.ok()).toBeTruthy();
  });

  test('13 — доп. работы (change orders)', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const orders = await (await request.get(`${API}/api/v1/projects/${pid}/change-orders`, { headers: { 'X-User-Id': cid } })).json();
    expect(Array.isArray(orders)).toBeTruthy();
  });

  test('14 — план / floor plans', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const plans = await request.get(`${API}/api/v1/projects/${pid}/floor-plans`, { headers: { 'X-User-Id': cid } });
    expect(plans.ok()).toBeTruthy();
  });

  test('15 — OS budget summary (hub без hero — данные)', async ({ request }) => {
    const { cid, pid } = await demoCustomer(request);
    const os = await request.get(`${API}/api/v1/projects/${pid}/os/budget`, { headers: { 'X-User-Id': cid } });
    expect(os.ok()).toBeTruthy();
    const body = await os.json();
    expect(body).toBeTruthy();
  });
});
