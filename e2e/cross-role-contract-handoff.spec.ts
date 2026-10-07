import { expect, test, type Page } from '@playwright/test';

import {
  apiReachable,
  webReachable,
  prepareContractGateScenario,
  seedDemoCustomerSession,
  seedDemoContractorSession,
  cleanupE2eGateProject,
  API,
  authHeaders,
} from './helpers';

async function signPendingDocument(page: Page) {
  const pending = page.getByRole('button', { name: /^Подписать:/ }).first();
  await expect(pending).toBeVisible({ timeout: 20_000 });
  await pending.click();

  const inApp = page.getByRole('button', { name: 'Подписать в приложении' });
  await expect(inApp).toBeVisible({ timeout: 10_000 });
  await inApp.click();

  const confirm = page.getByRole('button', { name: 'Подписать', exact: true });
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.click();

  await expect(page.getByText('Подписано', { exact: true })).toBeVisible({ timeout: 20_000 });
  const closeConfirmation = page.getByRole('button', { name: /Закрыть/ }).first();
  if (await closeConfirmation.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await closeConfirmation.click();
  }
}

test('customer → contractor contract handoff → stage start → customer sees active state', async ({ browser, request }) => {
  test.setTimeout(120_000);
  test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');

  const scenario = await prepareContractGateScenario(request);
  const { customer, contractor, projectId, stageId } = scenario;
  const customerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const contractorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const customerPage = await customerContext.newPage();
  const contractorPage = await contractorContext.newPage();
  const startTransport: string[] = [];
  contractorPage.on('requestfailed', (req) => {
    if (req.url().includes(`/stages/${stageId}/start`)) {
      startTransport.push(`requestfailed:${req.failure()?.errorText || 'unknown'}`);
    }
  });
  contractorPage.on('response', (res) => {
    if (res.url().includes(`/stages/${stageId}/start`)) {
      startTransport.push(`response:${res.request().method()}:${res.status()}`);
    }
  });
  contractorPage.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const value = msg.text();
      if (/cors|fetch|network|stage|start/i.test(value)) startTransport.push(`console:${msg.type()}:${value}`);
    }
  });

  try {
    await seedDemoCustomerSession(customerPage, customer.id, projectId, customer.access_token);
    await seedDemoContractorSession(contractorPage, contractor.id, projectId, contractor.access_token);

    await contractorPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    await expect(contractorPage.getByText('Перед началом работ', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(contractorPage.getByRole('button', { name: 'К документам' })).toBeVisible();
    await contractorPage.screenshot({ path: 'test-results/handoff-contractor-gate.png', fullPage: true });

    await customerPage.goto('/documents', { waitUntil: 'domcontentloaded' });
    await expect(customerPage.getByText('Нужно подписать (1)', { exact: true })).toBeVisible({ timeout: 20_000 });
    await signPendingDocument(customerPage);
    await customerPage.screenshot({ path: 'test-results/handoff-customer-signed.png', fullPage: true });

    await contractorPage.goto('/documents', { waitUntil: 'domcontentloaded' });
    await expect(contractorPage.getByText('Нужно подписать (1)', { exact: true })).toBeVisible({ timeout: 20_000 });
    await signPendingDocument(contractorPage);
    await contractorPage.screenshot({ path: 'test-results/handoff-contractor-signed.png', fullPage: true });

    await contractorPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    const start = contractorPage.getByRole('button', { name: /^Начать(?: этап)?$/ });
    await expect(start).toBeVisible({ timeout: 20_000 });
    await expect(contractorPage.getByText('Перед началом работ', { exact: true })).toBeHidden({ timeout: 10_000 });
    await start.click();
    await expect(contractorPage.getByTestId('stage-status')).toContainText('В работе', { timeout: 20_000 });
    await expect(contractorPage.getByText('Нет сети', { exact: true })).toBeHidden({ timeout: 2_000 });
    await expect.poll(() => startTransport.includes('response:POST:200'), { timeout: 20_000 }).toBe(true);

    const apiStage = await request.get(`${API}/api/v1/projects/${projectId}/stages/${stageId}`, {
      headers: authHeaders(contractor),
    });
    expect(apiStage.ok()).toBeTruthy();
    const apiStageBody = await apiStage.json();
    expect(apiStageBody.status).toBe('active');

    await customerPage.goto(`/stage/${stageId}`, { waitUntil: 'domcontentloaded' });
    await expect(customerPage.getByTestId('stage-status')).toContainText('В работе', { timeout: 20_000 });
    await customerPage.screenshot({ path: 'test-results/handoff-customer-active-stage.png', fullPage: true });
  } finally {
    await customerContext.close();
    await contractorContext.close();
    await cleanupE2eGateProject(request, customer, projectId);
  }
});
