import { test, expect } from '@playwright/test';
import { API, authHeaders, cleanupE2eGateProject, prepareContractGateScenario } from '../helpers';

test.describe('@golden @gp5 invoice → settlement evidence → expense → dispute/refund', () => {
  test('contractor invoice → customer transfer → receipt → one recognized expense → dispute handoff', async ({ request }) => {
    const s = await prepareContractGateScenario(request);
    const hC = authHeaders(s.customer);
    const hE = authHeaders(s.contractor);
    try {
      const invoice = await request.post(`${API}/api/v1/projects/${s.projectId}/payments`, {
        headers: hE,
        data: {
          title: 'Golden materials invoice',
          payment_type: 'material',
          amount: 5000,
          client_request_id: `gp5-pay-${Date.now()}`,
        },
      });
      expect(invoice.ok()).toBeTruthy();
      const paymentId = ((await invoice.json()) as { id: string }).id;

      const contractorCannotConfirm = await request.post(
        `${API}/api/v1/projects/${s.projectId}/payments/${paymentId}/confirm`,
        { headers: hE, data: { transfer_ack: true } },
      );
      expect(contractorCannotConfirm.status()).toBe(403);

      const confirmed = await request.post(
        `${API}/api/v1/projects/${s.projectId}/payments/${paymentId}/confirm`,
        { headers: hC, data: { transfer_ack: true } },
      );
      expect(confirmed.ok()).toBeTruthy();
      expect((await confirmed.json()).status).toBe('paid_unverified');

      const contractorReceipt = await request.post(
        `${API}/api/v1/projects/${s.projectId}/receipts/manual`,
        { headers: hE, data: { payment_id: paymentId, amount: 5000, description: 'Получатель не подтверждает оплату за плательщика' } },
      );
      expect(contractorReceipt.status()).toBe(403);

      const receipt = await request.post(
        `${API}/api/v1/projects/${s.projectId}/receipts/manual`,
        {
          headers: hC,
          data: {
            payment_id: paymentId,
            amount: 5000,
            description: 'Golden settlement evidence',
            expense_category: 'materials',
            client_request_id: `gp5-rcpt-${Date.now()}`,
          },
        },
      );
      expect(receipt.ok()).toBeTruthy();

      const payments = (await (
        await request.get(`${API}/api/v1/projects/${s.projectId}/payments`, { headers: hC })
      ).json()) as Array<{ id: string; status: string }>;
      expect(payments.find((p) => p.id === paymentId)?.status).toBe('confirmed');

      const expenses = (await (
        await request.get(`${API}/api/v1/projects/${s.projectId}/os/expenses`, { headers: hC })
      ).json()) as Array<{ payment_id?: string; amount: number; status: string }>;
      const recognized = expenses.filter((e) => e.payment_id === paymentId && e.status === 'confirmed');
      expect(recognized, 'One economic operation must create one recognized expense').toHaveLength(1);
      expect(Number(recognized[0].amount)).toBe(5000);

      const dispute = await request.post(
        `${API}/api/v1/projects/${s.projectId}/payments/${paymentId}/dispute`,
        { headers: hC, data: { reason: 'Платёж оспаривается: работа по счёту выполнена не полностью' } },
      );
      expect(dispute.ok()).toBeTruthy();
      expect((await dispute.json()).payment.status).toBe('disputed');

      const response = await request.post(
        `${API}/api/v1/projects/${s.projectId}/payments/${paymentId}/dispute/respond`,
        { headers: hE, data: { response: 'contest', comment: 'Не согласен, объём подтверждён перепиской и актом' } },
      );
      expect(response.ok()).toBeTruthy();
    } finally {
      await cleanupE2eGateProject(request, s.customer, s.projectId);
    }
  });

  test('simulated provider exposes a deterministic refund transition for recovery testing', async ({ request }) => {
    const response = await request.post(`${API}/api/v1/dev/providers/payment/non-existent/refund`, {
      data: { amount: 1, idempotency_key: ['gp5', 'refund', 'contract'].join('-') },
    });
    expect(
      response.status(),
      'GP5 cannot be complete until the simulated payment provider has a dev refund transition usable by E2E',
    ).not.toBe(404);
  });
});
