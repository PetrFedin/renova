import { expect, test } from '@playwright/test';

import {
  API,
  apiReachable,
  authHeaders,
  cleanupE2eGateProject,
  prepareContractGateScenario,
  seedDemoContractorSession,
  seedDemoCustomerSession,
  webReachable,
} from './helpers';

const RESULT_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZKygAAAAASUVORK5CYII=';

async function prepareActiveStage(request: import('@playwright/test').APIRequestContext) {
  const scenario = await prepareContractGateScenario(request);
  const { customer, contractor, projectId, stageId, documentId } = scenario;
  const hCust = authHeaders(customer);
  const hCont = authHeaders(contractor);

  const signCustomer = await request.post(
    `${API}/api/v1/projects/${projectId}/documents/${documentId}/sign`,
    { headers: hCust, data: { provider: 'in_app' } },
  );
  expect(signCustomer.ok()).toBeTruthy();

  const signContractor = await request.post(
    `${API}/api/v1/projects/${projectId}/documents/${documentId}/sign`,
    { headers: hCont, data: { provider: 'in_app' } },
  );
  expect(signContractor.ok()).toBeTruthy();

  const started = await request.post(
    `${API}/api/v1/projects/${projectId}/stages/${stageId}/start`,
    { headers: hCont },
  );
  expect(started.ok()).toBeTruthy();
  expect((await started.json()).status).toBe('active');
  return scenario;
}

async function satisfyCompletion(
  request: import('@playwright/test').APIRequestContext,
  projectId: string,
  stageId: string,
  contractor: { access_token: string; id: string },
) {
  const hCont = authHeaders(contractor as any);
  const workflowResponse = await request.get(
    `${API}/api/v1/projects/${projectId}/stages/${stageId}/workflow`,
    { headers: hCont },
  );
  expect(workflowResponse.ok()).toBeTruthy();
  const workflow = (await workflowResponse.json()) as {
    checklist?: Array<{ id: string; done: boolean }>;
  };

  for (const item of workflow.checklist || []) {
    if (item.done) continue;
    const toggled = await request.post(
      `${API}/api/v1/projects/${projectId}/stages/${stageId}/checklist/toggle`,
      { headers: hCont, data: { item_id: item.id, done: true } },
    );
    expect(toggled.ok()).toBeTruthy();
  }

  const photo = await request.post(
    `${API}/api/v1/projects/${projectId}/stages/${stageId}/photos`,
    {
      headers: hCont,
      data: {
        image_data: RESULT_IMAGE,
        caption: 'Результат после выполнения работ',
      },
    },
  );
  expect(photo.ok()).toBeTruthy();

  const completionResponse = await request.get(
    `${API}/api/v1/projects/${projectId}/stages/${stageId}/completion-check`,
    { headers: hCont },
  );
  expect(completionResponse.ok()).toBeTruthy();
  const completion = (await completionResponse.json()) as {
    ok: boolean;
    failed: Array<{ id: string; message: string }>;
  };
  expect(completion.failed, JSON.stringify(completion.failed)).toEqual([]);
  expect(completion.ok).toBe(true);
}

