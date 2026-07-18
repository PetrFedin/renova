/**
 * P3-W15 — contract gate banner on stage screen (contractor, web :8081).
 */
import { test, expect } from '@playwright/test';
import {
  apiReachable,
  webReachable,
  prepareContractGateScenario,
  seedDemoContractorSession,
} from './helpers';

test.describe('P3-W15 Contract gate UI', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need API :8100 and web :8081');
    await page.goto('/');
  });

  test('planned stage shows sign-contract banner', async ({ page, request }) => {
    const { contractorId, projectId, stageId } = await prepareContractGateScenario(request);
    await seedDemoContractorSession(page, contractorId, projectId);
    await page.goto(`/stage/${stageId}`);
    await expect(page.getByText('Перед началом работ')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Подпишите договор|договор/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'К документам' })).toBeVisible();
  });
});
