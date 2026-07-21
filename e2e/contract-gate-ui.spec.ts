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
    await page.goto('/');
  });

  test('planned stage shows sign-contract banner', async ({ page, request }) => {
    const scenario = await prepareContractGateScenario(request);
    const { contractor, customer, projectId, stageId } = scenario;
    try {
      await seedDemoContractorSession(page, contractor.id, projectId, contractor.access_token);
      await page.goto(`/stage/${stageId}`);
      await expect(page.getByText('Перед началом работ')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Подпишите договор|договор/i).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'К документам' })).toBeVisible();
    } finally {
      await cleanupE2eGateProject(request, customer, projectId);
    }
  });
});
