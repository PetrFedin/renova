/**
 * P3-W12 + #433 — project lifecycle API E2E.
 *
 * Permanent purge graph is intentionally NOT qualified here; #319 owns
 * PostgreSQL retention/FK/storage cleanup. This spec proves the reversible
 * lifecycle plus owner/contractor authority without weakening that blocker.
 */
import { test, expect } from '@playwright/test';
import { API, authHeaders, DemoUser } from './helpers';

type ProjectDetail = {
  id: string;
  name: string;
  access_mode?: string;
  is_archived?: boolean;
  trashed_at?: string | null;
  rooms?: { id: string }[];
  stages?: { id: string }[];
};

function projectPayload(name: string) {
  return {
    name,
    address: 'Lifecycle audit',
    renovation_type: 'cosmetic',
    property_type: 'apartment',
    total_area_sqm: 20,
    rooms: [{ name: 'Комната', area_sqm: 20, length_m: 5, width_m: 4 }],
  };
}

test.describe('P3-W12 Project lifecycle', () => {
  test('archive → trash → restore + guest forbidden + documents list', async ({ request }) => {
    const cust = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json();
    const guest = await (await request.post(`${API}/api/v1/auth/demo/guest`, { data: {} })).json();
    const hCust = authHeaders(cust as DemoUser);
    const hGuest = authHeaders(guest as DemoUser);

    const guestProjects = (await (await request.get(`${API}/api/v1/projects`, { headers: hGuest })).json()) as {
      id: string;
      access_mode: string;
    }[];
    const guestRow = guestProjects.find((p) => p.access_mode === 'guest');
    expect(guestRow, 'guest needs a demo project_viewers link').toBeTruthy();
    const pid = guestRow!.id;

    const projects = (await (await request.get(`${API}/api/v1/projects`, { headers: hCust })).json()) as {
      id: string;
      access_mode: string;
    }[];
    const ownerRow = projects.find((p) => p.id === pid);
    expect(ownerRow?.access_mode).toBe('owner');

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
    const docsBody = (await docs.json()) as { items?: unknown[] };
    expect(Array.isArray(docsBody.items)).toBe(true);
  });

  test('fresh project create → read → update → archive/unarchive → trash/restore with contractor owner boundary', async ({ request }) => {
    const customer = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json()) as DemoUser;
    const contractor = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })).json()) as DemoUser;
    const hCustomer = authHeaders(customer);
    const hContractor = authHeaders(contractor);

    const forbiddenName = `Исполнитель не создаёт объект ${Date.now()}`;
    const contractorCreate = await request.post(`${API}/api/v1/projects`, {
      headers: hContractor,
      data: projectPayload(forbiddenName),
    });
    expect(contractorCreate.status()).toBe(403);
    const contractorProjectsAfterDeniedCreate = (await (
      await request.get(`${API}/api/v1/projects`, { headers: hContractor })
    ).json()) as ProjectDetail[];
    expect(contractorProjectsAfterDeniedCreate.some((p) => p.name === forbiddenName)).toBe(false);

    const originalName = `Lifecycle объект ${Date.now()}`;
    const created = await request.post(`${API}/api/v1/projects`, {
      headers: hCustomer,
      data: projectPayload(originalName),
    });
    expect(created.status()).toBe(200);
    const createdBody = (await created.json()) as ProjectDetail;
    const projectId = createdBody.id;
    expect(createdBody.name).toBe(originalName);
    expect(createdBody.rooms?.length ?? 0).toBeGreaterThan(0);
    expect(createdBody.stages?.length ?? 0).toBeGreaterThan(0);
    const roomIds = (createdBody.rooms ?? []).map((r) => r.id).sort();
    const stageIds = (createdBody.stages ?? []).map((s) => s.id).sort();

    try {
      const readAfterCreate = await request.get(`${API}/api/v1/projects/${projectId}`, { headers: hCustomer });
      expect(readAfterCreate.status()).toBe(200);
      const readAfterCreateBody = (await readAfterCreate.json()) as ProjectDetail;
      expect(readAfterCreateBody.name).toBe(originalName);
      expect((readAfterCreateBody.rooms ?? []).map((r) => r.id).sort()).toEqual(roomIds);
      expect((readAfterCreateBody.stages ?? []).map((s) => s.id).sort()).toEqual(stageIds);

      const updatedName = `${originalName} · обновлён`;
      const patched = await request.patch(`${API}/api/v1/projects/${projectId}`, {
        headers: hCustomer,
        data: { name: updatedName },
      });
      expect(patched.status()).toBe(200);
      expect(((await patched.json()) as ProjectDetail).name).toBe(updatedName);

      const readAfterPatch = await request.get(`${API}/api/v1/projects/${projectId}`, { headers: hCustomer });
      expect(readAfterPatch.status()).toBe(200);
      expect(((await readAfterPatch.json()) as ProjectDetail).name).toBe(updatedName);

      const dashboard = await request.get(`${API}/api/v1/projects/${projectId}/dashboard`, { headers: hCustomer });
      expect(dashboard.status()).toBe(200);
      expect(((await dashboard.json()) as { name?: string }).name).toBe(updatedName);

      const activeAfterPatch = (await (
        await request.get(`${API}/api/v1/projects?bucket=active`, { headers: hCustomer })
      ).json()) as ProjectDetail[];
      expect(activeAfterPatch.find((p) => p.id === projectId)?.name).toBe(updatedName);

      // Canonical contractor assignment used by other E2E helpers: demo checkout → self-assign.
      await request.post(`${API}/api/v1/subscription/checkout`, { headers: hContractor });
      const assigned = await request.post(`${API}/api/v1/projects/${projectId}/assign`, { headers: hContractor });
      expect(assigned.ok()).toBeTruthy();
      const contractorRead = await request.get(`${API}/api/v1/projects/${projectId}`, { headers: hContractor });
      expect(contractorRead.status()).toBe(200);
      expect(((await contractorRead.json()) as ProjectDetail).access_mode).toBe('contractor');

      // Owner lifecycle is customer-only even when the contractor is assigned.
      for (const action of ['archive', 'unarchive', 'trash', 'restore']) {
        const denied = await request.post(`${API}/api/v1/projects/${projectId}/${action}`, { headers: hContractor });
        expect(denied.status(), `contractor ${action} must be forbidden`).toBe(403);
        const ownerRead = await request.get(`${API}/api/v1/projects/${projectId}`, { headers: hCustomer });
        expect(ownerRead.status()).toBe(200);
        expect(((await ownerRead.json()) as ProjectDetail).name).toBe(updatedName);
      }
      const deniedPurge = await request.delete(`${API}/api/v1/projects/${projectId}`, { headers: hContractor });
      expect(deniedPurge.status()).toBe(403);
      expect((await request.get(`${API}/api/v1/projects/${projectId}`, { headers: hCustomer })).status()).toBe(200);

      // Permanent deletion is a different contract (#319): non-trashed purge must fail closed.
      const purgeBeforeTrash = await request.delete(`${API}/api/v1/projects/${projectId}`, { headers: hCustomer });
      expect(purgeBeforeTrash.status()).toBe(400);

      const archived = await request.post(`${API}/api/v1/projects/${projectId}/archive`, { headers: hCustomer });
      expect(archived.status()).toBe(200);
      expect(((await archived.json()) as ProjectDetail).is_archived).toBe(true);
      const activeAfterArchive = (await (
        await request.get(`${API}/api/v1/projects?bucket=active`, { headers: hCustomer })
      ).json()) as ProjectDetail[];
      expect(activeAfterArchive.some((p) => p.id === projectId)).toBe(false);
      const archivedBucket = (await (
        await request.get(`${API}/api/v1/projects?bucket=archived`, { headers: hCustomer })
      ).json()) as ProjectDetail[];
      expect(archivedBucket.some((p) => p.id === projectId)).toBe(true);

      const unarchived = await request.post(`${API}/api/v1/projects/${projectId}/unarchive`, { headers: hCustomer });
      expect(unarchived.status()).toBe(200);
      expect(((await unarchived.json()) as ProjectDetail).is_archived).toBe(false);
      const activeAfterUnarchive = (await (
        await request.get(`${API}/api/v1/projects?bucket=active`, { headers: hCustomer })
      ).json()) as ProjectDetail[];
      expect(activeAfterUnarchive.some((p) => p.id === projectId)).toBe(true);

      const trashed = await request.post(`${API}/api/v1/projects/${projectId}/trash`, { headers: hCustomer });
      expect(trashed.status()).toBe(200);
      expect(((await trashed.json()) as ProjectDetail).trashed_at).toBeTruthy();
      expect((await request.get(`${API}/api/v1/projects/${projectId}`, { headers: hCustomer })).status()).toBe(404);
      expect((await request.get(`${API}/api/v1/projects/${projectId}`, { headers: hContractor })).status()).toBe(404);
      const trashBucket = (await (
        await request.get(`${API}/api/v1/projects?bucket=trashed`, { headers: hCustomer })
      ).json()) as ProjectDetail[];
      expect(trashBucket.some((p) => p.id === projectId)).toBe(true);

      const restored = await request.post(`${API}/api/v1/projects/${projectId}/restore`, { headers: hCustomer });
      expect(restored.status()).toBe(200);
      expect(((await restored.json()) as ProjectDetail).trashed_at).toBeNull();

      const readAfterRestore = await request.get(`${API}/api/v1/projects/${projectId}`, { headers: hCustomer });
      expect(readAfterRestore.status()).toBe(200);
      const restoredBody = (await readAfterRestore.json()) as ProjectDetail;
      expect(restoredBody.name).toBe(updatedName);
      expect((restoredBody.rooms ?? []).map((r) => r.id).sort()).toEqual(roomIds);
      expect((restoredBody.stages ?? []).map((s) => s.id).sort()).toEqual(stageIds);

      const contractorReadAfterRestore = await request.get(`${API}/api/v1/projects/${projectId}`, { headers: hContractor });
      expect(contractorReadAfterRestore.status()).toBe(200);
      expect(((await contractorReadAfterRestore.json()) as ProjectDetail).access_mode).toBe('contractor');
    } finally {
      // Keep the canonical test DB clean without claiming permanent purge safety (#319).
      await request.post(`${API}/api/v1/projects/${projectId}/trash`, { headers: hCustomer }).catch(() => undefined);
    }
  });
});