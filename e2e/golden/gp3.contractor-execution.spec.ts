import { test, expect } from '@playwright/test';
import { API, authHeaders, cleanupE2eGateProject, prepareContractGateScenario } from '../helpers';

test.describe('@golden @gp3 contractor execution → customer visibility', () => {
  test('signed contract → explicit start → work order → evidence → progress visible to customer', async ({ request }) => {
    const s = await prepareContractGateScenario(request);
    const hC = authHeaders(s.customer);
    const hE = authHeaders(s.contractor);
    try {
      for (const h of [hC, hE]) {
        const sign = await request.post(
          `${API}/api/v1/projects/${s.projectId}/documents/${s.documentId}/sign`,
          { headers: h, data: { provider: 'in_app' } },
        );
        expect(sign.ok()).toBeTruthy();
      }

      const start = await request.post(
        `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}/start`,
        { headers: hE },
      );
      expect(start.ok()).toBeTruthy();

      const workOrder = await request.post(`${API}/api/v1/projects/${s.projectId}/work-orders`, {
        headers: hE,
        data: {
          title: 'Golden execution order',
          work_type: 'general',
          stage_id: s.stageId,
          budget_planned: 10000,
          publish: true,
          client_request_id: `gp3-wo-${Date.now()}`,
        },
      });
      expect(workOrder.ok()).toBeTruthy();

      for (let i = 1; i <= 3; i += 1) {
        const photo = await request.post(
          `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}/photos`,
          { headers: hE, data: { image_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', caption: `Результат ${i}` } },
        );
        expect(photo.ok()).toBeTruthy();
      }

      const workflow = await request.get(
        `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}/workflow`,
        { headers: hE },
      );
      expect(workflow.ok()).toBeTruthy();
      const wf = (await workflow.json()) as { checklist?: Array<{ id: string; done: boolean }> };
      const checklist = wf.checklist ?? [];
      expect(checklist.length).toBeGreaterThan(0);
      const targetDone = Math.max(1, Math.ceil(checklist.length * 0.6));
      for (const item of checklist.slice(0, targetDone)) {
        const toggle = await request.post(
          `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}/checklist/toggle`,
          { headers: hE, data: { item_id: item.id, done: true } },
        );
        expect(toggle.ok()).toBeTruthy();
      }

      const customerStage = await request.get(
        `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}`,
        { headers: hC },
      );
      expect(customerStage.ok()).toBeTruthy();
      const stage = (await customerStage.json()) as { percent_complete: number; status: string };
      expect(stage.status).toBe('active');
      expect(stage.percent_complete).toBeGreaterThanOrEqual(50);

      const dashboard = await request.get(`${API}/api/v1/projects/${s.projectId}/dashboard`, {
        headers: hC,
      });
      expect(dashboard.ok()).toBeTruthy();
      expect(Number((await dashboard.json()).progress_percent)).toBeGreaterThan(0);
    } finally {
      await cleanupE2eGateProject(request, s.customer, s.projectId);
    }
  });

  test('work cannot start before the contract is fully signed', async ({ request }) => {
    const s = await prepareContractGateScenario(request);
    try {
      const blocked = await request.post(
        `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}/start`,
        { headers: authHeaders(s.contractor) },
      );
      expect(blocked.status()).toBe(403);
    } finally {
      await cleanupE2eGateProject(request, s.customer, s.projectId);
    }
  });
});
