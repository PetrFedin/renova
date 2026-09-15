import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';

const API_BASE = (
  process.env.RENOVA_REVIEW_API_URL || 'https://renova-review-full-api.onrender.com'
).replace(/\/$/, '');

type Role = 'customer' | 'contractor';
type Session = {
  id: string;
  role: Role;
  access_token: string;
};

type ProjectDetail = {
  id: string;
  name: string;
  budget_planned: number;
  budget_spent: number;
  rooms: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string; work_type?: string | null; planned_start?: string | null; planned_end?: string | null }>;
  estimate_lines: Array<{ id: string; name: string; quantity_planned: number; unit_price: number; total: number }>;
};

type BudgetSummary = {
  budget_planned: number;
  budget_spent: number;
};

async function json<T>(response: APIResponse, allowed: number | number[] = 200): Promise<T> {
  const statuses = Array.isArray(allowed) ? allowed : [allowed];
  const text = await response.text();
  expect(
    statuses,
    `${response.url()} -> ${response.status()} ${text}`,
  ).toContain(response.status());
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

async function api(
  context: APIRequestContext,
  session: Session,
  method: string,
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  return context.fetch(`${API_BASE}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.access_token}` },
    ...(data === undefined ? {} : { data }),
  });
}

function uniquePhone(suffix: number): string {
  const tail = `${Date.now()}`.slice(-8);
  return `+79${tail}${suffix}`;
}

