/**
 * #446 — Change Order lifecycle as a connected role-separated product path.
 *
 * Proves create/replay, customer decision authority, budget/document truth,
 * same-decision replay and typed opposite-terminal conflict.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, authHeaders, type DemoUser } from './helpers';

type ProjectDetail = {
  id: string;
  budget_planned: number;
};

type ChangeOrderRow = {
  id: string;
  title: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  description?: string | null;
};

type DocumentRow = {
  id: string;
  source: string;
  status: string;
  title: string;
};

type DocumentsPayload = {
  items: DocumentRow[];
  counts: { canonical: number };
};

function projectPayload(name: string) {
  return {
    name,
    address: 'Change Order lifecycle E2E',
    renovation_type: 'cosmetic',
    property_type: 'apartment',
    total_area_sqm: 12,
    rooms: [
      {
        name: 'Гостиная',
        room_type: 'living',
        length_m: 4,
        width_m: 3,
        height_m: 2.7,
        outlets_count: 2,
        switches_count: 1,
        plumbing_points: 0,
      },
    ],
  };
}

async function readProject(
  request: APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
): Promise<ProjectDetail> {
  const response = await request.get(`${API}/api/v1/projects/${projectId}`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json()) as ProjectDetail;
}

async function listOrders(
  request: APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
): Promise<ChangeOrderRow[]> {
  const response = await request.get(`${API}/api/v1/projects/${projectId}/change-orders`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json()) as ChangeOrderRow[];
}

async function listDocuments(
  request: APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
): Promise<DocumentsPayload> {
  const response = await request.get(`${API}/api/v1/projects/${projectId}/documents`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json()) as DocumentsPayload;
}

async function createProject(
  request: APIRequestContext,
  headers: Record<string, string>,
  name: string,
): Promise<string> {
  const response = await request.post(`${API}/api/v1/projects`, {
    headers,
    data: projectPayload(name),
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { id: string }).id;
}

async function createOrder(
  request: APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
  body: { title: string; amount: number; description: string; client_request_id: string },
) {
  return request.post(`${API}/api/v1/projects/${projectId}/change-orders`, {
    headers,
    data: body,
  });
}

test.describe('P0 Change Order lifecycle', () => {
  test('create → shared read → approve/reject → budget/document reconciliation → replay/conflict', async ({ request }) => {
    const customer = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })
    ).json()) as DemoUser;
    const contractor = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })
    ).json()) as DemoUser;
    const customerHeaders = authHeaders(customer);
    const contractorHeaders = authHeaders(contractor);

    const marker = Date.now();
    const projectId = await createProject(request, customerHeaders, `CO lifecycle ${marker}`);
    const foreignProjectId = await createProject(request, customerHeaders, `CO foreign ${marker}`);

    try {
      await request.post(`${API}/api/v1/subscription/checkout`, { headers: contractorHeaders });
      expect((await request.post(`${API}/api/v1/projects/${projectId}/assign`, { headers: contractorHeaders })).ok()).toBeTruthy();
      expect((await request.post(`${API}/api/v1/projects/${foreignProjectId}/assign`, { headers: contractorHeaders })).ok()).toBeTruthy();

      const customerCreate = await createOrder(request, customerHeaders, projectId, {
        title: 'Заказчик не создаёт CO',
        amount: 100,
        description: 'forbidden',
        client_request_id: `co-customer-forbidden-${marker}`,
      });
      expect(customerCreate.status()).toBe(403);

      const approveAmount = 1234.56;
      const approveIntent = {
        title: 'Дополнительная шумоизоляция',
        amount: approveAmount,
        description: 'Добавить второй слой шумоизоляции',
        client_request_id: `co-approve-${marker}`,
      };
      const created = await createOrder(request, contractorHeaders, projectId, approveIntent);
      expect(created.status()).toBe(200);
      const createdBody = (await created.json()) as { id: string; status: string; replayed: boolean };
      expect(createdBody.status).toBe('pending');
      expect(createdBody.replayed).toBe(false);
      const approveOrderId = createdBody.id;

      const createReplay = await createOrder(request, contractorHeaders, projectId, approveIntent);
      expect(createReplay.status()).toBe(200);
      const createReplayBody = (await createReplay.json()) as { id: string; status: string; replayed: boolean };
      expect(createReplayBody).toEqual({ id: approveOrderId, status: 'pending', replayed: true });

      const contractorRowsBeforeDecision = await listOrders(request, contractorHeaders, projectId);
      const customerRowsBeforeDecision = await listOrders(request, customerHeaders, projectId);
      expect(contractorRowsBeforeDecision.filter((row) => row.id === approveOrderId)).toHaveLength(1);
      expect(customerRowsBeforeDecision.find((row) => row.id === approveOrderId)?.status).toBe('pending');

      const contractorCannotApprove = await request.post(
        `${API}/api/v1/projects/${projectId}/change-orders/${approveOrderId}/approve`,
        { headers: contractorHeaders },
      );
      expect(contractorCannotApprove.status()).toBe(403);
      const contractorCannotReject = await request.post(
        `${API}/api/v1/projects/${projectId}/change-orders/${approveOrderId}/reject`,
        { headers: contractorHeaders },
      );
      expect(contractorCannotReject.status()).toBe(403);

      const beforeApprove = await readProject(request, customerHeaders, projectId);
      const docsBeforeApprove = await listDocuments(request, customerHeaders, projectId);

      const approved = await request.post(
        `${API}/api/v1/projects/${projectId}/change-orders/${approveOrderId}/approve`,
        { headers: customerHeaders },
      );
      expect(approved.status()).toBe(200);
      const approvedBody = (await approved.json()) as {
        status: string;
        document_id: string;
        amount: number;
        replayed: boolean;
      };
      expect(approvedBody.status).toBe('approved');
      expect(approvedBody.amount).toBeCloseTo(approveAmount, 2);
      expect(approvedBody.replayed).toBe(false);
      expect(approvedBody.document_id).toBeTruthy();

      const afterApprove = await readProject(request, customerHeaders, projectId);
      expect(afterApprove.budget_planned).toBeCloseTo(beforeApprove.budget_planned + approveAmount, 2);

      const customerRowsAfterApprove = await listOrders(request, customerHeaders, projectId);
      const contractorRowsAfterApprove = await listOrders(request, contractorHeaders, projectId);
      expect(customerRowsAfterApprove.find((row) => row.id === approveOrderId)?.status).toBe('approved');
      expect(contractorRowsAfterApprove.find((row) => row.id === approveOrderId)?.status).toBe('approved');

      const docsAfterApprove = await listDocuments(request, customerHeaders, projectId);
      expect(docsAfterApprove.counts.canonical).toBe(docsBeforeApprove.counts.canonical + 1);
      expect(docsAfterApprove.items.filter((item) => item.id === approvedBody.document_id)).toHaveLength(1);
      expect(docsAfterApprove.items.find((item) => item.id === approvedBody.document_id)).toMatchObject({
        source: 'canonical',
        status: 'draft',
      });

      const approveReplay = await request.post(
        `${API}/api/v1/projects/${projectId}/change-orders/${approveOrderId}/approve`,
        { headers: customerHeaders },
      );
      expect(approveReplay.status()).toBe(200);
      const approveReplayBody = (await approveReplay.json()) as {
        status: string;
        document_id: string;
        replayed: boolean;
      };
      expect(approveReplayBody).toMatchObject({
        status: 'approved',
        document_id: approvedBody.document_id,
        replayed: true,
      });
      const afterApproveReplay = await readProject(request, customerHeaders, projectId);
      expect(afterApproveReplay.budget_planned).toBeCloseTo(afterApprove.budget_planned, 2);
      const docsAfterApproveReplay = await listDocuments(request, customerHeaders, projectId);
      expect(docsAfterApproveReplay.counts.canonical).toBe(docsAfterApprove.counts.canonical);
      expect(docsAfterApproveReplay.items.filter((item) => item.id === approvedBody.document_id)).toHaveLength(1);

      const oppositeReject = await request.post(
        `${API}/api/v1/projects/${projectId}/change-orders/${approveOrderId}/reject`,
        { headers: customerHeaders },
      );
      expect(oppositeReject.status()).toBe(409);
      expect((await oppositeReject.json()) as { detail?: { code?: string } }).toMatchObject({
        detail: { code: 'change_order_final_state_conflict' },
      });
      expect((await readProject(request, customerHeaders, projectId)).budget_planned).toBeCloseTo(afterApprove.budget_planned, 2);

      // Foreign order ID under another project path remains privacy 404, not terminal conflict.
      const foreignCreated = await createOrder(request, contractorHeaders, foreignProjectId, {
        title: 'Чужой CO',
        amount: 321,
        description: 'foreign scope',
        client_request_id: `co-foreign-${marker}`,
      });
      expect(foreignCreated.status()).toBe(200);
      const foreignOrderId = ((await foreignCreated.json()) as { id: string }).id;
      const crossProjectDecision = await request.post(
        `${API}/api/v1/projects/${projectId}/change-orders/${foreignOrderId}/approve`,
        { headers: customerHeaders },
      );
      expect(crossProjectDecision.status()).toBe(404);

      // Reject path: no budget or document mutation, but same-decision replay converges.
      const rejectAmount = 777.77;
      const rejectCreated = await createOrder(request, contractorHeaders, projectId, {
        title: 'Необязательная ниша',
        amount: rejectAmount,
        description: 'Заказчик отклоняет',
        client_request_id: `co-reject-${marker}`,
      });
      expect(rejectCreated.status()).toBe(200);
      const rejectOrderId = ((await rejectCreated.json()) as { id: string }).id;
      const budgetBeforeReject = (await readProject(request, customerHeaders, projectId)).budget_planned;
      const docsBeforeReject = await listDocuments(request, customerHeaders, projectId);

      const rejected = await request.post(
        `${API}/api/v1/projects/${projectId}/change-orders/${rejectOrderId}/reject`,
        { headers: customerHeaders },
      );
      expect(rejected.status()).toBe(200);
      expect(await rejected.json()).toMatchObject({ status: 'rejected', replayed: false });

      expect((await readProject(request, customerHeaders, projectId)).budget_planned).toBeCloseTo(budgetBeforeReject, 2);
      const docsAfterReject = await listDocuments(request, customerHeaders, projectId);
      expect(docsAfterReject.counts.canonical).toBe(docsBeforeReject.counts.canonical);
      expect((await listOrders(request, contractorHeaders, projectId)).find((row) => row.id === rejectOrderId)?.status).toBe('rejected');
      expect((await listOrders(request, customerHeaders, projectId)).find((row) => row.id === rejectOrderId)?.status).toBe('rejected');

      const rejectReplay = await request.post(
        `${API}/api/v1/projects/${projectId}/change-orders/${rejectOrderId}/reject`,
        { headers: customerHeaders },
      );
      expect(rejectReplay.status()).toBe(200);
      expect(await rejectReplay.json()).toMatchObject({ status: 'rejected', replayed: true });
      expect((await readProject(request, customerHeaders, projectId)).budget_planned).toBeCloseTo(budgetBeforeReject, 2);
      expect((await listDocuments(request, customerHeaders, projectId)).counts.canonical).toBe(docsBeforeReject.counts.canonical);

      const oppositeApprove = await request.post(
        `${API}/api/v1/projects/${projectId}/change-orders/${rejectOrderId}/approve`,
        { headers: customerHeaders },
      );
      expect(oppositeApprove.status()).toBe(409);
      expect((await oppositeApprove.json()) as { detail?: { code?: string } }).toMatchObject({
        detail: { code: 'change_order_final_state_conflict' },
      });
      expect((await readProject(request, customerHeaders, projectId)).budget_planned).toBeCloseTo(budgetBeforeReject, 2);
    } finally {
      await request.post(`${API}/api/v1/projects/${projectId}/trash`, { headers: customerHeaders }).catch(() => undefined);
      await request.post(`${API}/api/v1/projects/${foreignProjectId}/trash`, { headers: customerHeaders }).catch(() => undefined);
    }
  });
});