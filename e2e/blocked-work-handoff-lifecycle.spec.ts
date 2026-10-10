/**
 * Action OS Blocked Work / Handoff cross-role proof.
 * Real API state: predecessor -> dependency -> review/rework -> acceptance -> unblock -> explicit start.
 * Uses fresh customer-owned project and canonical mutations, never hand-crafted responsibility rows.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, authHeaders, cleanupE2eGateProject, prepareContractGateScenario } from './helpers';

const PROOF_PNG = 'data:image/png;base64,' + [
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  'CAQAAAC1HAwCAAAAC0lEQVR42mNk+A8A',
  'AQUBAScY42YAAAAASUVORK5CYII=',
].join('');

type Handoff = {
  stage_id: string;
  blocker_type: string;
  blocker_ref_id: string | null;
  blocker_title: string;
  handoff_action: string;
  handoff_persona: string | null;
  handoff_user_id: string | null;
  handoff_kind: string;
};
type ActionQueue = {
  project_id: string;
  blocked_work: { count: number; blocked_stage_count: number; items: Handoff[] };
  items: Array<{ resource_type: string; resource_id: string; action: string; responsible_user_id: string | null }>;
};

async function readQueue(
  request: APIRequestContext,
  projectId: string,
  headers: Record<string, string>,
): Promise<ActionQueue> {
  const response = await request.get(`${API}/api/v1/projects/${projectId}/actions/responsibility`, { headers });
  expect(response.status(), 'authorized actor must read canonical Action Queue').toBe(200);
  return (await response.json()) as ActionQueue;
}

function targetBlock(queue: ActionQueue, stageId: string): Handoff[] {
  return queue.blocked_work.items.filter((item) => item.stage_id === stageId);
}

test.describe('Action OS — blocked work, real actor handoff and unblock', () => {
  test('owner/lead: blocked → review → rework → review → accepted → explicit successor start; outsider cannot read', async ({
    request,
  }) => {
    const s = await prepareContractGateScenario(request);
    const hOwner = authHeaders(s.customer);
    const hLead = authHeaders(s.contractor);
    const stageUrl = `${API}/api/v1/projects/${s.projectId}/stages`;
    const queueUrl = `${API}/api/v1/projects/${s.projectId}/actions/responsibility`;

    try {
      const created = await request.post(stageUrl, {
        headers: hLead,
        data: {
          name: 'Монтаж после принятого основания',
          client_request_id: `blocked-handoff-${Date.now()}`,
        },
      });
      expect(created.status(), 'lead creates successor through canonical schedule API').toBe(200);
      const successorId = ((await created.json()) as { id: string }).id;
      expect(successorId).toBeTruthy();

      const depends = await request.patch(`${stageUrl}/${successorId}/depends`, {
        headers: hLead,
        data: { depends_on_stage_id: s.stageId },
      });
      expect(depends.ok(), 'lead sets canonical stage dependency').toBeTruthy();

      for (const headers of [hOwner, hLead]) {
        const queue = await readQueue(request, s.projectId, headers);
        const blockers = targetBlock(queue, successorId);
        expect(blockers).toHaveLength(1);
        expect(blockers[0]).toMatchObject({
          blocker_type: 'work',
          blocker_ref_id: s.stageId,
          handoff_kind: 'work',
          handoff_action: 'complete_dependency_stage',
          handoff_persona: 'lead',
          handoff_user_id: s.contractorId,
        });
      }

      // A guest who is not a project principal cannot query stage metadata via Action Queue.
      const guestResponse = await request.post(`${API}/api/v1/auth/demo/guest`, { data: {} });
      expect(guestResponse.ok()).toBeTruthy();
      const guest = (await guestResponse.json()) as { id: string; token?: string; access_token?: string };
      const outsider = await request.get(queueUrl, { headers: authHeaders(guest) });
      expect(outsider.status()).toBe(403);
      expect(await outsider.text()).not.toContain(successorId);
      expect(await outsider.text()).not.toContain('Монтаж после принятого основания');

      for (const headers of [hOwner, hLead]) {
        const signed = await request.post(
          `${API}/api/v1/projects/${s.projectId}/documents/${s.documentId}/sign`,
          { headers, data: { provider: 'in_app' } },
        );
        expect(signed.ok()).toBeTruthy();
      }

      // A dependent stage cannot start before the predecessor is accepted.
      const denied = await request.post(`${stageUrl}/${successorId}/start`, { headers: hLead });
      expect(denied.status()).toBe(409);
      expect((await denied.json()).detail.code).toBe('blocked');

      const first = await request.post(`${stageUrl}/${s.stageId}/start`, { headers: hLead });
      expect(first.ok(), 'lead may start predecessor after contract signing').toBeTruthy();

      const workflowResponse = await request.get(`${stageUrl}/${s.stageId}/workflow`, { headers: hLead });
      expect(workflowResponse.ok()).toBeTruthy();
      const workflow = (await workflowResponse.json()) as { checklist?: Array<{ id: string; done: boolean }> };
      expect((workflow.checklist ?? []).length).toBeGreaterThan(0);
      for (const item of workflow.checklist ?? []) {
        if (!item.done) {
          const checked = await request.post(`${stageUrl}/${s.stageId}/checklist/toggle`, {
            headers: hLead,
            data: { item_id: item.id, done: true },
          });
          expect(checked.ok()).toBeTruthy();
        }
      }
      const evidence = await request.post(`${stageUrl}/${s.stageId}/photos`, {
        headers: hLead,
        data: { image_data: PROOF_PNG, caption: 'Предшествующая работа выполнена' },
      });
      expect(evidence.ok()).toBeTruthy();

      const submitted = await request.post(`${stageUrl}/${s.stageId}/submit`, { headers: hLead });
      expect(submitted.ok()).toBeTruthy();
      const firstAcceptanceId = ((await submitted.json()) as { acceptance_id: string }).acceptance_id;
      expect(firstAcceptanceId).toBeTruthy();

      const reviewQueue = await readQueue(request, s.projectId, hLead);
      expect(targetBlock(reviewQueue, successorId)).toMatchObject([{
        handoff_action: 'decide_work_acceptance',
        handoff_persona: 'owner',
        handoff_user_id: s.customerId,
      }]);
      const ownerQueue = await readQueue(request, s.projectId, hOwner);
      expect(ownerQueue.items.some(item =>
        item.resource_type === 'acceptance' &&
        item.resource_id === firstAcceptanceId &&
        item.action === 'decide_work_acceptance' &&
        item.responsible_user_id === s.customerId,
      )).toBe(true);

      // Rework is not acceptance: the dependent stage must remain blocked.
      const returned = await request.post(
        `${API}/api/v1/projects/${s.projectId}/work-acceptances/${firstAcceptanceId}/return`,
        { headers: hOwner, data: { comment: 'Убрать строительный мусор', create_issue: true } },
      );
      expect(returned.ok()).toBeTruthy();
      const issueId = ((await returned.json()) as { issue_id: string }).issue_id;
      expect(issueId).toBeTruthy();

      const afterReturn = await readQueue(request, s.projectId, hOwner);
      expect(targetBlock(afterReturn, successorId)).toMatchObject([{
        handoff_action: 'complete_dependency_stage',
        handoff_user_id: s.contractorId,
      }]);
      const stillDenied = await request.post(`${stageUrl}/${successorId}/start`, { headers: hLead });
      expect(stillDenied.status()).toBe(409);

      const fixed = await request.post(`${API}/api/v1/projects/${s.projectId}/issues/${issueId}/close`, {
        headers: hLead,
      });
      expect(fixed.ok()).toBeTruthy();
      const resubmitted = await request.post(`${stageUrl}/${s.stageId}/submit`, { headers: hLead });
      expect(resubmitted.ok()).toBeTruthy();
      const finalAcceptanceId = ((await resubmitted.json()) as { acceptance_id: string }).acceptance_id;
      expect(finalAcceptanceId).toBeTruthy();

      const accepted = await request.post(
        `${API}/api/v1/projects/${s.projectId}/work-acceptances/${finalAcceptanceId}/accept`,
        { headers: hOwner, data: { quality_score: 9, comment: 'Работы приняты' } },
      );
      expect(accepted.ok()).toBeTruthy();

      for (const headers of [hOwner, hLead]) {
        const queue = await readQueue(request, s.projectId, headers);
        expect(targetBlock(queue, successorId), 'accepted predecessor must remove the blocker').toHaveLength(0);
      }
      const predecessor = await request.get(`${stageUrl}/${s.stageId}`, { headers: hOwner });
      expect((await predecessor.json()).status).toBe('done');

      // No implicit start on acceptance: the assigned executor must explicitly begin successor.
      const beforeStart = await request.get(`${stageUrl}/${successorId}`, { headers: hOwner });
      expect((await beforeStart.json()).status).toBe('planned');
      const started = await request.post(`${stageUrl}/${successorId}/start`, { headers: hLead });
      expect(started.ok(), 'lead starts successor after canonical acceptance').toBeTruthy();
      const afterStart = await request.get(`${stageUrl}/${successorId}`, { headers: hOwner });
      expect((await afterStart.json()).status).toBe('active');
    } finally {
      await cleanupE2eGateProject(request, s.customer, s.projectId);
    }
  });
});
