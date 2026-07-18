/**
 * P3-W11/W16 — golden path: lock estimate → sign contract → start stage (API E2E).
 * Использует fresh project (planned stage), не demo-квартиру с active этапом.
 */
import { test, expect } from '@playwright/test';
import { API, apiReachable, prepareContractGateScenario } from './helpers';

test.describe('P3-W11 Contract gate golden path', () => {
  test('lock → sign → start stage', async ({ request }) => {
    test.skip(!(await apiReachable()), 'Need API :8100');

    const { contractorId, customerId, projectId, stageId, documentId } =
      await prepareContractGateScenario(request);
    const hCont = { 'X-User-Id': contractorId };
    const hCust = { 'X-User-Id': customerId };

    const blocked = await request.post(`${API}/api/v1/projects/${projectId}/stages/${stageId}/start`, {
      headers: hCont,
    });
    expect(blocked.status()).toBe(403);

    const signed = await request.post(`${API}/api/v1/projects/${projectId}/documents/${documentId}/sign`, {
      headers: hCust,
      data: { provider: 'in_app' },
    });
    expect(signed.ok()).toBeTruthy();

    const gate = await (
      await request.get(`${API}/api/v1/projects/${projectId}/contract-gate`, { headers: hCont })
    ).json();
    expect(gate.ok).toBe(true);

    const started = await request.post(`${API}/api/v1/projects/${projectId}/stages/${stageId}/start`, {
      headers: hCont,
    });
    expect(started.ok()).toBeTruthy();
    expect((await started.json()).status).toBe('active');
  });
});
