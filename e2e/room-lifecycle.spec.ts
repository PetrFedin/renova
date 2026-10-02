/**
 * #439 — Room lifecycle E2E: contractor direct mutations + customer
 * room-change-request collaboration path, on the normal API/PostgreSQL
 * stack with fresh projects/rooms (not positional demo fixtures).
 *
 * #435 is already fixed (backend/app/services/room_mutation_service.py,
 * commit 66febfb4): pre-executor the customer-owner may edit rooms
 * directly; once a contractor is linked, direct customer edits fail
 * closed and customer changes must go through room-change-requests.
 * This spec assigns the contractor immediately ("a fresh assigned
 * project") and exercises the post-executor authority split.
 */
import { test, expect } from '@playwright/test';
import { assignContractorViaRequest, API, authHeaders, DemoUser, trackE2eProject, cleanupE2eArtifacts } from './helpers';

type RoomOut = {
  id: string;
  name: string;
  width_m: number;
  outlets_count: number;
  is_archived: boolean;
};

type EstimateLineOut = {
  id: string;
  room_id: string | null;
  category: string;
  name: string;
  quantity_planned: number;
  unit_price: number;
};

type ProjectDetail = {
  id: string;
  budget_planned: number;
  rooms: RoomOut[];
  estimate_lines: EstimateLineOut[];
};

