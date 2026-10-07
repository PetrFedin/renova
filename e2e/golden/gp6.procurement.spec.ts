import { test, expect } from '@playwright/test';
import { API, authHeaders, cleanupE2eGateProject, prepareContractGateScenario } from '../helpers';

test.describe('@golden @gp6 estimate need → approval → purchase → delivery', () => {
  test('contractor proposes priced material, customer approves, lifecycle cannot skip paid', async ({ request }) => {
    const s = await prepareContractGateScenario(request);
    const hC = authHeaders(s.customer);
    const hE = authHeaders(s.contractor);
    try {
      const pickResponse = await request.post(`${API}/api/v1/projects/${s.projectId}/material-picks`, {
        headers: hE,
        data: {
          name: 'Golden грунтовка',
          qty: 10,
          unit: 'л',
          price: 450,
          shop_name: 'Golden Supplier',
          client_request_id: `gp6-pick-${Date.now()}`,
        },
      });
      expect(pickResponse.ok()).toBeTruthy();
      const pickId = ((await pickResponse.json()) as { id: string }).id;

      expect((await request.post(
        `${API}/api/v1/projects/${s.projectId}/material-picks/${pickId}/submit`,
        { headers: hE },
      )).ok()).toBeTruthy();

      const earlyPurchase = await request.post(`${API}/api/v1/projects/${s.projectId}/purchases`, {
        headers: hE,
        data: { material_pick_ids: [pickId], supplier_name: 'Golden Supplier', client_request_id: 'gp6-early-purchase' },
      });
      expect(earlyPurchase.status()).toBe(409);

      expect((await request.post(
        `${API}/api/v1/projects/${s.projectId}/material-picks/${pickId}/approve`,
        { headers: hC },
      )).ok()).toBeTruthy();

      const purchaseResponse = await request.post(`${API}/api/v1/projects/${s.projectId}/purchases`, {
        headers: hE,
        data: { material_pick_ids: [pickId], supplier_name: 'Golden Supplier', client_request_id: 'gp6-approved-purchase' },
      });
      expect(purchaseResponse.ok()).toBeTruthy();
      const purchaseId = ((await purchaseResponse.json()) as { id: string }).id;

      const skip = await request.post(
        `${API}/api/v1/projects/${s.projectId}/purchases/${purchaseId}/status`,
        { headers: hE, data: { status: 'delivered' } },
      );
      expect(skip.status()).toBe(409);

      expect((await request.post(
        `${API}/api/v1/projects/${s.projectId}/purchases/${purchaseId}/status`,
        { headers: hE, data: { status: 'ordered' } },
      )).ok()).toBeTruthy();
      expect((await request.post(
        `${API}/api/v1/projects/${s.projectId}/purchases/${purchaseId}/status`,
        { headers: hC, data: { status: 'paid' } },
      )).ok()).toBeTruthy();
      expect((await request.post(
        `${API}/api/v1/projects/${s.projectId}/purchases/${purchaseId}/status`,
        { headers: hE, data: { status: 'delivered' } },
      )).ok()).toBeTruthy();

      const picks = (await (
        await request.get(`${API}/api/v1/projects/${s.projectId}/material-picks`, { headers: hC })
      ).json()) as Array<{ id: string; qty: number; qty_delivered?: number; status: string }>;
      const delivered = picks.find((p) => p.id === pickId);
      expect(delivered).toBeTruthy();
      expect(Number(delivered?.qty_delivered ?? 0)).toBeGreaterThanOrEqual(Number(delivered?.qty ?? 0));

      const expenses = (await (
        await request.get(`${API}/api/v1/projects/${s.projectId}/os/expenses`, { headers: hC })
      ).json()) as Array<{ source_type?: string; source_id?: string; amount: number; status: string }>;
      expect(
        expenses.filter((e) => e.source_id === purchaseId && e.status === 'confirmed'),
        'Delivered purchase must appear once in financial fact',
      ).toHaveLength(1);
    } finally {
      await cleanupE2eGateProject(request, s.customer, s.projectId);
    }
  });
});