test('contractor evidence → submit → customer accept → document/payment cascade', async ({ browser, request }) => {
  test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');

  const scenario = await prepareActiveStage(request);
  const { customer, contractor, projectId, stageId } = scenario;
  const hCust = authHeaders(customer);
  const hCont = authHeaders(contractor);

  const contractorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const customerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const contractorPage = await contractorContext.newPage();
  const customerPage = await customerContext.newPage();

  try {
    await satisfyCompletion(request, projectId, stageId, contractor);

    const beforeStageResponse = await request.get(
      `${API}/api/v1/projects/${projectId}/stages/${stageId}`,
      { headers: hCont },
    );
    expect(beforeStageResponse.ok()).toBeTruthy();
    const beforeStage = (await beforeStageResponse.json()) as {
      payment_amount?: number | null;
      status: string;
    };
    expect(beforeStage.status).toBe('active');
    const stageAmount = Number(beforeStage.payment_amount || 0);

    await seedDemoContractorSession(
      contractorPage,
      contractor.id,
      projectId,
      contractor.access_token,
    );
    await contractorPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    await expect(contractorPage.getByTestId('stage-status')).toHaveText('В работе', { timeout: 20_000 });
    const submit = contractorPage.getByRole('button', {
      name: /^(На приёмку|Готово — на приёмку|Сдать повторно)$/,
    });
    await expect(submit).toBeVisible({ timeout: 20_000 });
    await submit.click();

    await expect
      .poll(async () => {
        const response = await request.get(
          `${API}/api/v1/projects/${projectId}/stages/${stageId}`,
          { headers: hCont },
        );
        return ((await response.json()) as { status: string }).status;
      }, { timeout: 20_000 })
      .toBe('review');

    const pendingResponse = await request.get(
      `${API}/api/v1/projects/${projectId}/work-acceptances?stage_id=${encodeURIComponent(stageId)}`,
      { headers: hCust },
    );
    expect(pendingResponse.ok()).toBeTruthy();
    const pending = (await pendingResponse.json()) as Array<{ id: string; status: string }>;
    expect(pending.some((item) => ['requested', 'in_review'].includes(item.status))).toBe(true);

    await seedDemoCustomerSession(customerPage, customer.id, projectId, customer.access_token);
    await customerPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    await expect(customerPage.getByRole('button', { name: 'Принять' }).first()).toBeVisible({ timeout: 20_000 });
    await expect(customerPage.getByRole('button', { name: 'Вернуть на доработку' })).toBeVisible();

    await customerPage.getByRole('button', { name: 'Принять' }).first().click();
    await expect(customerPage.getByText('Принять этап?', { exact: true })).toBeVisible({ timeout: 10_000 });
    await customerPage.getByRole('button', { name: 'Принять' }).last().click();

    await expect
      .poll(async () => {
        const response = await request.get(
          `${API}/api/v1/projects/${projectId}/stages/${stageId}`,
          { headers: hCust },
        );
        return ((await response.json()) as { status: string }).status;
      }, { timeout: 20_000 })
      .toBe('done');

    const acceptanceResponse = await request.get(
      `${API}/api/v1/projects/${projectId}/work-acceptances?stage_id=${encodeURIComponent(stageId)}`,
      { headers: hCust },
    );
    const acceptances = (await acceptanceResponse.json()) as Array<{ id: string; status: string }>;
    const accepted = acceptances.find((item) => item.status === 'accepted' || item.status === 'accepted_with_remarks');
    expect(accepted).toBeTruthy();

    const docsResponse = await request.get(
      `${API}/api/v1/projects/${projectId}/documents`,
      { headers: hCust },
    );
    expect(docsResponse.ok()).toBeTruthy();
    const docsPayload = (await docsResponse.json()) as {
      items?: Array<{ document_type?: string; work_acceptance_id?: string | null }>;
    };
    expect(
      (docsPayload.items || []).some(
        (doc) => doc.document_type === 'acceptance_act' && doc.work_acceptance_id === accepted!.id,
      ),
    ).toBe(true);

    const paymentsResponse = await request.get(
      `${API}/api/v1/projects/${projectId}/payments`,
      { headers: hCust },
    );
    expect(paymentsResponse.ok()).toBeTruthy();
    const payments = (await paymentsResponse.json()) as Array<{ stage_id?: string; amount?: number; status?: string }>;
    const stagePayments = payments.filter((payment) => payment.stage_id === stageId);
    if (stageAmount > 0.01) {
      expect(stagePayments.length).toBeGreaterThan(0);
      expect(stagePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)).toBeGreaterThan(0);
    }

    await customerPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    await expect(customerPage.getByTestId('stage-status')).toContainText(/Заверш|Принят|Готов/i, { timeout: 20_000 });
    await customerPage.screenshot({ path: 'test-results/handoff-accepted-stage.png', fullPage: true });
  } finally {
    await contractorContext.close();
    await customerContext.close();
    await cleanupE2eGateProject(request, customer, projectId);
  }
});