function requestId(kind: string): string {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function register(
  context: APIRequestContext,
  role: Role,
  suffix: number,
): Promise<Session> {
  const response = await context.post(`${API_BASE}/api/v1/auth/register`, {
    data: {
      phone: uniquePhone(suffix),
      role,
      full_name: `E2E ${role} ${Date.now()}`,
    },
  });
  const user = await json<Session>(response);
  expect(user.role).toBe(role);
  expect(user.access_token).toBeTruthy();
  return user;
}

async function project(
  context: APIRequestContext,
  session: Session,
  projectId: string,
): Promise<ProjectDetail> {
  return json<ProjectDetail>(await api(context, session, 'GET', `/projects/${projectId}`));
}

async function budget(
  context: APIRequestContext,
  session: Session,
  projectId: string,
): Promise<BudgetSummary> {
  return json<BudgetSummary>(await api(context, session, 'GET', `/projects/${projectId}/os/budget`));
}

async function proveReceiptMutation(input: {
  context: APIRequestContext;
  actor: Session;
  verifier: Session;
  projectId: string;
  amount: number;
  updatedAmount: number;
  label: string;
}) {
  const { context, actor, verifier, projectId, amount, updatedAmount, label } = input;
  const before = await budget(context, verifier, projectId);
  const clientRequestId = requestId(`receipt-${label}`);
  const payload = {
    amount,
    description: `E2E ${label} receipt`,
    expense_category: 'materials',
    client_request_id: clientRequestId,
  };

  const created = await json<{ id: string; amount: number; idempotent_replay?: boolean }>(
    await api(context, actor, 'POST', `/projects/${projectId}/receipts/manual`, payload),
  );
  expect(created.amount).toBe(amount);
  expect(created.idempotent_replay).toBeFalsy();

  const replayed = await json<{ id: string; idempotent_replay?: boolean }>(
    await api(context, actor, 'POST', `/projects/${projectId}/receipts/manual`, payload),
  );
  expect(replayed.id).toBe(created.id);
  expect(replayed.idempotent_replay).toBeTruthy();

  const listedAfterCreate = await json<Array<{ id: string; amount: number }>>(
    await api(context, verifier, 'GET', `/projects/${projectId}/receipts`),
  );
  expect(listedAfterCreate.filter((item) => item.id === created.id)).toHaveLength(1);

  const expenses = await json<Array<{ id: string; amount: number; receipt_id?: string | null }>>(
    await api(context, verifier, 'GET', `/projects/${projectId}/os/expenses`),
  );
  const linkedExpense = expenses.find((item) => item.receipt_id === created.id);
  expect(linkedExpense, 'manual receipt must create exactly one canonical linked expense').toBeTruthy();

  const protectedWrite = await api(
    context,
    actor,
    'PATCH',
    `/projects/${projectId}/os/expenses/${linkedExpense!.id}`,
    { amount: updatedAmount + 100 },
  );
  expect(protectedWrite.status(), 'source-backed expense must reject direct mutation').toBe(409);

  const afterCreate = await budget(context, verifier, projectId);
  expect(afterCreate.budget_spent).toBeCloseTo(before.budget_spent + amount, 2);

  await json(
    await api(context, actor, 'PATCH', `/projects/${projectId}/receipts/${created.id}`, {
      amount: updatedAmount,
      description: `E2E ${label} receipt updated`,
    }),
  );

  const afterPatch = await budget(context, verifier, projectId);
  expect(afterPatch.budget_spent).toBeCloseTo(before.budget_spent + updatedAmount, 2);

  const expensesAfterPatch = await json<Array<{ id: string; amount: number; receipt_id?: string | null }>>(
    await api(context, verifier, 'GET', `/projects/${projectId}/os/expenses`),
  );
  expect(expensesAfterPatch.find((item) => item.receipt_id === created.id)?.amount).toBe(updatedAmount);

  await json<{ ok: boolean; ledger_removed: boolean }>(
    await api(context, actor, 'DELETE', `/projects/${projectId}/receipts/${created.id}`),
  );

  const afterDelete = await budget(context, verifier, projectId);
  expect(afterDelete.budget_spent).toBeCloseTo(before.budget_spent, 2);

  const receiptsAfterDelete = await json<Array<{ id: string }>>(
    await api(context, verifier, 'GET', `/projects/${projectId}/receipts`),
  );
  expect(receiptsAfterDelete.some((item) => item.id === created.id)).toBeFalsy();

  const expensesAfterDelete = await json<Array<{ receipt_id?: string | null }>>(
    await api(context, verifier, 'GET', `/projects/${projectId}/os/expenses`),
  );
  expect(expensesAfterDelete.some((item) => item.receipt_id === created.id)).toBeFalsy();
}

test.describe.serial('deployed mutation proof', () => {
  test('isolated customer + contractor mutation chain stays coherent and fully cleans up', async () => {
    test.setTimeout(240_000);
    const context = await playwrightRequest.newContext();
    let customer: Session | undefined;
    let contractor: Session | undefined;
    let projectId: string | undefined;

    try {
      customer = await register(context, 'customer', 1);
      contractor = await register(context, 'contractor', 2);

      const templates = await json<{ items: Array<{ id: string; label?: string }> }>(
        await api(context, customer, 'GET', '/projects/templates'),
      );
      expect(templates.items.length).toBeGreaterThan(0);

      const created = await json<ProjectDetail>(
        await api(context, customer, 'POST', '/projects/from-template', {
          template_id: templates.items[0].id,
          name: `E2E mutation ${Date.now()}`,
          client_request_id: requestId('project'),
        }),
      );
      projectId = created.id;
      expect(created.rooms.length).toBeGreaterThan(0);

      const renamed = await json<ProjectDetail>(
        await api(context, customer, 'PATCH', `/projects/${projectId}`, {
          name: `${created.name} updated`,
        }),
      );
      expect(renamed.name).toContain('updated');
      expect((await project(context, customer, projectId)).name).toBe(renamed.name);

      await json(await api(context, customer, 'POST', `/projects/${projectId}/archive`));
      const archived = await json<Array<{ id: string }>>(
        await api(context, customer, 'GET', '/projects?bucket=archived'),
      );
      expect(archived.some((item) => item.id === projectId)).toBeTruthy();

      await json(await api(context, customer, 'POST', `/projects/${projectId}/unarchive`));
      await json(await api(context, customer, 'POST', `/projects/${projectId}/trash`));
      const trashed = await json<Array<{ id: string }>>(
        await api(context, customer, 'GET', '/projects?bucket=trashed'),
      );
      expect(trashed.some((item) => item.id === projectId)).toBeTruthy();

      await json(await api(context, customer, 'POST', `/projects/${projectId}/restore`));
      expect((await project(context, customer, projectId)).id).toBe(projectId);

      await json(
        await api(context, customer, 'POST', `/projects/${projectId}/contractor`, {
          contractor_id: contractor.id,
        }),
      );
      expect((await project(context, contractor, projectId)).id).toBe(projectId);

      const beforeEstimate = await project(context, customer, projectId);
      const estimatePayload = {
        line_type: 'work',
        name: 'E2E reversible work',
        unit: 'job',
        quantity_planned: 2,
        unit_price: 1000,
        room_id: beforeEstimate.rooms[0]?.id,
        category: 'labor',
        client_request_id: requestId('estimate-line'),
      };

      const forbiddenEstimate = await api(
        context,
        customer,
        'POST',
        `/projects/${projectId}/estimate/lines`,
        { ...estimatePayload, client_request_id: requestId('customer-forbidden-estimate') },
      );
      expect(forbiddenEstimate.status()).toBe(403);

      const estimateCreated = await json<{ id: string; idempotent_replay?: boolean }>(
        await api(context, contractor, 'POST', `/projects/${projectId}/estimate/lines`, estimatePayload),
      );
      const estimateReplay = await json<{ id: string; idempotent_replay?: boolean }>(
        await api(context, contractor, 'POST', `/projects/${projectId}/estimate/lines`, estimatePayload),
      );
      expect(estimateReplay.id).toBe(estimateCreated.id);
      expect(estimateReplay.idempotent_replay).toBeTruthy();

      const afterEstimateCreate = await project(context, customer, projectId);
      expect(afterEstimateCreate.budget_planned).toBeCloseTo(beforeEstimate.budget_planned + 2000, 2);

      await json(
        await api(context, contractor, 'PATCH', `/projects/${projectId}/estimate/lines/${estimateCreated.id}`, {
          quantity_planned: 3,
          unit_price: 1250,
        }),
      );
      const afterEstimatePatch = await project(context, customer, projectId);
      expect(afterEstimatePatch.budget_planned).toBeCloseTo(beforeEstimate.budget_planned + 3750, 2);
      const changedLine = afterEstimatePatch.estimate_lines.find((line) => line.id === estimateCreated.id);
      expect(changedLine?.total).toBeCloseTo(3750, 2);

      await json(await api(context, contractor, 'POST', `/projects/${projectId}/estimate/propose-lock`));
      const lockDiff = await json<{ has_baseline: boolean; current_total: number }>(
        await api(context, customer, 'GET', `/projects/${projectId}/estimate/lock-diff`),
      );
      expect(lockDiff.has_baseline).toBeTruthy();
      expect(lockDiff.current_total).toBeCloseTo(afterEstimatePatch.budget_planned, 2);
      await json(
        await api(context, customer, 'POST', `/projects/${projectId}/estimate/reject-lock`, {
          reason: 'E2E recovery: customer rejected draft lock',
        }),
      );
      await json(await api(context, contractor, 'POST', `/projects/${projectId}/estimate/propose-lock`));
      await json(
        await api(context, contractor, 'POST', `/projects/${projectId}/estimate/withdraw-lock`, {
          reason: 'E2E recovery: contractor withdrew draft lock',
        }),
      );

      await proveReceiptMutation({
        context,
        actor: customer,
        verifier: contractor,
        projectId,
        amount: 1000,
        updatedAmount: 1750,
        label: 'customer',
      });
      await proveReceiptMutation({
        context,
        actor: contractor,
        verifier: customer,
        projectId,
        amount: 700,
        updatedAmount: 950,
        label: 'contractor',
      });

      const start = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      const stagePayload = {
        name: `E2E stage ${Date.now()}`,
        planned_start: start,
        planned_end: end,
        room_ids: [afterEstimatePatch.rooms[0].id],
        work_type: 'painting',
        client_request_id: requestId('stage'),
      };

      const forbiddenStage = await api(
        context,
        customer,
        'POST',
        `/projects/${projectId}/stages`,
        { ...stagePayload, client_request_id: requestId('customer-forbidden-stage') },
      );
      expect(forbiddenStage.status()).toBe(403);

      const stageCreated = await json<{ id: string; replayed?: boolean }>(
        await api(context, contractor, 'POST', `/projects/${projectId}/stages`, stagePayload),
      );
      const stageReplay = await json<{ id: string; replayed?: boolean }>(
        await api(context, contractor, 'POST', `/projects/${projectId}/stages`, stagePayload),
      );
      expect(stageReplay.id).toBe(stageCreated.id);
      expect(stageReplay.replayed).toBeTruthy();

      await json(
        await api(context, contractor, 'PATCH', `/projects/${projectId}/stages/${stageCreated.id}/work-type`, {
          work_type: 'tiling',
        }),
      );
      const customerStageWrite = await api(
        context,
        customer,
        'PATCH',
        `/projects/${projectId}/stages/${stageCreated.id}/work-type`,
        { work_type: 'electrical' },
      );
      expect(customerStageWrite.status()).toBe(403);

      const afterStage = await project(context, customer, projectId);
      expect(afterStage.stages.find((stage) => stage.id === stageCreated.id)?.work_type).toBe('tiling');
      const schedule = await json<{ items: Array<{ id?: string; stage_id?: string }> }>(
        await api(context, customer, 'GET', `/projects/${projectId}/os/schedule`),
      );
      expect(
        schedule.items.some((item) => item.stage_id === stageCreated.id || item.id === stageCreated.id),
        'new stage must participate in the schedule read model',
      ).toBeTruthy();

      const issue = await json<{ id: string; status: string }>(
        await api(context, customer, 'POST', `/projects/${projectId}/issues`, {
          title: `E2E quality issue ${Date.now()}`,
          description: 'Mutation proof issue',
          severity: 'medium',
          stage_id: stageCreated.id,
        }),
      );
      expect(issue.status).toBe('open');

      const started = await json<{ status: string }>(
        await api(context, contractor, 'POST', `/projects/${projectId}/issues/${issue.id}/transition`, {
          status: 'in_progress',
        }),
      );
      expect(started.status).toBe('in_progress');

      const fixed = await json<{ status: string }>(
        await api(context, contractor, 'POST', `/projects/${projectId}/issues/${issue.id}/transition`, {
          status: 'fixed',
        }),
      );
      expect(fixed.status).toBe('fixed');

      const returned = await json<{ status: string }>(
        await api(context, customer, 'POST', `/projects/${projectId}/issues/${issue.id}/transition`, {
          status: 'open',
        }),
      );
      expect(returned.status).toBe('open');

      await json(
        await api(context, contractor, 'POST', `/projects/${projectId}/issues/${issue.id}/transition`, {
          status: 'fixed',
        }),
      );
      const closed = await json<{ status: string }>(
        await api(context, customer, 'POST', `/projects/${projectId}/issues/${issue.id}/transition`, {
          status: 'closed',
        }),
      );
      expect(closed.status).toBe('closed');

      const reopened = await json<{ status: string }>(
        await api(context, customer, 'POST', `/projects/${projectId}/issues/${issue.id}/transition`, {
          status: 'open',
        }),
      );
      expect(reopened.status).toBe('open');
      const issues = await json<Array<{ id: string; status: string }>>(
        await api(context, contractor, 'GET', `/projects/${projectId}/issues`),
      );
      expect(issues.find((item) => item.id === issue.id)?.status).toBe('open');

      await json(await api(context, customer, 'POST', `/projects/${projectId}/trash`));
      await json<{ ok: boolean }>(await api(context, customer, 'DELETE', `/projects/${projectId}`));
      const missing = await api(context, customer, 'GET', `/projects/${projectId}`);
      expect(missing.status()).toBe(404);
      projectId = undefined;
    } finally {
      if (projectId && customer) {
        await api(context, customer, 'POST', `/projects/${projectId}/trash`).catch(() => undefined);
        await api(context, customer, 'DELETE', `/projects/${projectId}`).catch(() => undefined);
      }
      if (contractor) {
        await api(context, contractor, 'DELETE', '/auth/me').catch(() => undefined);
      }
      if (customer) {
        await api(context, customer, 'DELETE', '/auth/me').catch(() => undefined);
      }
      await context.dispose();
    }
  });
});
