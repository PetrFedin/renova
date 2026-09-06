/** #298 — mixed own/purchased material truth through the public API. */
import { test, expect } from '@playwright/test';
import { API, authHeaders, cleanupE2eGateProject, type DemoUser } from './helpers';

test.describe('#298 material supply truth', () => {
  test('own material stays outside procurement while the responsible buyer purchases only the remainder', async ({ request }) => {
    const contractor = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })).json()) as DemoUser;
    const customer = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json()) as DemoUser;
    const hContractor = authHeaders(contractor);
    const hCustomer = authHeaders(customer);

    const created = await request.post(`${API}/api/v1/projects`, {
      headers: hCustomer,
      data: {
        name: `Материалы объекта ${Date.now()}`,
        address: 'E2E material supply',
        renovation_type: 'cosmetic',
        property_type: 'apartment',
        total_area_sqm: 42,
        rooms: [{ name: 'Комната', area_sqm: 20, length_m: 5, width_m: 4 }],
      },
    });
    expect(created.ok()).toBeTruthy();
    const projectId = ((await created.json()) as { id: string }).id;

    try {
      await request.post(`${API}/api/v1/subscription/checkout`, { headers: hContractor });
      const assigned = await request.post(`${API}/api/v1/projects/${projectId}/assign`, { headers: hContractor });
      expect(assigned.ok()).toBeTruthy();

      const ownCreate = await request.post(`${API}/api/v1/projects/${projectId}/material-picks`, {
        headers: hContractor,
        data: {
          name: 'Плитка заказчика',
          qty: 5,
          unit: 'шт',
          price: 100,
          supply_source: 'customer_on_hand',
          qty_available: 5,
          client_request_id: `mat-own-${Date.now()}`,
        },
      });
      expect(ownCreate.ok()).toBeTruthy();
      const own = (await ownCreate.json()) as { id: string };

      const buyCreate = await request.post(`${API}/api/v1/projects/${projectId}/material-picks`, {
        headers: hContractor,
        data: {
          name: 'Краска к покупке заказчиком',
          qty: 10,
          unit: 'шт',
          price: 100,
          supply_source: 'customer_to_buy',
          qty_available: 3,
          client_request_id: `mat-buy-${Date.now()}`,
        },
      });
      expect(buyCreate.ok()).toBeTruthy();
      const buy = (await buyCreate.json()) as { id: string };

      for (const id of [own.id, buy.id]) {
        const submitted = await request.post(`${API}/api/v1/projects/${projectId}/material-picks/${id}/submit`, {
          headers: hContractor,
        });
        expect(submitted.ok()).toBeTruthy();
        const approved = await request.post(`${API}/api/v1/projects/${projectId}/material-picks/${id}/approve`, {
          headers: hCustomer,
        });
        expect(approved.ok()).toBeTruthy();
      }

      const listed = await request.get(`${API}/api/v1/projects/${projectId}/material-picks`, { headers: hCustomer });
      expect(listed.ok()).toBeTruthy();
      const rows = (await listed.json()) as {
        id: string;
        supply_source: string;
        qty_available: number;
        qty_to_buy: number;
        material_available: boolean;
      }[];
      const ownRow = rows.find((row) => row.id === own.id);
      const buyRow = rows.find((row) => row.id === buy.id);
      expect(ownRow).toMatchObject({
        supply_source: 'customer_on_hand',
        qty_available: 5,
        qty_to_buy: 0,
        material_available: true,
      });
      expect(buyRow).toMatchObject({
        supply_source: 'customer_to_buy',
        qty_available: 3,
        qty_to_buy: 7,
        material_available: false,
      });

      const fakeOwnPurchase = await request.post(`${API}/api/v1/projects/${projectId}/purchases`, {
        headers: hCustomer,
        data: {
          material_pick_ids: [own.id],
          client_request_id: `purchase-own-${Date.now()}`,
        },
      });
      expect(fakeOwnPurchase.status()).toBe(422);
      expect((await fakeOwnPurchase.json()).detail.code).toBe('purchase_pick_not_buy_required');

      const wrongBuyer = await request.post(`${API}/api/v1/projects/${projectId}/purchases`, {
        headers: hContractor,
        data: {
          material_pick_ids: [buy.id],
          client_request_id: `purchase-wrong-${Date.now()}`,
        },
      });
      expect(wrongBuyer.status()).toBe(409);
      expect((await wrongBuyer.json()).detail.code).toBe('purchase_pick_responsibility_forbidden');

      const realPurchase = await request.post(`${API}/api/v1/projects/${projectId}/purchases`, {
        headers: hCustomer,
        data: {
          material_pick_ids: [buy.id],
          supplier_name: 'E2E supplier',
          client_request_id: `purchase-real-${Date.now()}`,
        },
      });
      expect(realPurchase.ok()).toBeTruthy();
      const purchase = (await realPurchase.json()) as {
        total_amount: number;
        items: { material_pick_id: string; qty: number; unit_price: number }[];
      };
      expect(purchase.total_amount).toBe(700);
      expect(purchase.items).toHaveLength(1);
      expect(purchase.items[0]).toMatchObject({
        material_pick_id: buy.id,
        qty: 7,
        unit_price: 100,
      });
    } finally {
      await cleanupE2eGateProject(request, customer, projectId);
    }
  });
});
