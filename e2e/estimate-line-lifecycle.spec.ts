/**
 * #445 estimate-line lifecycle.
 * Proves create -> read -> edit -> linked budget -> remove -> read/audit/replay
 * -> restore same identity -> linked budget recovery, separately for contractor
 * mutation authority and customer read/decision authority.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, authHeaders, type DemoUser } from './helpers';

function projectPayload(name: string) {
  return {
    name,
    address: 'Estimate lifecycle E2E',
    renovation_type: 'cosmetic',
    property_type: 'apartment',
    total_area_sqm: 12,
    rooms: [
      {
        name: 'Lifecycle room',
        room_type: 'living_room',
        length_m: 4,
        width_m: 3,
        height_m: 2.7,
      },
    ],
  };
}

type LifecycleLine = {
  id: string;
  name: string;
  origin: 'system' | 'manual' | 'import';
  lifecycle_status: 'active' | 'removed';
  quantity_planned: number;
  unit_price: number;
  notes?: string | null;
  removed_at?: string | null;
};

async function readProject(
  request: APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
) {
  const response = await request.get(`${API}/api/v1/projects/${projectId}`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    id: string;
    budget_planned: number;
    estimate_locked_at?: string | null;
    estimate_lines: { id: string; name: string; quantity_planned: number; unit_price: number }[];
  };
}

async function lifecycle(
  request: APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
) {
  const response = await request.get(`${API}/api/v1/projects/${projectId}/estimate/lines/lifecycle`, {
    headers,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { active: LifecycleLine[]; removed: LifecycleLine[] };
}

async function createProject(
  request: APIRequestContext,
  headers: Record<string, string>,
  name: string,
) {
  const response = await request.post(`${API}/api/v1/projects`, {
    headers,
    data: projectPayload(name),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).id as string;
}

test.describe('P0 estimate-line reversible lifecycle', () => {
  test('contractor mutation and customer read converge through remove/restore', async ({ request }) => {
    const customer = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })
    ).json()) as DemoUser;
    const contractor = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })
    ).json()) as DemoUser;
    const customerHeaders = authHeaders(customer);
    const contractorHeaders = authHeaders(contractor);
    const marker = Date.now();
    const projectA = await createProject(request, customerHeaders, `Estimate lifecycle A ${marker}`);
    const projectB = await createProject(request, customerHeaders, `Estimate lifecycle B ${marker}`);

    try {
      await request.post(`${API}/api/v1/subscription/checkout`, { headers: contractorHeaders });
      expect((await request.post(`${API}/api/v1/projects/${projectA}/assign`, { headers: contractorHeaders })).ok()).toBeTruthy();
      expect((await request.post(`${API}/api/v1/projects/${projectB}/assign`, { headers: contractorHeaders })).ok()).toBeTruthy();

      const systemLine = (await lifecycle(request, contractorHeaders, projectA)).active.find(
        (line) => line.origin === 'system',
      );
      expect(systemLine).toBeTruthy();
      const systemRemove = await request.post(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${systemLine!.id}/remove`,
        { headers: contractorHeaders },
      );
      expect(systemRemove.status()).toBe(409);
      expect((await systemRemove.json()).detail?.code).toBe('estimate_line_system_managed');

      const beforeCreate = await readProject(request, contractorHeaders, projectA);
      const create = await request.post(`${API}/api/v1/projects/${projectA}/estimate/lines`, {
        headers: contractorHeaders,
        data: {
          line_type: 'material',
          name: `Manual lifecycle material ${marker}`,
          unit: 'pcs',
          quantity_planned: 2,
          unit_price: 100,
          notes: 'initial note',
          client_request_id: `estimate-lifecycle-a-${marker}`,
        },
      });
      expect(create.status()).toBe(200);
      const lineId = ((await create.json()) as { id: string }).id;

      const createB = await request.post(`${API}/api/v1/projects/${projectB}/estimate/lines`, {
        headers: contractorHeaders,
        data: {
          line_type: 'work',
          name: `Foreign lifecycle work ${marker}`,
          unit: 'job',
          quantity_planned: 1,
          unit_price: 90,
          client_request_id: `estimate-lifecycle-b-${marker}`,
        },
      });
      expect(createB.status()).toBe(200);
      const foreignLineId = ((await createB.json()) as { id: string }).id;

      const createdProject = await readProject(request, customerHeaders, projectA);
      expect(createdProject.estimate_lines.some((line) => line.id === lineId)).toBe(true);
      expect(createdProject.budget_planned).toBeCloseTo(beforeCreate.budget_planned + 200, 2);

      const contractorRead = await lifecycle(request, contractorHeaders, projectA);
      const customerRead = await lifecycle(request, customerHeaders, projectA);
      for (const view of [contractorRead, customerRead]) {
        const line = view.active.find((item) => item.id === lineId);
        expect(line?.origin).toBe('manual');
        expect(line?.notes).toBe('initial note');
        expect(view.removed.some((item) => item.id === lineId)).toBe(false);
      }

      const customerPatch = await request.patch(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineId}`,
        { headers: customerHeaders, data: { unit_price: 175, notes: 'customer cannot write' } },
      );
      expect(customerPatch.status()).toBe(403);

      const patch = await request.patch(`${API}/api/v1/projects/${projectA}/estimate/lines/${lineId}`, {
        headers: contractorHeaders,
        data: { unit_price: 175, notes: 'brand X / article 42' },
      });
      expect(patch.status()).toBe(200);
      const patched = (await patch.json()) as LifecycleLine;
      expect(patched.id).toBe(lineId);
      expect(patched.unit_price).toBe(175);
      expect(patched.notes).toBe('brand X / article 42');

      const afterPatch = await readProject(request, customerHeaders, projectA);
      expect(afterPatch.budget_planned).toBeCloseTo(beforeCreate.budget_planned + 350, 2);
      const patchedCustomerRead = (await lifecycle(request, customerHeaders, projectA)).active.find(
        (line) => line.id === lineId,
      );
      expect(patchedCustomerRead?.unit_price).toBe(175);
      expect(patchedCustomerRead?.notes).toBe('brand X / article 42');

      const crossProjectRemove = await request.post(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${foreignLineId}/remove`,
        { headers: contractorHeaders },
      );
      expect(crossProjectRemove.status()).toBe(404);
      expect((await lifecycle(request, contractorHeaders, projectB)).active.some((line) => line.id === foreignLineId)).toBe(true);

      const customerRemove = await request.post(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineId}/remove`,
        { headers: customerHeaders },
      );
      expect(customerRemove.status()).toBe(403);

      const remove = await request.post(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineId}/remove`,
        { headers: contractorHeaders },
      );
      expect(remove.status()).toBe(200);
      const removedBody = (await remove.json()) as LifecycleLine & { idempotent_replay: boolean };
      expect(removedBody.id).toBe(lineId);
      expect(removedBody.lifecycle_status).toBe('removed');
      expect(removedBody.idempotent_replay).toBe(false);
      expect(removedBody.notes).toBe('brand X / article 42');
      expect(removedBody.removed_at).toBeTruthy();

      const afterRemove = await readProject(request, customerHeaders, projectA);
      expect(afterRemove.estimate_lines.some((line) => line.id === lineId)).toBe(false);
      expect(afterRemove.budget_planned).toBeCloseTo(beforeCreate.budget_planned, 2);
      for (const view of [
        await lifecycle(request, contractorHeaders, projectA),
        await lifecycle(request, customerHeaders, projectA),
      ]) {
        expect(view.active.some((line) => line.id === lineId)).toBe(false);
        const tombstone = view.removed.find((line) => line.id === lineId);
        expect(tombstone?.unit_price).toBe(175);
        expect(tombstone?.notes).toBe('brand X / article 42');
      }

      const replayRemove = await request.post(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineId}/remove`,
        { headers: contractorHeaders },
      );
      expect(replayRemove.status()).toBe(200);
      expect((await replayRemove.json()).idempotent_replay).toBe(true);
      expect((await readProject(request, contractorHeaders, projectA)).budget_planned).toBeCloseTo(
        beforeCreate.budget_planned,
        2,
      );

      const customerRestore = await request.post(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineId}/restore`,
        { headers: customerHeaders },
      );
      expect(customerRestore.status()).toBe(403);

      const restore = await request.post(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineId}/restore`,
        { headers: contractorHeaders },
      );
      expect(restore.status()).toBe(200);
      const restored = (await restore.json()) as LifecycleLine & { idempotent_replay: boolean };
      expect(restored.id).toBe(lineId);
      expect(restored.lifecycle_status).toBe('active');
      expect(restored.idempotent_replay).toBe(false);
      expect(restored.unit_price).toBe(175);
      expect(restored.notes).toBe('brand X / article 42');

      const afterRestore = await readProject(request, customerHeaders, projectA);
      expect(afterRestore.estimate_lines.some((line) => line.id === lineId)).toBe(true);
      expect(afterRestore.budget_planned).toBeCloseTo(beforeCreate.budget_planned + 350, 2);

      const replayRestore = await request.post(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineId}/restore`,
        { headers: contractorHeaders },
      );
      expect(replayRestore.status()).toBe(200);
      expect((await replayRestore.json()).idempotent_replay).toBe(true);

      const activityResponse = await request.get(`${API}/api/v1/projects/${projectA}/activity`, {
        headers: customerHeaders,
      });
      expect(activityResponse.status()).toBe(200);
      const activity = (await activityResponse.json()) as { kind: string }[];
      expect(activity.filter((item) => item.kind === 'EstimateLineRemoved')).toHaveLength(1);
      expect(activity.filter((item) => item.kind === 'EstimateLineRestored')).toHaveLength(1);

      const removeBeforeLock = await request.post(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineId}/remove`,
        { headers: contractorHeaders },
      );
      expect(removeBeforeLock.status()).toBe(200);
      const propose = await request.post(`${API}/api/v1/projects/${projectA}/estimate/propose-lock`, {
        headers: contractorHeaders,
      });
      expect(propose.status()).toBe(200);
      const lock = await request.post(`${API}/api/v1/projects/${projectA}/estimate/lock`, {
        headers: customerHeaders,
      });
      expect(lock.status()).toBe(200);
      const restoreLocked = await request.post(
        `${API}/api/v1/projects/${projectA}/estimate/lines/${lineId}/restore`,
        { headers: contractorHeaders },
      );
      expect(restoreLocked.status()).toBe(409);
      expect((await restoreLocked.json()).detail?.code).toBe('estimate_locked');
    } finally {
      await request.post(`${API}/api/v1/projects/${projectA}/trash`, { headers: customerHeaders }).catch(() => undefined);
      await request.post(`${API}/api/v1/projects/${projectB}/trash`, { headers: customerHeaders }).catch(() => undefined);
    }
  });
});
