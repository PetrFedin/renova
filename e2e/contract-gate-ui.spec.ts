/**
 * P3-W15 — contract gate banner on stage screen (contractor, web :8081).
 */
import { test, expect } from '@playwright/test';
import {
  apiReachable,
  webReachable,
  prepareContractGateScenario,
  seedDemoContractorSession,
  cleanupE2eGateProject,
} from './helpers';

test.describe('P3-W15 Contract gate UI', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need API :8100 and web :8081');
  });

  test('planned stage shows sign-contract banner', async ({ page, request }) => {
    const scenario = await prepareContractGateScenario(request);
    const { contractor, customer, projectId, stageId } = scenario;
    try {
      // Install the exact scenario identity before every document bootstrap. The
      // previous goto/evaluate/reload sequence could race the initial demo
      // bootstrap, which then persisted a different project and made the stage
      // route issue a cross-project 404.
      await page.addInitScript(
        ({ uid, pid, tok }) => {
          localStorage.setItem('renova_user_id', uid);
          localStorage.setItem('renova_project_id', pid);
          localStorage.setItem('renova_user_role', 'contractor');
          localStorage.setItem('renova_detail_quiz_done', '1');
          localStorage.removeItem('renova_pending_project_pick');
          localStorage.setItem('renova_project_explicitly_picked', '1');
          if (tok) localStorage.setItem('renova_access_token', tok);
        },
        {
          uid: contractor.id,
          pid: projectId,
          tok: contractor.access_token?.trim() || '',
        },
      );
      await seedDemoContractorSession(page, contractor.id, projectId, contractor.access_token);
      await page.goto(`/stage/${stageId}`);
      await expect(page.getByText('Перед началом работ', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Подпишите договор|договор/i).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'К документам' })).toBeVisible();
    } finally {
      await cleanupE2eGateProject(request, customer, projectId);
    }
  });
});