test('customer return → contractor sees reason → resubmit → customer accepts', async ({ browser, request }) => {
  test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');

  const scenario = await prepareActiveStage(request);
  const { customer, contractor, projectId, stageId } = scenario;
  const hCust = authHeaders(customer);
  const hCont = authHeaders(contractor);
  const reason = 'Исправить примыкание у стены и повторно показать результат';

  const contractorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const customerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const contractorPage = await contractorContext.newPage();
  const customerPage = await customerContext.newPage();

  try {
    await satisfyCompletion(request, projectId, stageId, contractor);

    await seedDemoContractorSession(
      contractorPage,
      contractor.id,
      projectId,
      contractor.access_token,
    );
    await contractorPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    const submit = contractorPage.getByRole('button', {
      name: /^(На приёмку|Готово — на приёмку|Сдать повторно)$/,
    });
    await expect(submit).toBeVisible({ timeout: 20_000 });
    await submit.click();

    await expect
      .poll(async () => {
        const response = await request.get(
          `${API}/api/v1/projects/${projectId}/stages/${stageId}`,
          { headers: hCont },
        );
        return ((await response.json()) as { status: string }).status;
      }, { timeout: 20_000 })
      .toBe('review');

    await seedDemoCustomerSession(customerPage, customer.id, projectId, customer.access_token);
    await customerPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    const returnButton = customerPage.getByRole('button', { name: 'Вернуть на доработку' });
    await expect(returnButton).toBeVisible({ timeout: 20_000 });
    await returnButton.click();

    const reasonInput = customerPage.getByPlaceholder('Что нужно исправить (обязательно)…');
    await expect(reasonInput).toBeVisible({ timeout: 10_000 });
    const confirmReturn = customerPage.getByRole('button', { name: 'Вернуть', exact: true });
    await expect(confirmReturn).toBeDisabled();
    await reasonInput.fill(reason);
    await expect(confirmReturn).toBeEnabled();
    await confirmReturn.click();

    await expect
      .poll(async () => {
        const response = await request.get(
          `${API}/api/v1/projects/${projectId}/stages/${stageId}`,
          { headers: hCust },
        );
        const body = (await response.json()) as { status: string; needs_rework?: boolean };
        return `${body.status}:${Boolean(body.needs_rework)}`;
      }, { timeout: 20_000 })
      .toBe('active:true');

    const returnedResponse = await request.get(
      `${API}/api/v1/projects/${projectId}/work-acceptances?stage_id=${encodeURIComponent(stageId)}`,
      { headers: hCust },
    );
    const returnedAcceptances = (await returnedResponse.json()) as Array<{
      status: string;
      comment?: string | null;
    }>;
    expect(
      returnedAcceptances.some(
        (item) => item.status === 'returned' && (item.comment || '').includes('Исправить примыкание'),
      ),
    ).toBe(true);

    await contractorPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    await expect(contractorPage.getByText('Заказчик вернул этап на доработку', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(contractorPage.locator('body')).toContainText('Исправить примыкание');
    await contractorPage.screenshot({ path: 'test-results/handoff-rework-contractor.png', fullPage: true });

    const workflowResponse = await request.get(
      `${API}/api/v1/projects/${projectId}/stages/${stageId}/workflow`,
      { headers: hCont },
    );
    expect(workflowResponse.ok()).toBeTruthy();
    const workflow = (await workflowResponse.json()) as {
      checklist?: Array<{ id: string; done: boolean; text?: string }>;
    };
    const undone = (workflow.checklist || []).filter((item) => !item.done);
    expect(undone.length).toBeGreaterThan(0);
    for (const item of undone) {
      const toggled = await request.post(
        `${API}/api/v1/projects/${projectId}/stages/${stageId}/checklist/toggle`,
        { headers: hCont, data: { item_id: item.id, done: true } },
      );
      expect(toggled.ok()).toBeTruthy();
    }

    const completionResponse = await request.get(
      `${API}/api/v1/projects/${projectId}/stages/${stageId}/completion-check`,
      { headers: hCont },
    );
    const completion = (await completionResponse.json()) as {
      ok: boolean;
      failed: Array<{ id: string; message: string }>;
    };
    expect(completion.failed, JSON.stringify(completion.failed)).toEqual([]);
    expect(completion.ok).toBe(true);

    await contractorPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    const resubmit = contractorPage.getByRole('button', { name: 'Сдать повторно' });
    await expect(resubmit).toBeVisible({ timeout: 20_000 });
    await resubmit.click();

    await expect
      .poll(async () => {
        const response = await request.get(
          `${API}/api/v1/projects/${projectId}/stages/${stageId}`,
          { headers: hCont },
        );
        return ((await response.json()) as { status: string }).status;
      }, { timeout: 20_000 })
      .toBe('review');

    await customerPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    await expect(customerPage.getByRole('button', { name: 'Принять' }).first()).toBeVisible({ timeout: 20_000 });
    await customerPage.getByRole('button', { name: 'Принять' }).first().click();
    await expect(customerPage.getByText('Принять этап?', { exact: true })).toBeVisible({ timeout: 10_000 });
    await customerPage.getByRole('button', { name: 'Принять' }).last().click();

    await expect
      .poll(async () => {
        const response = await request.get(
          `${API}/api/v1/projects/${projectId}/stages/${stageId}`,
          { headers: hCust },
        );
        const body = (await response.json()) as { status: string; needs_rework?: boolean };
        return `${body.status}:${Boolean(body.needs_rework)}`;
      }, { timeout: 20_000 })
      .toBe('done:false');

    const finalAcceptanceResponse = await request.get(
      `${API}/api/v1/projects/${projectId}/work-acceptances?stage_id=${encodeURIComponent(stageId)}`,
      { headers: hCust },
    );
    const finalAcceptances = (await finalAcceptanceResponse.json()) as Array<{ id: string; status: string }>;
    const accepted = finalAcceptances.find(
      (item) => item.status === 'accepted' || item.status === 'accepted_with_remarks',
    );
    expect(accepted).toBeTruthy();

    const docsResponse = await request.get(
      `${API}/api/v1/projects/${projectId}/documents`,
      { headers: hCust },
    );
    const docsPayload = (await docsResponse.json()) as {
      items?: Array<{ document_type?: string; work_acceptance_id?: string | null }>;
    };
    expect(
      (docsPayload.items || []).some(
        (doc) => doc.document_type === 'acceptance_act' && doc.work_acceptance_id === accepted!.id,
      ),
    ).toBe(true);

    await customerPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    await expect(customerPage.getByTestId('stage-status')).toContainText(/Заверш|Принят|Готов/i, { timeout: 20_000 });
    await customerPage.screenshot({ path: 'test-results/handoff-rework-accepted.png', fullPage: true });
  } finally {
    await contractorContext.close();
    await customerContext.close();
    await cleanupE2eGateProject(request, customer, projectId);
  }
});
