import { test, expect } from '@playwright/test';

const GOLDEN_PNG = 'data:image/png;base64,' + [
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  'CAQAAAC1HAwCAAAAC0lEQVR42mNk+A8A',
  'AQUBAScY42YAAAAASUVORK5CYII=',
].join('');
import { API, authHeaders, cleanupE2eGateProject, prepareContractGateScenario } from '../helpers';

async function finishChecklist(request: any, projectId: string, stageId: string, headers: Record<string,string>) {
  const workflow = await request.get(`${API}/api/v1/projects/${projectId}/stages/${stageId}/workflow`, { headers });
  const body = await workflow.json();
  for (const item of body.checklist ?? []) {
    if (!item.done) {
      const toggle = await request.post(
        `${API}/api/v1/projects/${projectId}/stages/${stageId}/checklist/toggle`,
        { headers, data: { item_id: item.id, done: true } },
      );
      expect(toggle.ok()).toBeTruthy();
    }
  }
}

test.describe('@golden @gp4 acceptance → rework → acceptance → warranty', () => {
  test('customer return gives contractor an actionable issue and resubmission path', async ({ request }) => {
    const s = await prepareContractGateScenario(request);
    const hC = authHeaders(s.customer);
    const hE = authHeaders(s.contractor);
    try {
      for (const h of [hC, hE]) {
        expect((await request.post(
          `${API}/api/v1/projects/${s.projectId}/documents/${s.documentId}/sign`,
          { headers: h, data: { provider: 'in_app' } },
        )).ok()).toBeTruthy();
      }
      expect((await request.post(
        `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}/start`,
        { headers: hE },
      )).ok()).toBeTruthy();
      await finishChecklist(request, s.projectId, s.stageId, hE);
      expect((await request.post(
        `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}/photos`,
        { headers: hE, data: { image_data: GOLDEN_PNG, caption: 'Результат работ' } },
      )).ok()).toBeTruthy();

      const submit = await request.post(
        `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}/submit`,
        { headers: hE },
      );
      expect(submit.ok()).toBeTruthy();
      const acceptanceId = (await submit.json()).acceptance_id as string;
      expect(acceptanceId).toBeTruthy();

      const returned = await request.post(
        `${API}/api/v1/projects/${s.projectId}/work-acceptances/${acceptanceId}/return`,
        { headers: hC, data: { comment: 'Не вывезен строительный мусор', create_issue: true } },
      );
      expect(returned.ok()).toBeTruthy();
      const issueId = (await returned.json()).issue_id as string;
      expect(issueId).toBeTruthy();

      const issues = await request.get(`${API}/api/v1/projects/${s.projectId}/issues`, { headers: hE });
      expect(issues.ok()).toBeTruthy();
      const issueRows = (await issues.json()) as Array<{id:string; title:string; status:string}>;
      expect(issueRows.some((i) => i.id === issueId && /мусор/i.test(i.title))).toBeTruthy();

      const fixed = await request.post(
        `${API}/api/v1/projects/${s.projectId}/issues/${issueId}/close`,
        { headers: hE },
      );
      expect(fixed.ok()).toBeTruthy();

      const resubmit = await request.post(
        `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}/submit`,
        { headers: hE },
      );
      expect(resubmit.ok()).toBeTruthy();
      const secondAcceptance = (await resubmit.json()).acceptance_id as string;
      expect(secondAcceptance).toBeTruthy();

      // A contractor's "fixed" claim only marks the rework checklist done.
      // The customer must independently verify the linked issue before the
      // next acceptance can be admitted (including medium severity issues).
      const beforeVerification = await request.post(
        `${API}/api/v1/projects/${s.projectId}/work-acceptances/${secondAcceptance}/accept`,
        { headers: hC, data: { quality_score: 9, comment: 'Принято' } },
      );
      expect(beforeVerification.status()).toBe(409);
      expect((await beforeVerification.json()).detail.code).toBe('rework_issue_verification_required');

      const verified = await request.post(
        `${API}/api/v1/projects/${s.projectId}/issues/${issueId}/close`,
        { headers: hC },
      );
      expect(verified.ok()).toBeTruthy();
      expect((await verified.json()).status).toBe('closed');

      const accept = await request.post(
        `${API}/api/v1/projects/${s.projectId}/work-acceptances/${secondAcceptance}/accept`,
        { headers: hC, data: { quality_score: 9, comment: 'Принято' } },
      );
      expect(accept.ok()).toBeTruthy();

      const stage = await request.get(
        `${API}/api/v1/projects/${s.projectId}/stages/${s.stageId}`,
        { headers: hC },
      );
      expect((await stage.json()).status).toBe('done');

      // GP4 warranty evidence: no simulated 30-day time jump is claimed here.
      const warrantyPath = `${API}/api/v1/projects/${s.projectId}/warranty-claims`;
      const requestId = `gp4-warranty-${s.projectId}`;
      const claimBody = {
        title: 'Появилась трещина в отделке',
        description: 'Недостаток обнаружен после принятия этапа',
        client_request_id: requestId,
      };
      const claim = await request.post(warrantyPath, { headers: hC, data: claimBody });
      expect(claim.ok(), `warranty create ${claim.status()}`).toBeTruthy();
      const canonical = (await claim.json()) as {
        issue_id: string; document_id: string; sla_days: number; idempotent_replay: boolean;
      };
      expect(canonical.issue_id).toBeTruthy();
      expect(canonical.document_id).toBeTruthy();
      expect(canonical.sla_days).toBe(14);
      expect(canonical.idempotent_replay).toBe(false);

      const replay = await request.post(warrantyPath, { headers: hC, data: claimBody });
      expect(replay.ok()).toBeTruthy();
      const replayBody = (await replay.json()) as {
        issue_id: string; document_id: string; idempotent_replay: boolean;
      };
      expect(replayBody.issue_id).toBe(canonical.issue_id);
      expect(replayBody.document_id).toBe(canonical.document_id);
      expect(replayBody.idempotent_replay).toBe(true);

      const changedPayload = await request.post(warrantyPath, {
        headers: hC,
        data: { ...claimBody, title: 'Попытка другого обращения с прежним ID' },
      });
      expect(changedPayload.status()).toBe(409);
      expect((await changedPayload.json()).detail.code).toBe('warranty_claim_idempotency_conflict');

      const listClaims = await request.get(warrantyPath, { headers: hC });
      expect(listClaims.ok()).toBeTruthy();
      const visibleClaims = (await listClaims.json()) as {
        items: Array<{ id: string; status: string }>;
      };
      expect(visibleClaims.items.filter((item) => item.id === canonical.issue_id)).toHaveLength(1);

      const warrantyAction = `${warrantyPath}/${canonical.issue_id}`;
      const contractorCannotClose = await request.post(`${warrantyAction}/close`, { headers: hE });
      expect(contractorCannotClose.status()).toBe(403);
      const customerCannotFix = await request.post(`${warrantyAction}/respond`, {
        headers: hC, data: { decision: 'fixed' },
      });
      expect(customerCannotFix.status()).toBe(403);

      const contractorAccept = await request.post(`${warrantyAction}/respond`, {
        headers: hE, data: { decision: 'accept', comment: 'Устранение согласовано' },
      });
      expect(contractorAccept.ok()).toBeTruthy();
      expect((await contractorAccept.json()).issue.status).toBe('in_progress');

      const contractorFixed = await request.post(`${warrantyAction}/respond`, {
        headers: hE, data: { decision: 'fixed', comment: 'Дефект устранён' },
      });
      expect(contractorFixed.ok()).toBeTruthy();
      expect((await contractorFixed.json()).issue.status).toBe('fixed');

      const closed = await request.post(`${warrantyAction}/close`, { headers: hC });
      expect(closed.ok()).toBeTruthy();
      const closedBody = (await closed.json()) as {
        changed: boolean; issue: { status: string; closed_at: string };
      };
      expect(closedBody.changed).toBe(true);
      expect(closedBody.issue.status).toBe('closed');
      expect(closedBody.issue.closed_at).toBeTruthy();

      const duplicateClose = await request.post(`${warrantyAction}/close`, { headers: hC });
      expect(duplicateClose.ok()).toBeTruthy();
      const duplicateBody = (await duplicateClose.json()) as {
        changed: boolean; issue: { closed_at: string };
      };
      expect(duplicateBody.changed).toBe(false);
      expect(duplicateBody.issue.closed_at).toBe(closedBody.issue.closed_at);

      async function warrantyDocumentStatus(): Promise<string | undefined> {
        const response = await request.get(
          `${API}/api/v1/projects/${s.projectId}/documents`, { headers: hC },
        );
        expect(response.ok()).toBeTruthy();
        const docHub = (await response.json()) as {
          items: Array<{ id: string; kind: string; status: string }>;
        };
        return docHub.items.find((doc) =>
          doc.id === canonical.document_id && doc.kind === 'warranty'
        )?.status;
      }
      expect(await warrantyDocumentStatus()).toBe('archived');

      const reopened = await request.post(`${warrantyAction}/reopen`, {
        headers: hC, data: { comment: 'Трещина проявилась повторно' },
      });
      expect(reopened.ok()).toBeTruthy();
      expect((await reopened.json()).issue.status).toBe('open');
      expect(await warrantyDocumentStatus()).toBe('draft');
      const oneClaimAfterReopen = await request.get(warrantyPath, { headers: hC });
      expect(oneClaimAfterReopen.ok()).toBeTruthy();
      expect(((await oneClaimAfterReopen.json()) as {
        items: Array<{ id: string }>;
      }).items.filter((item) => item.id === canonical.issue_id)).toHaveLength(1);
    } finally {
      await cleanupE2eGateProject(request, s.customer, s.projectId);
    }
  });
});
