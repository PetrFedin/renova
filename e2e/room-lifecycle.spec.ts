/**
 * #439 — room mutation lifecycle on the canonical API runtime.
 *
 * Direct room mutation belongs to the assigned contractor-side editor.
 * Customer collaboration after assignment is a Room Change request/decision flow.
 * The pre-contractor customer-edit contradiction is intentionally not normalized
 * here; #435 owns that product-contract repair.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, authHeaders, type DemoUser } from './helpers';

type EstimateLine = {
  id: string;
  room_id?: string | null;
  room_name?: string | null;
  category?: string | null;
  name: string;
  quantity_planned: number;
  unit_price: number;
  total: number;
};

type Room = {
  id: string;
  name: string;
  width_m: number;
  outlets_count: number;
  is_archived?: boolean;
};

type ProjectDetail = {
  id: string;
  name: string;
  budget_planned: number;
  contractor_id?: string | null;
  rooms: Room[];
  estimate_lines: EstimateLine[];
};

type RoomChangeRequest = {
  id: string;
  room_id: string;
  status: string;
  message: string;
  payload?: Record<string, unknown> | null;
};

function projectPayload(name: string) {
  return {
    name,
    address: 'Room lifecycle E2E',
    renovation_type: 'cosmetic',
    property_type: 'apartment',
    total_area_sqm: 12,
    rooms: [
      {
        name: 'Стартовая комната',
        room_type: 'living',
        length_m: 4,
        width_m: 3,
        height_m: 2.7,
        outlets_count: 1,
        switches_count: 1,
        plumbing_points: 0,
      },
    ],
  };
}

async function readProject(
  request: APIRequestContext,
  projectId: string,
  headers: Record<string, string>,
): Promise<ProjectDetail> {
  const response = await request.get(`${API}/api/v1/projects/${projectId}`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json()) as ProjectDetail;
}

function roomLines(project: ProjectDetail, roomId: string): EstimateLine[] {
  return project.estimate_lines.filter((line) => line.room_id === roomId);
}

function assertBudgetReconciled(project: ProjectDetail) {
  const estimateTotal = project.estimate_lines.reduce((sum, line) => sum + Number(line.total || 0), 0);
  expect(project.budget_planned).toBeCloseTo(estimateTotal, 2);
}

async function prepareAssignedProject(request: APIRequestContext) {
  const customer = (await (
    await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })
  ).json()) as DemoUser;
  const contractor = (await (
    await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })
  ).json()) as DemoUser;
  const customerHeaders = authHeaders(customer);
  const contractorHeaders = authHeaders(contractor);

  const created = await request.post(`${API}/api/v1/projects`, {
    headers: customerHeaders,
    data: projectPayload(`Room lifecycle ${Date.now()}`),
  });
  expect(created.status()).toBe(200);
  const project = (await created.json()) as ProjectDetail;

  await request.post(`${API}/api/v1/subscription/checkout`, { headers: contractorHeaders });
  const assigned = await request.post(`${API}/api/v1/projects/${project.id}/assign`, {
    headers: contractorHeaders,
  });
  expect(assigned.ok()).toBeTruthy();

  return { customer, contractor, customerHeaders, contractorHeaders, projectId: project.id };
}

test.describe('P0 room mutation lifecycle', () => {
  test('contractor create → update → derived estimate/budget → archive → restore; customer request approve/reject', async ({ request }) => {
    const {
      customerHeaders,
      contractorHeaders,
      projectId,
    } = await prepareAssignedProject(request);

    try {
      const beforeCreate = await readProject(request, projectId, contractorHeaders);
      const budgetBeforeCreate = beforeCreate.budget_planned;

      const createRoom = await request.post(`${API}/api/v1/projects/${projectId}/rooms`, {
        headers: contractorHeaders,
        data: {
          name: 'E2E гостиная',
          room_type: 'living',
          floor_level: 1,
          length_m: 4,
          width_m: 3,
          height_m: 2.7,
          openings_sq_m: 2,
          outlets_count: 2,
          switches_count: 1,
          plumbing_points: 0,
          client_request_id: `room-e2e-create-${Date.now()}`,
        },
      });
      expect(createRoom.status()).toBe(200);
      const createdRoom = (await createRoom.json()) as Room;
      const roomId = createdRoom.id;

      const contractorRoomsAfterCreate = (await (
        await request.get(`${API}/api/v1/projects/${projectId}/rooms`, { headers: contractorHeaders })
      ).json()) as Room[];
      const customerRoomsAfterCreate = (await (
        await request.get(`${API}/api/v1/projects/${projectId}/rooms`, { headers: customerHeaders })
      ).json()) as Room[];
      expect(contractorRoomsAfterCreate.some((room) => room.id === roomId)).toBe(true);
      expect(customerRoomsAfterCreate.some((room) => room.id === roomId)).toBe(true);

      const afterCreate = await readProject(request, projectId, contractorHeaders);
      expect(afterCreate.budget_planned).toBeGreaterThan(budgetBeforeCreate);
      expect(roomLines(afterCreate, roomId).length).toBeGreaterThan(0);
      expect(
        roomLines(afterCreate, roomId).filter((line) => line.category === 'electrical').every((line) => line.quantity_planned === 2),
      ).toBe(true);
      assertBudgetReconciled(afterCreate);

      const lineIdsAfterCreate = roomLines(afterCreate, roomId).map((line) => line.id).sort();
      const budgetBeforeDirectUpdate = afterCreate.budget_planned;

      const directUpdate = await request.patch(`${API}/api/v1/projects/${projectId}/rooms/${roomId}`, {
        headers: contractorHeaders,
        data: { width_m: 5, outlets_count: 4 },
      });
      expect(directUpdate.status()).toBe(200);
      const updatedRoom = (await directUpdate.json()) as Room;
      expect(updatedRoom.width_m).toBe(5);
      expect(updatedRoom.outlets_count).toBe(4);

      const afterDirectUpdate = await readProject(request, projectId, contractorHeaders);
      const customerAfterDirectUpdate = await readProject(request, projectId, customerHeaders);
      expect(afterDirectUpdate.rooms.find((room) => room.id === roomId)?.width_m).toBe(5);
      expect(customerAfterDirectUpdate.rooms.find((room) => room.id === roomId)?.width_m).toBe(5);
      expect(afterDirectUpdate.budget_planned).not.toBe(budgetBeforeDirectUpdate);
      expect(
        roomLines(afterDirectUpdate, roomId).filter((line) => line.category === 'electrical').every((line) => line.quantity_planned === 4),
      ).toBe(true);
      expect(roomLines(afterDirectUpdate, roomId).map((line) => line.id).sort()).toEqual(lineIdsAfterCreate);
      assertBudgetReconciled(afterDirectUpdate);

      const changeLog = (await (
        await request.get(`${API}/api/v1/projects/${projectId}/rooms/${roomId}/change-log`, {
          headers: contractorHeaders,
        })
      ).json()) as { field: string; old: string; new: string; at: string }[];
      expect(changeLog.some((entry) => entry.field === 'width_m' && entry.new === '5.0')).toBe(true);
      expect(changeLog.some((entry) => entry.field === 'outlets_count' && entry.new === '4')).toBe(true);

      // Once an executor is attached, customer direct mutation must fail closed.
      const customerDirectPatch = await request.patch(`${API}/api/v1/projects/${projectId}/rooms/${roomId}`, {
        headers: customerHeaders,
        data: { width_m: 6 },
      });
      expect(customerDirectPatch.status()).toBe(403);
      expect((await readProject(request, projectId, customerHeaders)).rooms.find((room) => room.id === roomId)?.width_m).toBe(5);

      // Customer collaboration path: request → contractor approval → shared derived truth.
      const requestApprove = await request.post(`${API}/api/v1/projects/${projectId}/room-change-requests`, {
        headers: customerHeaders,
        data: {
          room_id: roomId,
          message: 'Сделать комнату шире и добавить розетку',
          payload: { width_m: 6, outlets_count: 5 },
        },
      });
      expect(requestApprove.status()).toBe(200);
      const approvalRequest = (await requestApprove.json()) as { id: string; status: string };
      expect(approvalRequest.status).toBe('pending');

      const contractorPending = (await (
        await request.get(`${API}/api/v1/projects/${projectId}/room-change-requests`, {
          headers: contractorHeaders,
        })
      ).json()) as RoomChangeRequest[];
      expect(contractorPending.find((entry) => entry.id === approvalRequest.id)?.status).toBe('pending');

      const approve = await request.post(
        `${API}/api/v1/projects/${projectId}/room-change-requests/${approvalRequest.id}/approve`,
        { headers: contractorHeaders },
      );
      expect(approve.status()).toBe(200);
      const approvedBody = (await approve.json()) as {
        status: string;
        replayed: boolean;
        changes: Record<string, unknown>;
      };
      expect(approvedBody.status).toBe('approved');
      expect(approvedBody.replayed).toBe(false);
      expect(Object.keys(approvedBody.changes).sort()).toEqual(['outlets_count', 'width_m']);

      const approveReplay = await request.post(
        `${API}/api/v1/projects/${projectId}/room-change-requests/${approvalRequest.id}/approve`,
        { headers: contractorHeaders },
      );
      expect(approveReplay.status()).toBe(200);
      expect(((await approveReplay.json()) as { replayed: boolean }).replayed).toBe(true);
      const oppositeAfterApprove = await request.post(
        `${API}/api/v1/projects/${projectId}/room-change-requests/${approvalRequest.id}/reject`,
        { headers: contractorHeaders },
      );
      expect(oppositeAfterApprove.status()).toBe(409);

      const afterApproval = await readProject(request, projectId, contractorHeaders);
      const customerAfterApproval = await readProject(request, projectId, customerHeaders);
      expect(afterApproval.rooms.find((room) => room.id === roomId)?.width_m).toBe(6);
      expect(afterApproval.rooms.find((room) => room.id === roomId)?.outlets_count).toBe(5);
      expect(customerAfterApproval.rooms.find((room) => room.id === roomId)?.width_m).toBe(6);
      expect(
        roomLines(afterApproval, roomId).filter((line) => line.category === 'electrical').every((line) => line.quantity_planned === 5),
      ).toBe(true);
      assertBudgetReconciled(afterApproval);
      const budgetAfterApproval = afterApproval.budget_planned;
      const roomStateAfterApproval = afterApproval.rooms.find((room) => room.id === roomId);

      // Rejection is a terminal business reversal: it must not mutate room/estimate/budget truth.
      const requestReject = await request.post(`${API}/api/v1/projects/${projectId}/room-change-requests`, {
        headers: customerHeaders,
        data: {
          room_id: roomId,
          message: 'Не применять этот вариант',
          payload: { width_m: 7 },
        },
      });
      expect(requestReject.status()).toBe(200);
      const rejectionRequest = (await requestReject.json()) as { id: string; status: string };

      const reject = await request.post(
        `${API}/api/v1/projects/${projectId}/room-change-requests/${rejectionRequest.id}/reject`,
        { headers: contractorHeaders },
      );
      expect(reject.status()).toBe(200);
      expect(((await reject.json()) as { status: string }).status).toBe('rejected');

      const rejectReplay = await request.post(
        `${API}/api/v1/projects/${projectId}/room-change-requests/${rejectionRequest.id}/reject`,
        { headers: contractorHeaders },
      );
      expect(rejectReplay.status()).toBe(200);
      expect(((await rejectReplay.json()) as { replayed: boolean }).replayed).toBe(true);
      const oppositeAfterReject = await request.post(
        `${API}/api/v1/projects/${projectId}/room-change-requests/${rejectionRequest.id}/approve`,
        { headers: contractorHeaders },
      );
      expect(oppositeAfterReject.status()).toBe(409);

      const afterReject = await readProject(request, projectId, contractorHeaders);
      expect(afterReject.budget_planned).toBeCloseTo(budgetAfterApproval, 2);
      expect(afterReject.rooms.find((room) => room.id === roomId)).toEqual(roomStateAfterApproval);
      expect(roomLines(afterReject, roomId)).toEqual(roomLines(afterApproval, roomId));
      const customerRequests = (await (
        await request.get(`${API}/api/v1/projects/${projectId}/room-change-requests`, {
          headers: customerHeaders,
        })
      ).json()) as RoomChangeRequest[];
      expect(customerRequests.find((entry) => entry.id === rejectionRequest.id)?.status).toBe('rejected');

      // Room removal semantics are reversible archive/restore, not a hard delete.
      const beforeArchive = await readProject(request, projectId, contractorHeaders);
      const budgetBeforeArchive = beforeArchive.budget_planned;
      const linkedLinesBeforeArchive = roomLines(beforeArchive, roomId);

      const archive = await request.patch(`${API}/api/v1/projects/${projectId}/rooms/${roomId}`, {
        headers: contractorHeaders,
        data: { is_archived: true },
      });
      expect(archive.status()).toBe(200);
      expect(((await archive.json()) as Room).is_archived).toBe(true);

      const activeAfterArchive = (await (
        await request.get(`${API}/api/v1/projects/${projectId}/rooms`, { headers: contractorHeaders })
      ).json()) as Room[];
      const archivedAfterArchive = (await (
        await request.get(`${API}/api/v1/projects/${projectId}/rooms?archived=true`, { headers: contractorHeaders })
      ).json()) as Room[];
      expect(activeAfterArchive.some((room) => room.id === roomId)).toBe(false);
      expect(archivedAfterArchive.some((room) => room.id === roomId)).toBe(true);

      const projectAfterArchive = await readProject(request, projectId, customerHeaders);
      expect(projectAfterArchive.budget_planned).toBeCloseTo(budgetBeforeArchive, 2);
      expect(roomLines(projectAfterArchive, roomId)).toEqual(linkedLinesBeforeArchive);
      assertBudgetReconciled(projectAfterArchive);

      const restore = await request.patch(`${API}/api/v1/projects/${projectId}/rooms/${roomId}`, {
        headers: contractorHeaders,
        data: { is_archived: false },
      });
      expect(restore.status()).toBe(200);
      expect(((await restore.json()) as Room).is_archived).toBe(false);

      const contractorActiveAfterRestore = (await (
        await request.get(`${API}/api/v1/projects/${projectId}/rooms`, { headers: contractorHeaders })
      ).json()) as Room[];
      const customerActiveAfterRestore = (await (
        await request.get(`${API}/api/v1/projects/${projectId}/rooms`, { headers: customerHeaders })
      ).json()) as Room[];
      expect(contractorActiveAfterRestore.some((room) => room.id === roomId)).toBe(true);
      expect(customerActiveAfterRestore.some((room) => room.id === roomId)).toBe(true);

      const projectAfterRestore = await readProject(request, projectId, contractorHeaders);
      expect(projectAfterRestore.budget_planned).toBeCloseTo(budgetBeforeArchive, 2);
      expect(roomLines(projectAfterRestore, roomId)).toEqual(linkedLinesBeforeArchive);
      assertBudgetReconciled(projectAfterRestore);
    } finally {
      await request.post(`${API}/api/v1/projects/${projectId}/trash`, { headers: customerHeaders }).catch(() => undefined);
    }
  });
});