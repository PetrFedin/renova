/**
 * Targeted browser admission for Action Queue v2.
 * Real Expo Web + isolated API demo seed; no mocks and no skipped scenarios.
 * Writes only to a disposable E2E project and trashes it in finally.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  API,
  authHeaders,
  pickPrimaryDemoProject,
  prepareContractGateScenario,
  cleanupE2eGateProject,
  seedDemoCustomerSession,
  seedDemoContractorSession,
  type DemoProject,
  type DemoUser,
} from './helpers';

type PaymentRow = { id: string; title: string; status: string };
type AcceptanceRow = { id: string; stage_id: string; status: string };
type QueueItem = { resource_type: string; resource_id: string; responsible_user_id?: string | null };
type QueueBody = { items: QueueItem[] };

async function primaryCustomer(request: APIRequestContext) {
  const customer = (await (
    await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })
  ).json()) as DemoUser;
  const projectsResponse = await request.get(`${API}/api/v1/projects`, { headers: authHeaders(customer) });
  expect(projectsResponse.ok()).toBeTruthy();
  const project = pickPrimaryDemoProject((await projectsResponse.json()) as DemoProject[]);
  expect(project?.id).toBeTruthy();
  return { customer, project };
}

test('Home queue opens exact owned payment and closing it consumes deep link', async ({ page, request }) => {
  const { customer, project } = await primaryCustomer(request);
  const h = authHeaders(customer);
  const payResponse = await request.get(`${API}/api/v1/projects/${project.id}/payments`, { headers: h });
  expect(payResponse.ok()).toBeTruthy();
  const payments = (await payResponse.json()) as PaymentRow[];
  const qResponse = await request.get(`${API}/api/v1/projects/${project.id}/actions/responsibility`, { headers: h });
  expect(qResponse.ok()).toBeTruthy();
  const queue = (await qResponse.json()) as QueueBody;
  const owned = queue.items.find((item) =>
    item.resource_type === 'payment' && item.responsible_user_id === customer.id
      && payments.some((p) => p.id === item.resource_id));
  expect(owned, 'demo seeded customer must own an actionable payment').toBeTruthy();
  const expected = payments.find((p) => p.id === owned!.resource_id);
  expect(expected).toBeDefined();

  await seedDemoCustomerSession(page, customer.id, project.id, customer.access_token);
  await page.goto('/');
  const card = page.getByTestId('home-action-queue');
  await expect(card).toBeVisible({ timeout: 20_000 });
  const expand = card.getByRole('button', { name: 'Показать все действия' });
  if (await expand.isVisible().catch(() => false)) await expand.click();
  const action = card.getByTestId(`action-queue:payment:${owned!.resource_id}`);
  for (let attempt = 0; attempt < 15 && await action.count() === 0; attempt += 1) {
    const more = card.getByRole('button', { name: /Показать ещё/ });
    if (await more.count() === 0) break;
    await more.click();
  }
  await expect(action).toBeVisible();
  await action.click();

  await expect(page).toHaveURL(/\/budget\?/);
  expect(new URL(page.url()).searchParams.get('paymentId')).toBe(owned!.resource_id);
  const sheet = page.getByTestId('payment-detail-sheet');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByText(expected!.title, { exact: true })).toBeVisible();

  await sheet.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has('paymentId')).toBe(false);
  await page.waitForTimeout(500);
  await expect(sheet).toHaveCount(0);
});

test('unknown explicit paymentId never opens a different pending invoice', async ({ page, request }) => {
  const { customer, project } = await primaryCustomer(request);
  const h = authHeaders(customer);
  const payments = await request.get(`${API}/api/v1/projects/${project.id}/payments`, { headers: h });
  expect(payments.ok()).toBeTruthy();
  expect(((await payments.json()) as PaymentRow[]).length).toBeGreaterThan(0);

  await seedDemoCustomerSession(page, customer.id, project.id, customer.access_token);
  await page.goto('/budget?tab=payments&paymentId=unknown-action-queue-payment');
  await expect(page.getByText(/Указанный счёт недоступен в этом проекте/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('payment-detail-sheet')).toHaveCount(0);
});

test('targeted pending acceptance is visible, while missing ID cannot choose another', async ({ page, request }) => {
  const { customer, project } = await primaryCustomer(request);
  const h = authHeaders(customer);
  const response = await request.get(`${API}/api/v1/projects/${project.id}/work-acceptances`, { headers: h });
  expect(response.ok()).toBeTruthy();
  const rows = (await response.json()) as AcceptanceRow[];
  const pending = rows.find((row) => row.status === 'requested' || row.status === 'in_review');
  expect(pending, 'demo must provide pending acceptance').toBeDefined();

  await seedDemoCustomerSession(page, customer.id, project.id, customer.access_token);
  await page.goto(`/repair?tab=control&acceptanceId=${encodeURIComponent(pending!.id)}`);
  await expect(page.getByTestId('action-target-acceptance')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('action-target-acceptance-missing')).toHaveCount(0);

  await page.goto('/repair?tab=control&acceptanceId=missing-acceptance');
  await expect(page.getByTestId('action-target-acceptance-missing')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('action-target-acceptance')).toHaveCount(0);
});

test('scoped issue deep link focuses correct customer/contractor row, not another project', async ({ page, browser, request }) => {
  test.setTimeout(150_000);
  const scenario = await prepareContractGateScenario(request);
  const { customer, contractor, projectId, stageId } = scenario;
  const title = `Проверка адресного замечания ${Date.now()}`;
  try {
    const issueResponse = await request.post(`${API}/api/v1/projects/${projectId}/issues`, {
      headers: authHeaders(customer),
      data: { title, description: 'Изолированный браузерный тест', severity: 'medium', stage_id: stageId },
    });
    expect(issueResponse.ok(), `create issue: ${issueResponse.status()}`).toBeTruthy();
    const issue = (await issueResponse.json()) as { id: string };
    expect(issue.id).toBeTruthy();

    await seedDemoCustomerSession(page, customer.id, projectId, customer.access_token);
    await page.goto(`/repair?tab=control&issueId=${encodeURIComponent(issue.id)}`);
    await expect(page.getByTestId('action-target-issue')).toContainText(title, { timeout: 20_000 });

    const contractorPage = await browser.newPage();
    try {
      await seedDemoContractorSession(contractorPage, contractor.id, projectId, contractor.access_token);
      await contractorPage.goto(`/repair?tab=control&issueId=${encodeURIComponent(issue.id)}`);
      await expect(contractorPage.getByTestId('action-target-issue')).toContainText(title, { timeout: 20_000 });
    } finally {
      await contractorPage.close();
    }

    const listed = await request.get(`${API}/api/v1/projects`, { headers: authHeaders(customer) });
    expect(listed.ok()).toBeTruthy();
    const demo = pickPrimaryDemoProject((await listed.json()) as DemoProject[]);
    expect(demo.id).not.toBe(projectId);
    await seedDemoCustomerSession(page, customer.id, demo.id, customer.access_token);
    await page.goto(`/repair?tab=control&issueId=${encodeURIComponent(issue.id)}`);
    await expect(page.getByTestId('action-target-issue-missing')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('action-target-issue')).toHaveCount(0);
    await expect(page.getByText(title)).toHaveCount(0);
  } finally {
    await cleanupE2eGateProject(request, customer, projectId);
  }
});
