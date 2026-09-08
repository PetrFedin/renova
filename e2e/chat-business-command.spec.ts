/** Complete local/API chat -> work/payment -> authoritative reads, no providers. */
import { test, expect } from '@playwright/test';
import { API, authHeaders, cleanupE2eGateProject, type DemoUser } from './helpers';

test('chat business commands survive identical replay and preserve domain links', async ({ request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  async function register(role: 'customer' | 'contractor', prefix: string) {
    const phone = `${prefix}${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;
    const response = await request.post(`${API}/api/v1/auth/register`, {
      data: { phone, role, full_name: `Command E2E ${role} ${suffix}` },
    });
    expect(response.status(), await response.text()).toBe(200);
    return await response.json() as DemoUser;
  }
  const customer = await register('customer', '+799');
  const contractor = await register('contractor', '+798');
  const ch = authHeaders(customer), wh = authHeaders(contractor);
  const created = await request.post(`${API}/api/v1/projects/from-template`, {
    headers: ch, data: { template_id: 'studio', name: `Command E2E ${suffix}`, client_request_id: `project-${suffix}` },
  });
  expect(created.status(), await created.text()).toBe(200);
  const projectId = (await created.json()).id as string;
  const projectPath = `${API}/api/v1/projects/${projectId}`;
  try {
    const assigned = await request.post(`${projectPath}/contractor`, { headers: ch, data: { contractor_id: contractor.id } });
    expect(assigned.status(), await assigned.text()).toBe(200);
    const threadResponse = await request.post(`${projectPath}/chats`, { headers: ch, data: { title: 'Business commands', topic: 'commands' } });
    expect(threadResponse.status()).toBe(200);
    const threadId = (await threadResponse.json()).id;
    const threadPath = `${projectPath}/chats/${threadId}`;
    const sourceResponse = await request.post(`${threadPath}/messages`, { headers: ch, data: { text: 'Repair request', client_request_id: `message-${suffix}` } });
    expect(sourceResponse.status()).toBe(200);
    const sourceId = (await sourceResponse.json()).id;
    const taskBody = { title: 'Repair from chat', assignee_id: contractor.id, due_at: '2026-10-01', client_request_id: `task-${suffix}` };
    const taskPath = `${threadPath}/messages/${sourceId}/task`;
    const firstTask = await request.post(taskPath, { headers: wh, data: taskBody });
    expect(firstTask.status(), await firstTask.text()).toBe(200);
    const work = await firstTask.json();
    const replayTask = await request.post(taskPath, { headers: wh, data: taskBody });
    expect((await replayTask.json()).id).toBe(work.id);
    expect((await request.post(taskPath, { headers: wh, data: { ...taskBody, title: 'Different' } })).status()).toBe(409);
    const invoiceBody = { title: 'Material invoice', amount: 1234.56, payment_type: 'material', client_request_id: `invoice-${suffix}` };
    const invoicePath = `${threadPath}/invoice`;
    expect((await request.post(invoicePath, { headers: ch, data: invoiceBody })).status()).toBe(403);
    const firstInvoice = await request.post(invoicePath, { headers: wh, data: invoiceBody });
    expect(firstInvoice.status(), await firstInvoice.text()).toBe(200);
    const invoice = await firstInvoice.json();
    const replayInvoice = await request.post(invoicePath, { headers: wh, data: invoiceBody });
    expect(replayInvoice.status()).toBe(200);
    expect((await replayInvoice.json()).id).toBe(invoice.id);
    expect((await request.post(invoicePath, { headers: wh, data: { ...invoiceBody, amount: 2000 } })).status()).toBe(409);
    const taskRows = await (await request.get(`${projectPath}/work-orders`, { headers: ch })).json();
    expect(taskRows.filter((row: { id: string }) => row.id === work.work_order_id)).toHaveLength(1);
    const paymentRows = await (await request.get(`${projectPath}/payments`, { headers: ch })).json();
    const matching = paymentRows.filter((row: { id: string }) => row.id === invoice.payment_id);
    expect(matching).toHaveLength(1);
    expect(matching[0].status).toBe('pending');
    expect(matching[0].amount).toBe(1234.56);
    const detail = await (await request.get(threadPath, { headers: ch })).json();
    expect(detail.messages.filter((row: { id: string }) => row.id === invoice.id)).toHaveLength(1);
    expect(detail.messages.find((row: { id: string }) => row.id === sourceId).work_order_id).toBe(work.work_order_id);
  } finally {
    await cleanupE2eGateProject(request, customer, projectId);
  }
});