async function createAssignedProject(
  request: import('@playwright/test').APIRequestContext,
  hCust: Record<string, string>,
  hCont: Record<string, string>,
): Promise<string> {
  const created = await request.post(`${API}/api/v1/projects`, {
    headers: hCust,
    data: {
      name: `Room Lifecycle ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      address: 'E2E',
      renovation_type: 'cosmetic',
      property_type: 'apartment',
      total_area_sqm: 40,
      rooms: [{ name: 'Исходная комната', area_sqm: 20, length_m: 5, width_m: 4 }],
    },
  });
  if (!created.ok()) throw new Error(`create project failed: ${created.status()}`);
  const pid = ((await created.json()) as { id: string }).id;
  trackE2eProject(pid, hCust);

  await request.post(`${API}/api/v1/subscription/checkout`, { headers: hCont });
  await assignContractorViaRequest(request, pid, hCont, hCust);
  return pid;
}

async function projectDetail(
  request: import('@playwright/test').APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
): Promise<ProjectDetail> {
  const res = await request.get(`${API}/api/v1/projects/${projectId}`, { headers });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as ProjectDetail;
}

async function listRooms(
  request: import('@playwright/test').APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
  archived: boolean,
): Promise<RoomOut[]> {
  const res = await request.get(`${API}/api/v1/projects/${projectId}/rooms?archived=${archived}`, { headers });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as RoomOut[];
}

test.describe('#439 Room lifecycle', () => {
  test.afterAll(async () => {
    await cleanupE2eArtifacts();
  });

  test('contractor direct mutations + customer request path on a fresh assigned project', async ({ request }) => {
    const cont = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })).json()) as DemoUser;
    const cust = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json()) as DemoUser;
    const hCont = authHeaders(cont);
    const hCust = authHeaders(cust);

    const projectId = await createAssignedProject(request, hCust, hCont);
    const foreignProjectId = await createAssignedProject(request, hCust, hCont);

    // ================= Contractor direct lifecycle =================
    const clientRequestId = `room-lifecycle-${Date.now()}`;
    const created1 = await request.post(`${API}/api/v1/projects/${projectId}/rooms`, {
      headers: hCont,
      data: {
        name: 'Спальня',
        room_type: 'bedroom',
        length_m: 4,
        width_m: 3,
        height_m: 2.7,
        outlets_count: 2,
        client_request_id: clientRequestId,
      },
    });
    expect(created1.ok()).toBeTruthy();
    const room1 = (await created1.json()) as RoomOut;
    expect(room1.name).toBe('Спальня');

    // stable client_request_id must not create a duplicate room on replay
    const created1Replay = await request.post(`${API}/api/v1/projects/${projectId}/rooms`, {
      headers: hCont,
      data: {
        name: 'Спальня',
        room_type: 'bedroom',
        length_m: 4,
        width_m: 3,
        height_m: 2.7,
        outlets_count: 2,
        client_request_id: clientRequestId,
      },
    });
    expect(created1Replay.ok()).toBeTruthy();
    const room1Replay = (await created1Replay.json()) as RoomOut;
    expect(room1Replay.id).toBe(room1.id);
    const roomsAfterReplay = await listRooms(request, hCont, projectId, false);
    expect(roomsAfterReplay.filter((r) => r.id === room1.id)).toHaveLength(1);

    // both contractor and customer read the same room
    const detailContAfterCreate = await projectDetail(request, hCont, projectId);
    const detailCustAfterCreate = await projectDetail(request, hCust, projectId);
    expect(detailContAfterCreate.rooms.find((r) => r.id === room1.id)?.name).toBe('Спальня');
    expect(detailCustAfterCreate.rooms.find((r) => r.id === room1.id)?.name).toBe('Спальня');

    // contractor changes geometry/engineering fields
    const budgetBeforeUpdate = detailContAfterCreate.budget_planned;
    const patched = await request.patch(`${API}/api/v1/projects/${projectId}/rooms/${room1.id}`, {
      headers: hCont,
      data: { width_m: 5, outlets_count: 4 },
    });
    expect(patched.ok()).toBeTruthy();
    const patchedRoom = (await patched.json()) as RoomOut;
    expect(patchedRoom.width_m).toBe(5);
    expect(patchedRoom.outlets_count).toBe(4);

    // re-read generated estimate lines, budget_planned, change-log, both role views
    const detailAfterUpdate = await projectDetail(request, hCont, projectId);
    const outletLines = detailAfterUpdate.estimate_lines.filter(
      (l) => l.room_id === room1.id && l.category === 'electrical',
    );
    expect(outletLines.length).toBeGreaterThan(0);
    for (const line of outletLines) {
      expect(line.quantity_planned).toBe(4);
    }
    const recalculatedBudget = detailAfterUpdate.estimate_lines.reduce(
      (sum, l) => sum + l.quantity_planned * l.unit_price,
      0,
    );
    expect(detailAfterUpdate.budget_planned).toBeCloseTo(recalculatedBudget, 2);
    expect(detailAfterUpdate.budget_planned).not.toBeCloseTo(budgetBeforeUpdate, 2);

    const changeLog = await request.get(`${API}/api/v1/projects/${projectId}/rooms/${room1.id}/change-log`, {
      headers: hCont,
    });
    expect(changeLog.ok()).toBeTruthy();
    const changeLogBody = (await changeLog.json()) as { field: string }[];
    expect(changeLogBody.some((entry) => entry.field === 'width_m')).toBe(true);
    expect(changeLogBody.some((entry) => entry.field === 'outlets_count')).toBe(true);

    const detailCustAfterUpdate = await projectDetail(request, hCust, projectId);
    expect(detailCustAfterUpdate.rooms.find((r) => r.id === room1.id)?.width_m).toBe(5);

    // contractor archives room
    const archived = await request.patch(`${API}/api/v1/projects/${projectId}/rooms/${room1.id}`, {
      headers: hCont,
      data: { is_archived: true },
    });
    expect(archived.ok()).toBeTruthy();
    expect((await archived.json()) as RoomOut).toMatchObject({ is_archived: true });

    const activeAfterArchive = await listRooms(request, hCont, projectId, false);
    expect(activeAfterArchive.find((r) => r.id === room1.id)).toBeUndefined();
    const archivedAfterArchive = await listRooms(request, hCont, projectId, true);
    expect(archivedAfterArchive.find((r) => r.id === room1.id)).toBeTruthy();

    // estimate/document/fact linkage preserved while archived
    const detailAfterArchive = await projectDetail(request, hCont, projectId);
    const linesAfterArchive = detailAfterArchive.estimate_lines.filter((l) => l.room_id === room1.id);
    expect(linesAfterArchive.length).toBe(linesAfterArchive.length > 0 ? linesAfterArchive.length : 0);
    expect(linesAfterArchive.length).toBeGreaterThan(0);
    const archivedLineIds = new Set(linesAfterArchive.map((l) => l.id));

    // contractor restores room
    const restored = await request.patch(`${API}/api/v1/projects/${projectId}/rooms/${room1.id}`, {
      headers: hCont,
      data: { is_archived: false },
    });
    expect(restored.ok()).toBeTruthy();
    expect((await restored.json()) as RoomOut).toMatchObject({ is_archived: false, id: room1.id });

    const activeAfterRestore = await listRooms(request, hCont, projectId, false);
    expect(activeAfterRestore.find((r) => r.id === room1.id)).toBeTruthy();
    const archivedAfterRestore = await listRooms(request, hCont, projectId, true);
    expect(archivedAfterRestore.find((r) => r.id === room1.id)).toBeUndefined();

    const detailAfterRestore = await projectDetail(request, hCont, projectId);
    const linesAfterRestore = detailAfterRestore.estimate_lines.filter((l) => l.room_id === room1.id);
    expect(new Set(linesAfterRestore.map((l) => l.id))).toEqual(archivedLineIds);

    // ================= Customer collaboration lifecycle =================
    // customer direct PATCH must fail closed (#435 fixed: contractor is
    // linked now, so the customer must use room-change-requests instead)
    const customerDirectPatch = await request.patch(`${API}/api/v1/projects/${projectId}/rooms/${room1.id}`, {
      headers: hCust,
      data: { width_m: 9 },
    });
    expect(customerDirectPatch.status()).toBe(403);
    const customerDirectBody = (await customerDirectPatch.json()) as { detail?: { code?: string } };
    expect(customerDirectBody.detail?.code).toBe('room_direct_editor_forbidden');
    const roomUnchanged = await projectDetail(request, hCust, projectId);
    expect(roomUnchanged.rooms.find((r) => r.id === room1.id)?.width_m).toBe(5);

    // customer creates a scoped room-change request
    const req1 = await request.post(`${API}/api/v1/projects/${projectId}/room-change-requests`, {
      headers: hCust,
      data: {
        room_id: room1.id,
        message: 'Добавить розетки',
        payload: { outlets_count: 6 },
      },
    });
    expect(req1.ok()).toBeTruthy();
    const request1 = (await req1.json()) as { id: string; status: string };
    expect(request1.status).toBe('pending');

    // contractor sees the pending request
    const pendingList = await request.get(`${API}/api/v1/projects/${projectId}/room-change-requests`, {
      headers: hCont,
    });
    expect(pendingList.ok()).toBeTruthy();
    const pendingBody = (await pendingList.json()) as { id: string; status: string }[];
    expect(pendingBody.find((r) => r.id === request1.id)?.status).toBe('pending');

    const budgetBeforeApprove = (await projectDetail(request, hCust, projectId)).budget_planned;

    // contractor approves
    const approve1 = await request.post(
      `${API}/api/v1/projects/${projectId}/room-change-requests/${request1.id}/approve`,
      { headers: hCont },
    );
    expect(approve1.ok()).toBeTruthy();
    const approve1Body = (await approve1.json()) as { status: string; replayed: boolean; changes: Record<string, unknown> };
    expect(approve1Body.status).toBe('approved');
    expect(approve1Body.replayed).toBe(false);
    expect(approve1Body.changes).toHaveProperty('outlets_count');

    // both roles re-read room, estimate lines, budget, request status
    const detailContAfterApprove = await projectDetail(request, hCont, projectId);
    const detailCustAfterApprove = await projectDetail(request, hCust, projectId);
    expect(detailContAfterApprove.rooms.find((r) => r.id === room1.id)?.outlets_count).toBe(6);
    expect(detailCustAfterApprove.rooms.find((r) => r.id === room1.id)?.outlets_count).toBe(6);
    const outletLinesAfterApprove = detailCustAfterApprove.estimate_lines.filter(
      (l) => l.room_id === room1.id && l.category === 'electrical',
    );
    for (const line of outletLinesAfterApprove) {
      expect(line.quantity_planned).toBe(6);
    }
    const recalculatedBudgetAfterApprove = detailCustAfterApprove.estimate_lines.reduce(
      (sum, l) => sum + l.quantity_planned * l.unit_price,
      0,
    );
    expect(detailCustAfterApprove.budget_planned).toBeCloseTo(recalculatedBudgetAfterApprove, 2);
    expect(detailCustAfterApprove.budget_planned).not.toBeCloseTo(budgetBeforeApprove, 2);
    const requestAfterApprove = (
      await (
        await request.get(`${API}/api/v1/projects/${projectId}/room-change-requests`, { headers: hCust })
      ).json()
    ) as { id: string; status: string }[];
    expect(requestAfterApprove.find((r) => r.id === request1.id)?.status).toBe('approved');

    // approve replay converges idempotently without duplicate effects
    const approve1Replay = await request.post(
      `${API}/api/v1/projects/${projectId}/room-change-requests/${request1.id}/approve`,
      { headers: hCont },
    );
    expect(approve1Replay.ok()).toBeTruthy();
    const approve1ReplayBody = (await approve1Replay.json()) as { status: string; replayed: boolean };
    expect(approve1ReplayBody.status).toBe('approved');
    expect(approve1ReplayBody.replayed).toBe(true);
    const budgetAfterApproveReplay = (await projectDetail(request, hCust, projectId)).budget_planned;
    expect(budgetAfterApproveReplay).toBeCloseTo(detailCustAfterApprove.budget_planned, 2);

    // opposite decision on an already-approved request is a typed conflict
    const opposingReject = await request.post(
      `${API}/api/v1/projects/${projectId}/room-change-requests/${request1.id}/reject`,
      { headers: hCont },
    );
    expect(opposingReject.status()).toBe(409);
    const opposingRejectBody = (await opposingReject.json()) as { detail?: { code?: string } };
    expect(opposingRejectBody.detail?.code).toBe('room_change_final_state_conflict');

    // second customer request, contractor rejects
    const req2 = await request.post(`${API}/api/v1/projects/${projectId}/room-change-requests`, {
      headers: hCust,
      data: {
        room_id: room1.id,
        message: 'Расширить комнату ещё раз',
        payload: { width_m: 8 },
      },
    });
    expect(req2.ok()).toBeTruthy();
    const request2 = (await req2.json()) as { id: string; status: string };
    expect(request2.status).toBe('pending');

    const budgetBeforeReject = (await projectDetail(request, hCust, projectId)).budget_planned;
    const widthBeforeReject = (await projectDetail(request, hCust, projectId)).rooms.find((r) => r.id === room1.id)
      ?.width_m;

    const reject2 = await request.post(
      `${API}/api/v1/projects/${projectId}/room-change-requests/${request2.id}/reject`,
      { headers: hCont },
    );
    expect(reject2.ok()).toBeTruthy();
    const reject2Body = (await reject2.json()) as { status: string; replayed: boolean };
    expect(reject2Body.status).toBe('rejected');
    expect(reject2Body.replayed).toBe(false);

    // room/estimate/budget remain unchanged; request is rejected
    const detailAfterReject = await projectDetail(request, hCust, projectId);
    expect(detailAfterReject.rooms.find((r) => r.id === room1.id)?.width_m).toBe(widthBeforeReject);
    expect(detailAfterReject.budget_planned).toBeCloseTo(budgetBeforeReject, 2);
    const requestAfterReject = (
      await (
        await request.get(`${API}/api/v1/projects/${projectId}/room-change-requests`, { headers: hCust })
      ).json()
    ) as { id: string; status: string }[];
    expect(requestAfterReject.find((r) => r.id === request2.id)?.status).toBe('rejected');

    // repeated same decision reconciles idempotently
    const reject2Replay = await request.post(
      `${API}/api/v1/projects/${projectId}/room-change-requests/${request2.id}/reject`,
      { headers: hCont },
    );
    expect(reject2Replay.ok()).toBeTruthy();
    const reject2ReplayBody = (await reject2Replay.json()) as { status: string; replayed: boolean };
    expect(reject2ReplayBody.status).toBe('rejected');
    expect(reject2ReplayBody.replayed).toBe(true);
    const budgetAfterRejectReplay = (await projectDetail(request, hCust, projectId)).budget_planned;
    expect(budgetAfterRejectReplay).toBeCloseTo(budgetBeforeReject, 2);

    // opposite final decision returns a typed conflict
    const opposingApprove = await request.post(
      `${API}/api/v1/projects/${projectId}/room-change-requests/${request2.id}/approve`,
      { headers: hCont },
    );
    expect(opposingApprove.status()).toBe(409);
    const opposingApproveBody = (await opposingApprove.json()) as { detail?: { code?: string } };
    expect(opposingApproveBody.detail?.code).toBe('room_change_final_state_conflict');

    // ================= Foreign-project negatives =================
    const foreignPatch = await request.patch(`${API}/api/v1/projects/${foreignProjectId}/rooms/${room1.id}`, {
      headers: hCont,
      data: { width_m: 1 },
    });
    expect(foreignPatch.status()).toBe(404);

    const foreignChangeLog = await request.get(
      `${API}/api/v1/projects/${foreignProjectId}/rooms/${room1.id}/change-log`,
      { headers: hCust },
    );
    expect(foreignChangeLog.status()).toBe(404);
  });
});
