/**
 * P3-W11 — golden path: lock estimate → sign contract → start stage (API E2E).
 * Запуск: npx playwright test e2e/contract-gate-path.spec.ts
 */
import { test, expect } from '@playwright/test';
import { API } from './helpers';

test.describe('P3-W11 Contract gate golden path', () => {
  test('lock → sign → start stage', async ({ request }) => {
    const cont = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })).json();
    const cust = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json();
    const hCont = { 'X-User-Id': cont.id as string };
    const hCust = { 'X-User-Id': cust.id as string };
    const pid = ((await (await request.get(`${API}/api/v1/projects`, { headers: hCust })).json()) as { id: string }[])[0].id;
    await request.post(`${API}/api/v1/projects/${pid}/assign`, { headers: hCont });
    const detail = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCont })).json();
    const planned = (detail.stages as { id: string; status: string }[]).find((s) => s.status === 'planned');
    expect(planned).toBeTruthy();

    const locked = await request.post(`${API}/api/v1/projects/${pid}/estimate/lock`, { headers: hCont });
    expect(locked.ok()).toBeTruthy();
    const lockBody = await locked.json();
    const docId = lockBody.contract.document_id as string;

    const blocked = await request.post(`${API}/api/v1/projects/${pid}/stages/${planned!.id}/start`, { headers: hCont });
    expect(blocked.status()).toBe(403);

    const signed = await request.post(`${API}/api/v1/projects/${pid}/documents/${docId}/sign`, {
      headers: hCust,
      data: { provider: 'in_app' },
    });
    expect(signed.ok()).toBeTruthy();

    const gate = await (await request.get(`${API}/api/v1/projects/${pid}/contract-gate`, { headers: hCont })).json();
    expect(gate.ok).toBe(true);

    const started = await request.post(`${API}/api/v1/projects/${pid}/stages/${planned!.id}/start`, { headers: hCont });
    expect(started.ok()).toBeTruthy();
    expect((await started.json()).status).toBe('active');
  });
});
