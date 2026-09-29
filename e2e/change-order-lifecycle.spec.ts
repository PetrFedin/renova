/**
 * #446 — Change Order lifecycle E2E: role authority, budget/document truth,
 * replay-safety and terminal-conflict handling on fresh projects/data.
 */
import { test, expect } from '@playwright/test';
import { API, authHeaders, DemoUser } from './helpers';

async function createAssignedProject(
  request: import('@playwright/test').APIRequestContext,
  hCust: Record<string, string>,
  hCont: Record<string, string>,
  contractorId: string,
): Promise<string> {
  const created = await request.post(`${API}/api/v1/projects`, {
    headers: hCust,
    data: {
      name: `CO Lifecycle ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      address: 'E2E',
      renovation_type: 'cosmetic',
      property_type: 'apartment',
      total_area_sqm: 40,
      rooms: [{ name: 'Комната', area_sqm: 20, length_m: 5, width_m: 4 }],
    },
  });
  if (!created.ok()) throw new Error(`create project failed: ${created.status()}`);
  const pid = ((await created.json()) as { id: string }).id;

  await request.post(`${API}/api/v1/subscription/checkout`, { headers: hCont });
  const assigned = await request.post(`${API}/api/v1/projects/${pid}/assign`, { headers: hCont });
  if (!assigned.ok()) throw new Error(`assign failed: ${assigned.status()}`);
  return pid;
}

async function budgetPlanned(
  request: import('@playwright/test').APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
): Promise<number> {
  const detail = await (await request.get(`${API}/api/v1/projects/${projectId}`, { headers })).json();
  return Number(detail.budget_planned ?? 0);
}

async function linkedDocCount(
  request: import('@playwright/test').APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
  orderId: string,
): Promise<number> {
  const docs = (await (
    await request.get(`${API}/api/v1/projects/${projectId}/documents`, { headers })
  ).json()) as { items: { meta?: { change_order_id?: string | null } }[] };
  return docs.items.filter((item) => item.meta?.change_order_id === orderId).length;
}

test.describe('#446 Change Order lifecycle', () => {
  test('role authority, budget/document truth, replay and terminal conflict', async ({ request }) => {
    const cont = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })).json()) as DemoUser;
    const cust = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json()) as DemoUser;
    const guest = (await (await request.post(`${API}/api/v1/auth/demo/guest`, { data: {} })).json()) as DemoUser & { phone?: string };
    const hCont = authHeaders(cont);
    const hCust = authHeaders(cust);
    const hGuest = authHeaders(guest);

    const projectId = await createAssignedProject(request, hCust, hCont, cont.id);
    const foreignProjectId = await createAssignedProject(request, hCust, hCont, cont.id);

    // Grant the demo guest read-only viewer access to the primary project so
    // the negative "guest decision denied" case has an actually-scoped user.
    const guestPhone = (guest as { phone?: string }).phone;
    if (guestPhone) {
      const shared = await request.post(`${API}/api/v1/projects/${projectId}/viewers`, {
        headers: hCust,
        data: { phone: guestPhone },
      });
      expect(shared.ok()).toBeTruthy();
    }

    // ---- Contractor -> customer APPROVE path -----------------------------
    const requestId1 = `co-approve-${Date.now()}`;
    const create1 = await request.post(`${API}/api/v1/projects/${projectId}/change-orders`, {
      headers: hCont,
      data: { title: 'Доп. работы: розетки', amount: 15000, client_request_id: requestId1 },
    });
    expect(create1.ok()).toBeTruthy();
    const co1 = (await create1.json()) as { id: string; status: string; replayed: boolean };
    expect(co1.status).toBe('pending');
    expect(co1.replayed).toBe(false);

    // create replay-safety: identical client_request_id must not create a duplicate order
    const create1Replay = await request.post(`${API}/api/v1/projects/${projectId}/change-orders`, {
      headers: hCont,
      data: { title: 'Доп. работы: розетки', amount: 15000, client_request_id: requestId1 },
    });
    expect(create1Replay.ok()).toBeTruthy();
    const co1Replay = (await create1Replay.json()) as { id: string; replayed: boolean };
    expect(co1Replay.id).toBe(co1.id);
    expect(co1Replay.replayed).toBe(true);

    // customer direct create is 403
    const customerCreate = await request.post(`${API}/api/v1/projects/${projectId}/change-orders`, {
      headers: hCust,
      data: { title: 'Illegit customer CO', amount: 1000 },
    });
    expect(customerCreate.status()).toBe(403);

    // both roles list/read the pending order
    const listContBefore = (await (
      await request.get(`${API}/api/v1/projects/${projectId}/change-orders`, { headers: hCont })
    ).json()) as { id: string; status: string }[];
    expect(listContBefore.find((o) => o.id === co1.id)?.status).toBe('pending');
    const listCustBefore = (await (
      await request.get(`${API}/api/v1/projects/${projectId}/change-orders`, { headers: hCust })
    ).json()) as { id: string; status: string }[];
    expect(listCustBefore.find((o) => o.id === co1.id)?.status).toBe('pending');

    // contractor direct approve/reject is 403
    const contractorApprove = await request.post(
      `${API}/api/v1/projects/${projectId}/change-orders/${co1.id}/approve`,
      { headers: hCont },
    );
    expect(contractorApprove.status()).toBe(403);
    const contractorReject = await request.post(
      `${API}/api/v1/projects/${projectId}/change-orders/${co1.id}/reject`,
      { headers: hCont },
    );
    expect(contractorReject.status()).toBe(403);

    // guest/read-only decision denied without partial state
    if (guestPhone) {
      const guestApprove = await request.post(
        `${API}/api/v1/projects/${projectId}/change-orders/${co1.id}/approve`,
        { headers: hGuest },
      );
      expect(guestApprove.status()).toBe(403);
      const stillPending = (await (
        await request.get(`${API}/api/v1/projects/${projectId}/change-orders`, { headers: hCust })
      ).json()) as { id: string; status: string }[];
      expect(stillPending.find((o) => o.id === co1.id)?.status).toBe('pending');
    }

    const budgetBeforeApprove = await budgetPlanned(request, hCust, projectId);

    // customer approves
    const approve1 = await request.post(
      `${API}/api/v1/projects/${projectId}/change-orders/${co1.id}/approve`,
      { headers: hCust },
    );
    expect(approve1.ok()).toBeTruthy();
    const approve1Body = (await approve1.json()) as {
      status: string;
      document_id: string | null;
      replayed: boolean;
    };
    expect(approve1Body.status).toBe('approved');
    expect(approve1Body.replayed).toBe(false);
    expect(approve1Body.document_id).toBeTruthy();

    // both roles re-read approved
    const listContAfter = (await (
      await request.get(`${API}/api/v1/projects/${projectId}/change-orders`, { headers: hCont })
    ).json()) as { id: string; status: string }[];
    expect(listContAfter.find((o) => o.id === co1.id)?.status).toBe('approved');
    const listCustAfter = (await (
      await request.get(`${API}/api/v1/projects/${projectId}/change-orders`, { headers: hCust })
    ).json()) as { id: string; status: string }[];
    expect(listCustAfter.find((o) => o.id === co1.id)?.status).toBe('approved');

    // budget_planned increased exactly once by the CO amount
    const budgetAfterApprove = await budgetPlanned(request, hCust, projectId);
    expect(budgetAfterApprove).toBeCloseTo(budgetBeforeApprove + 15000, 5);

    // exactly one linked draft document exists
    const docCountAfterApprove = await linkedDocCount(request, hCust, projectId, co1.id);
    expect(docCountAfterApprove).toBe(1);

    // same approve replay converges: same final state/document, no double effects
    const approve1Replay = await request.post(
      `${API}/api/v1/projects/${projectId}/change-orders/${co1.id}/approve`,
      { headers: hCust },
    );
    expect(approve1Replay.ok()).toBeTruthy();
    const approve1ReplayBody = (await approve1Replay.json()) as {
      status: string;
      document_id: string | null;
      replayed: boolean;
    };
    expect(approve1ReplayBody.status).toBe('approved');
    expect(approve1ReplayBody.replayed).toBe(true);
    expect(approve1ReplayBody.document_id).toBe(approve1Body.document_id);
    const budgetAfterReplay = await budgetPlanned(request, hCust, projectId);
    expect(budgetAfterReplay).toBeCloseTo(budgetAfterApprove, 5);
    const docCountAfterReplay = await linkedDocCount(request, hCust, projectId, co1.id);
    expect(docCountAfterReplay).toBe(1);

    // opposite reject on an already-approved order is a typed 409 conflict
    const opposingReject = await request.post(
      `${API}/api/v1/projects/${projectId}/change-orders/${co1.id}/reject`,
      { headers: hCust },
    );
    expect(opposingReject.status()).toBe(409);
    const opposingRejectBody = (await opposingReject.json()) as { detail?: { code?: string } };
    expect(opposingRejectBody.detail?.code).toBe('change_order_final_state_conflict');

    // ---- Contractor -> customer REJECT path -------------------------------
    const requestId2 = `co-reject-${Date.now()}`;
    const create2 = await request.post(`${API}/api/v1/projects/${projectId}/change-orders`, {
      headers: hCont,
      data: { title: 'Доп. работы: демонтаж', amount: 8000, client_request_id: requestId2 },
    });
    expect(create2.ok()).toBeTruthy();
    const co2 = (await create2.json()) as { id: string; status: string };
    expect(co2.status).toBe('pending');

    const budgetBeforeReject = await budgetPlanned(request, hCust, projectId);
    const docCountBeforeReject = await linkedDocCount(request, hCust, projectId, co2.id);

    const reject2 = await request.post(
      `${API}/api/v1/projects/${projectId}/change-orders/${co2.id}/reject`,
      { headers: hCust },
    );
    expect(reject2.ok()).toBeTruthy();
    const reject2Body = (await reject2.json()) as { status: string; replayed: boolean };
    expect(reject2Body.status).toBe('rejected');
    expect(reject2Body.replayed).toBe(false);

    // both roles re-read rejected
    const listContRejected = (await (
      await request.get(`${API}/api/v1/projects/${projectId}/change-orders`, { headers: hCont })
    ).json()) as { id: string; status: string }[];
    expect(listContRejected.find((o) => o.id === co2.id)?.status).toBe('rejected');
    const listCustRejected = (await (
      await request.get(`${API}/api/v1/projects/${projectId}/change-orders`, { headers: hCust })
    ).json()) as { id: string; status: string }[];
    expect(listCustRejected.find((o) => o.id === co2.id)?.status).toBe('rejected');

    // budget and documents remain unchanged
    const budgetAfterReject = await budgetPlanned(request, hCust, projectId);
    expect(budgetAfterReject).toBeCloseTo(budgetBeforeReject, 5);
    const docCountAfterReject = await linkedDocCount(request, hCust, projectId, co2.id);
    expect(docCountAfterReject).toBe(docCountBeforeReject);

    // same reject replay converges without duplicate effects
    const reject2Replay = await request.post(
      `${API}/api/v1/projects/${projectId}/change-orders/${co2.id}/reject`,
      { headers: hCust },
    );
    expect(reject2Replay.ok()).toBeTruthy();
    const reject2ReplayBody = (await reject2Replay.json()) as { status: string; replayed: boolean };
    expect(reject2ReplayBody.status).toBe('rejected');
    expect(reject2ReplayBody.replayed).toBe(true);
    const budgetAfterRejectReplay = await budgetPlanned(request, hCust, projectId);
    expect(budgetAfterRejectReplay).toBeCloseTo(budgetBeforeReject, 5);

    // opposite approve on an already-rejected order is a typed 409 conflict
    const opposingApprove = await request.post(
      `${API}/api/v1/projects/${projectId}/change-orders/${co2.id}/approve`,
      { headers: hCust },
    );
    expect(opposingApprove.status()).toBe(409);
    const opposingApproveBody = (await opposingApprove.json()) as { detail?: { code?: string } };
    expect(opposingApproveBody.detail?.code).toBe('change_order_final_state_conflict');

    // ---- Authority / scope negatives --------------------------------------
    // foreign-project order ID under another authorized project path -> privacy 404
    const foreignLookup = await request.post(
      `${API}/api/v1/projects/${foreignProjectId}/change-orders/${co1.id}/approve`,
      { headers: hCust },
    );
    expect(foreignLookup.status()).toBe(404);

    // nonexistent order under the real project path also stays 404
    const missingLookup = await request.post(
      `${API}/api/v1/projects/${projectId}/change-orders/does-not-exist/approve`,
      { headers: hCust },
    );
    expect(missingLookup.status()).toBe(404);
  });
});
