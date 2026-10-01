/**
 * P3-W12 — archive/trash lifecycle + documents list smoke (API E2E).
 */
import { test, expect } from '@playwright/test';
import { assignContractorViaRequest, API, authHeaders, DemoUser } from './helpers';

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

  test('#433 create → read → update → linked reads → archive → unarchive → trash → restore (fresh project)', async ({ request }) => {
    const cust = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json()) as DemoUser;
    const hCust = authHeaders(cust);

    const name = `E2E Lifecycle ${Date.now()}`;
    const created = await request.post(`${API}/api/v1/projects`, {
      headers: hCust,
      data: {
        name,
        address: 'E2E lifecycle test',
        renovation_type: 'cosmetic',
        property_type: 'apartment',
        total_area_sqm: 35,
        rooms: [{ name: 'Комната', area_sqm: 18, length_m: 5, width_m: 3.6 }],
      },
    });
    expect(created.ok(), `create project failed: ${created.status()}`).toBeTruthy();
    const createdBody = (await created.json()) as {
      id: string;
      name: string;
      access_mode: string;
      rooms: { id: string }[];
      stages: { id: string }[];
    };
    const pid = createdBody.id;
    expect(createdBody.name).toBe(name);
    expect(createdBody.access_mode).toBe('owner');
    expect(createdBody.rooms.length).toBeGreaterThan(0);
    expect(createdBody.stages.length).toBeGreaterThan(0);

    // authoritative read
    const detail1 = (await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCust })).json()) as {
      id: string;
      name: string;
      rooms: { id: string }[];
      stages: { id: string }[];
    };
    expect(detail1.id).toBe(pid);
    expect(detail1.name).toBe(name);
    expect(detail1.rooms.length).toBe(createdBody.rooms.length);
    expect(detail1.stages.length).toBe(createdBody.stages.length);

    // update + re-read project detail AND linked projections (dashboard, list)
    const newName = `${name} (updated)`;
    const patched = await request.patch(`${API}/api/v1/projects/${pid}`, { headers: hCust, data: { name: newName } });
    expect(patched.ok(), `patch failed: ${patched.status()}`).toBeTruthy();
    expect((await patched.json()).name).toBe(newName);

    const detail2 = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCust })).json();
    expect(detail2.name).toBe(newName);

    const dashboard = (await (await request.get(`${API}/api/v1/projects/${pid}/dashboard`, { headers: hCust })).json()) as {
      project_id: string;
      name: string;
    };
    expect(dashboard.project_id).toBe(pid);
    expect(dashboard.name).toBe(newName);

    const listActive = (await (await request.get(`${API}/api/v1/projects`, { headers: hCust })).json()) as {
      id: string;
      name: string;
    }[];
    expect(listActive.find((p) => p.id === pid)?.name).toBe(newName);

    // archive → leaves active list, appears in archived bucket
    const archived = await request.post(`${API}/api/v1/projects/${pid}/archive`, { headers: hCust });
    expect(archived.ok()).toBeTruthy();
    expect((await archived.json()).is_archived).toBe(true);

    const listAfterArchive = (await (await request.get(`${API}/api/v1/projects`, { headers: hCust })).json()) as { id: string }[];
    expect(listAfterArchive.some((p) => p.id === pid)).toBe(false);

    const archivedBucket = (await (
      await request.get(`${API}/api/v1/projects?bucket=archived`, { headers: hCust })
    ).json()) as { id: string }[];
    expect(archivedBucket.some((p) => p.id === pid)).toBe(true);

    // unarchive → back to active
    const unarchived = await request.post(`${API}/api/v1/projects/${pid}/unarchive`, { headers: hCust });
    expect(unarchived.ok()).toBeTruthy();
    expect((await unarchived.json()).is_archived).toBe(false);

    const listAfterUnarchive = (await (await request.get(`${API}/api/v1/projects`, { headers: hCust })).json()) as {
      id: string;
    }[];
    expect(listAfterUnarchive.some((p) => p.id === pid)).toBe(true);

    // trash → normal detail unavailable, appears in trashed bucket
    const trashed = await request.post(`${API}/api/v1/projects/${pid}/trash`, { headers: hCust });
    expect(trashed.ok()).toBeTruthy();

    const detailWhileTrashed = await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCust });
    expect(detailWhileTrashed.status()).toBe(404);

    const trashedBucket = (await (
      await request.get(`${API}/api/v1/projects?bucket=trashed`, { headers: hCust })
    ).json()) as { id: string }[];
    expect(trashedBucket.some((p) => p.id === pid)).toBe(true);

    // restore → detail + rooms/stages recover, back in active list
    const restored = await request.post(`${API}/api/v1/projects/${pid}/restore`, { headers: hCust });
    expect(restored.ok()).toBeTruthy();
    expect((await restored.json()).trashed_at).toBeNull();

    const detailAfterRestore = (await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCust })).json()) as {
      id: string;
      rooms: { id: string }[];
      stages: { id: string }[];
    };
    expect(detailAfterRestore.id).toBe(pid);
    expect(detailAfterRestore.rooms.length).toBeGreaterThan(0);
    expect(detailAfterRestore.stages.length).toBeGreaterThan(0);

    const listAfterRestore = (await (await request.get(`${API}/api/v1/projects`, { headers: hCust })).json()) as {
      id: string;
    }[];
    expect(listAfterRestore.some((p) => p.id === pid)).toBe(true);

    // permanent purge precondition: rejects deleting a project that is NOT trashed.
    // Physical purge itself stays out of scope (#319) — only the precondition is asserted here.
    const rejectedPurge = await request.delete(`${API}/api/v1/projects/${pid}`, { headers: hCust });
    expect(rejectedPurge.status()).toBe(400);
  });

  test('#433 contractor authority: no create, read after assignment, lifecycle mutations forbidden, recovers after trash→restore', async ({
    request,
  }) => {
    const cust = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json()) as DemoUser;
    const cont = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })).json()) as DemoUser;
    const hCust = authHeaders(cust);
    const hCont = authHeaders(cont);

    // 1. contractor project creation forbidden and creates no partial project
    const illegalName = `Contractor Illegal Create ${Date.now()}`;
    const contractorCreateAttempt = await request.post(`${API}/api/v1/projects`, {
      headers: hCont,
      data: {
        name: illegalName,
        address: 'E2E',
        renovation_type: 'cosmetic',
        property_type: 'apartment',
        total_area_sqm: 20,
        rooms: [{ name: 'Комната', area_sqm: 10, length_m: 4, width_m: 2.5 }],
      },
    });
    expect(contractorCreateAttempt.status()).toBe(403);

    const contractorProjectsAfterAttempt = (await (
      await request.get(`${API}/api/v1/projects`, { headers: hCont })
    ).json()) as { name: string }[];
    expect(contractorProjectsAfterAttempt.some((p) => p.name === illegalName)).toBe(false);

    // fresh customer-owned project for the contractor to be assigned onto
    const created = await request.post(`${API}/api/v1/projects`, {
      headers: hCust,
      data: {
        name: `Contractor Authority ${Date.now()}`,
        address: 'E2E',
        renovation_type: 'cosmetic',
        property_type: 'apartment',
        total_area_sqm: 30,
        rooms: [{ name: 'Комната', area_sqm: 15, length_m: 5, width_m: 3 }],
      },
    });
    expect(created.ok(), `create project failed: ${created.status()}`).toBeTruthy();
    const pid = ((await created.json()) as { id: string }).id;

    // 2. before canonical assignment, contractor has no read access
    const preAssignRead = await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCont });
    expect(preAssignRead.status()).toBe(403);

    await request.post(`${API}/api/v1/subscription/checkout`, { headers: hCont });
    await assignContractorViaRequest(request, pid, hCont, hCust);

    // read access recovered after canonical assignment
    const postAssignRead = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCont })).json();
    expect(postAssignRead.id).toBe(pid);

    // 3. owner-lifecycle mutations remain forbidden for the assigned contractor
    for (const action of ['archive', 'unarchive', 'trash', 'restore']) {
      const res = await request.post(`${API}/api/v1/projects/${pid}/${action}`, { headers: hCont });
      expect(res.status(), `contractor ${action} must be forbidden`).toBe(403);
    }
    const purgeAttempt = await request.delete(`${API}/api/v1/projects/${pid}`, { headers: hCont });
    expect(purgeAttempt.status()).toBe(403);

    // each denied mutation must leave customer-visible project state unchanged
    const untouchedDetail = (await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCust })).json()) as {
      is_archived: boolean;
      trashed_at: string | null;
    };
    expect(untouchedDetail.is_archived).toBe(false);
    expect(untouchedDetail.trashed_at).toBeNull();

    // 4. after customer trash → restore, assigned contractor read access recovers
    const trashedByOwner = await request.post(`${API}/api/v1/projects/${pid}/trash`, { headers: hCust });
    expect(trashedByOwner.ok()).toBeTruthy();

    const contractorReadWhileTrashed = await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCont });
    expect(contractorReadWhileTrashed.status()).toBe(404);

    const restoredByOwner = await request.post(`${API}/api/v1/projects/${pid}/restore`, { headers: hCust });
    expect(restoredByOwner.ok()).toBeTruthy();

    const contractorReadAfterRestore = (await (
      await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCont })
    ).json()) as { id: string };
    expect(contractorReadAfterRestore.id).toBe(pid);
  });
});
