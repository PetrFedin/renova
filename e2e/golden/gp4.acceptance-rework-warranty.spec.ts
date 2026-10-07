import { test, expect } from '@playwright/test';
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
        { headers: hE, data: { image_data: 'golden-evidence', caption: 'Результат работ' } },
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
    } finally {
      await cleanupE2eGateProject(request, s.customer, s.projectId);
    }
  });
});
