/**
 * #375 bounded estimate slice — cross-project estimate-line mutation must fail closed.
 * The same contractor is assigned to both projects so 404 proves path-object
 * binding rather than a lack of access to the foreign project.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, authHeaders, type DemoUser } from './helpers';

function projectPayload(name: string) {
  return {
    name,
    address: 'Estimate binding E2E',
    renovation_type: 'cosmetic',
    property_type: 'apartment',
    total_area_sqm: 10,
    rooms: [{ name: `${name} room`, length_m: 4, width_m: 2.5 }],
  };
}

async function readProject(request: APIRequestContext, headers: Record<string, string>, projectId: string) {
  const response = await request.get(`${API}/api/v1/projects/${projectId}`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    id: string;
    budget_planned: number;
    estimate_lines: {
      id: string;
      name: string;
      quantity_planned: number;
      unit_price: number;
      total: number;
    }[];
  };
}

async function createProject(request: APIRequestContext, headers: Record<string, string>, name: string) {
  const response = await request.post(`${API}/api/v1/projects`, {
    headers,
    data: projectPayload(name),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).id as string;
}

test.describe('P0 estimate line object binding', () => {
  test('foreign line id cannot be mutated through another authorized project path', async ({ request }) => {
    const customer = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })
    ).json()) as DemoUser;
    const contractor = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })
    ).json()) as DemoUser;
    const customerHeaders = authHeaders(customer);
    const contractorHeaders = authHeaders(contractor);

    const marker = Date.now();
    const projectA = await createProject(request, customerHeaders, `Estimate A ${marker}`);
    const projectB = await createProject(request, customerHeaders, `Estimate B ${marker}`);

    try {
      await request.post(`${API}/api/v1/subscription/checkout`, { headers: contractorHeaders });
      expect((await request.post(`${API}/api/v1/projects/${projectA}/assign`, { headers: contractorHeaders })).ok()).toBeTruthy();
      expect((await request.post(`${API}/api/v1/projects/${projectB}/assign`, { headers: contractorHeaders })).ok()).toBeTruthy();

      const createA = await request.post(`${API}/api/v1/projects/${projectA}/estimate/lines`, {
        headers: contractorHeaders,
        data: {
          line_type: 'material',
          name: 'A material',
          unit: 'pcs',
          quantity_planned: 2,
          unit_price: 100,
          client_request_id: `estimate-binding-a-${marker}`,
        },
      });
      expect(createA.status()).toBe(200);
      const lineA = ((await createA.json()) as { id: string }).id;

      const createB = await request.post(`${API}/api/v1/projects/${projectB}/estimate/lines`, {
        headers: contractorHeaders,
        data: {
          line_type: 'material',
          name: 'B material',
          unit: 'pcs',
          quantity_planned: 3,
          unit_price: 200,
          client_request_id: `estimate-binding-b-${marker}`,
        },
      });
      expect(createB.status()).toBe(200);
      const lineB = ((await createB.json()) as { id: string }).id;

      const beforeA = await readProject(request, contractorHeaders, projectA);
      const beforeB = await readProject(request, contractorHeaders, projectB);
      const budgetABefore = beforeA.budget_planned;
      const budgetBBefore = beforeB.budget_planned;
      expect(beforeB.estimate_lines.find((line) => line.id === lineB)?.unit_price).toBe(200);

      const crossProjectPatch = await request.patch(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineB}`,
        { headers: contractorHeaders, data: { unit_price: 999 } },
      );
      expect(crossProjectPatch.status()).toBe(404);

      const afterAttackA = await readProject(request, contractorHeaders, projectA);
      const afterAttackB = await readProject(request, contractorHeaders, projectB);
      expect(afterAttackA.budget_planned).toBeCloseTo(budgetABefore, 2);
      expect(afterAttackB.budget_planned).toBeCloseTo(budgetBBefore, 2);
      expect(afterAttackB.estimate_lines.find((line) => line.id === lineB)?.unit_price).toBe(200);

      const customerCannotPatch = await request.patch(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineA}`,
        { headers: customerHeaders, data: { unit_price: 175 } },
      );
      expect(customerCannotPatch.status()).toBe(403);

      const ownPatch = await request.patch(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineA}`,
        { headers: contractorHeaders, data: { unit_price: 150 } },
      );
      expect(ownPatch.status()).toBe(200);

      const afterOwnPatchA = await readProject(request, contractorHeaders, projectA);
      const afterOwnPatchB = await readProject(request, contractorHeaders, projectB);
      expect(afterOwnPatchA.estimate_lines.find((line) => line.id === lineA)?.unit_price).toBe(150);
      expect(afterOwnPatchA.budget_planned).not.toBeCloseTo(budgetABefore, 2);
      expect(afterOwnPatchB.budget_planned).toBeCloseTo(budgetBBefore, 2);
      expect(afterOwnPatchB.estimate_lines.find((line) => line.id === lineB)?.unit_price).toBe(200);
    } finally {
      await request.post(`${API}/api/v1/projects/${projectA}/trash`, { headers: customerHeaders }).catch(() => undefined);
      await request.post(`${API}/api/v1/projects/${projectB}/trash`, { headers: customerHeaders }).catch(() => undefined);
    }
  });
});