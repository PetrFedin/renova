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

      const receiptPayload = {
        payment_id: paymentId,
        amount: 5000,
        description: 'Golden settlement evidence',
        expense_category: 'materials',
        client_request_id: `gp5-rcpt-${Date.now()}`,
      };
      const receipt = await request.post(
        `${API}/api/v1/projects/${s.projectId}/receipts/manual`,
        {
          headers: hC,
          data: receiptPayload,
        },
      );
      expect(receipt.ok()).toBeTruthy();
      const receiptId = (await receipt.json()).id;
      const receiptReplay = await request.post(
        `${API}/api/v1/projects/${s.projectId}/receipts/manual`,
        { headers: hC, data: receiptPayload },
      );
      expect(receiptReplay.ok(), 'Committed receipt must survive a response-loss retry after payment confirmation').toBeTruthy();
      expect(await receiptReplay.json()).toMatchObject({ id: receiptId, idempotent_replay: true });

      const payments = (await (
        await request.get(`${API}/api/v1/projects/${s.projectId}/payments`, { headers: hC })
      ).json()) as Array<{ id: string; status: string }>;
      expect(payments.find((p) => p.id === paymentId)?.status).toBe('confirmed');

      const expenses = (await (
        await request.get(`${API}/api/v1/projects/${s.projectId}/os/expenses`, { headers: hC })
      ).json()) as Array<{ id: string; payment_id?: string; amount: number; status: string }>;
      const recognized = expenses.filter((e) => e.payment_id === paymentId);
      expect(recognized, 'One economic operation must create one recognized expense').toHaveLength(1);
      expect(recognized[0].status).toBe('confirmed');
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

      // Read back the canonical payment after dispute response rather than
      // trusting a 2xx HTTP response alone. The linked expense changes to disputed but keeps
      // its amount and cardinality across the dispute workflow.
      const finalPaymentsResponse = await request.get(
        `${API}/api/v1/projects/${s.projectId}/payments`, { headers: hC },
      );
      expect(finalPaymentsResponse.ok()).toBeTruthy();
      const finalPayments = (await finalPaymentsResponse.json()) as Array<{
        id: string; status: string;
      }>;
      const finalPayment = finalPayments.find((payment) => payment.id === paymentId);
      expect(finalPayment).toBeDefined();
      expect(finalPayment?.status).toBe('disputed');

      const finalExpensesResponse = await request.get(
        `${API}/api/v1/projects/${s.projectId}/os/expenses`, { headers: hC },
      );
      expect(finalExpensesResponse.ok()).toBeTruthy();
      const finalExpenses = (await finalExpensesResponse.json()) as Array<{
        id: string; payment_id?: string; amount: number; status: string;
      }>;
      const disputedExpenses = finalExpenses.filter((expense) =>
        expense.payment_id === paymentId
      );
      expect(disputedExpenses, 'Dispute must mark the same expense disputed without duplicating it').toHaveLength(1);
      expect(disputedExpenses[0].id).toBe(recognized[0].id);
      expect(disputedExpenses[0].status).toBe('disputed');
      expect(Number(disputedExpenses[0].amount)).toBe(5000);
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
