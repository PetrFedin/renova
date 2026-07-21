/**
 * P0.1 — чеклист пути заказчика (15 сценариев, API-регресс).
 * Зеркало ручного UAT на iPhone preview / web.
 * Запуск: npx playwright test e2e/customer-path.spec.ts
 * Auth: JWT Bearer via authHeaders (staging forbids X-User-Id).
 */
import { test, expect } from '@playwright/test';
import { API, pickPrimaryDemoProject, authHeaders, type DemoUser } from './helpers';

async function demoCustomer(request: import('@playwright/test').APIRequestContext) {
  const cust = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json()) as DemoUser;
  const h = authHeaders(cust);
  const projects = await (await request.get(`${API}/api/v1/projects`, { headers: h })).json();
  expect(projects.length).toBeGreaterThanOrEqual(1);
  const pid = pickPrimaryDemoProject(projects).id as string;
  return { cust, h, pid, projects };
}

test.describe('P0.1 Customer path checklist (API)', () => {
  test('01 — вход demo + выбор объекта', async ({ request }) => {
    const { cust, pid, projects } = await demoCustomer(request);
    expect(cust.id).toBeTruthy();
    expect(pid).toBeTruthy();
    expect(projects.some((p: { id: string }) => p.id === pid)).toBeTruthy();
  });

  test('02 — объект: комнаты и смета', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const proj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: h })).json();
    expect(proj.rooms?.length).toBeGreaterThan(0);
    expect((proj.estimate_lines?.length ?? 0) + (proj.budget_planned ?? 0)).toBeGreaterThan(0);
  });

  test('03 — бюджет: сводка расходов', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const summary = await (await request.get(`${API}/api/v1/projects/${pid}/analytics/expenses-summary`, {
      headers: h,
    })).json();
    expect(typeof summary.expenses_total).toBe('number');
  });

  test('04 — оплата: список счетов', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const payments = await (await request.get(`${API}/api/v1/projects/${pid}/payments`, { headers: h })).json();
    expect(Array.isArray(payments)).toBeTruthy();
  });

  test('05 — чек ↔ paymentId (P3.6)', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const proj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: h })).json();
    const roomId = proj.rooms?.[0]?.id as string;
    const payments = await (await request.get(`${API}/api/v1/projects/${pid}/payments`, { headers: h })).json();
    const pending = payments.find((p: { status: string }) => p.status === 'pending');
    test.skip(!pending, 'нет pending payment в demo');

    const scan = await request.post(`${API}/api/v1/projects/${pid}/receipts/scan`, {
      headers: h,
      data: {
        qr_raw: `t=20260627T1200&s=50.00&fn=9999078901234567&i=${Date.now()}&fp=1234567890&n=1`,
        room_id: roomId,
        payment_id: pending.id,
      },
    });
    expect(scan.ok()).toBeTruthy();
    const rec = await scan.json();
    expect(rec.payment_id).toBe(pending.id);

    const payments2 = await (await request.get(`${API}/api/v1/projects/${pid}/payments`, { headers: h })).json();
    const linked = payments2.find((p: { id: string }) => p.id === pending.id);
    expect(linked?.receipt_id).toBe(rec.id);

    await request.delete(`${API}/api/v1/projects/${pid}/receipts/${rec.id}`, { headers: h });
  });

  test('06 — scan → fact → delete (бюджет)', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const proj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: h })).json();
    const roomId = proj.rooms[0].id as string;
    const spent0 = proj.budget_spent as number;
    const scan = await request.post(`${API}/api/v1/projects/${pid}/receipts/scan`, {
      headers: h,
      data: {
        qr_raw: `t=20260627T1200&s=199.00&fn=9999078901234567&i=${Date.now()}&fp=1234567890&n=1`,
        room_id: roomId,
        expense_category: 'materials',
      },
    });
    expect(scan.ok()).toBeTruthy();
    const rec = await scan.json();
    const proj1 = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: h })).json();
    expect(proj1.budget_spent as number).toBeGreaterThan(spent0);
    await request.delete(`${API}/api/v1/projects/${pid}/receipts/${rec.id}`, { headers: h });
  });

  test('07 — чат: создать thread', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const chat = await request.post(`${API}/api/v1/projects/${pid}/chats`, {
      headers: h,
      data: { title: 'UAT checklist', topic: 'general' },
    });
    expect(chat.ok()).toBeTruthy();
  });

  test('08 — материалы', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const picks = await (await request.get(`${API}/api/v1/projects/${pid}/material-picks`, { headers: h })).json();
    expect(Array.isArray(picks)).toBeTruthy();
  });

  test('09 — этапы / ремонт', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const proj = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: h })).json();
    expect(Array.isArray(proj.stages)).toBeTruthy();
  });

  test('10 — приёмка: pending count', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const r = await request.get(`${API}/api/v1/projects/${pid}/acceptances/pending-count`, { headers: h });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(typeof body.count).toBe('number');
  });

  test('11 — activity / архив', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const feed = await (await request.get(`${API}/api/v1/projects/${pid}/activity`, { headers: h })).json();
    expect(Array.isArray(feed)).toBeTruthy();
  });

  test('12 — календарь', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const cal = await request.get(`${API}/api/v1/projects/${pid}/calendar`, { headers: h });
    expect(cal.ok()).toBeTruthy();
  });

  test('13 — доп. работы (change orders)', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const orders = await (await request.get(`${API}/api/v1/projects/${pid}/change-orders`, { headers: h })).json();
    expect(Array.isArray(orders)).toBeTruthy();
  });

  test('14 — план / floor plans', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const plans = await request.get(`${API}/api/v1/projects/${pid}/floor-plans`, { headers: h });
    expect(plans.ok()).toBeTruthy();
  });

  test('15 — OS budget summary (hub без hero — данные)', async ({ request }) => {
    const { h, pid } = await demoCustomer(request);
    const os = await request.get(`${API}/api/v1/projects/${pid}/os/budget`, { headers: h });
    expect(os.ok()).toBeTruthy();
    const body = await os.json();
    expect(body).toBeTruthy();
  });
});
