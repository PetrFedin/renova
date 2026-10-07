import { test, expect } from '@playwright/test';
import { openGoldenSurface } from './helpers';

test('@golden @gp4 acceptance and warranty actions are discoverable from Control', async ({ page, request }) => {
  await openGoldenSurface(page, request, 'customer', '/repair?tab=control');
  await expect(page.locator('body')).toContainText(/приём|контрол|гарант|замеч/i);
  await openGoldenSurface(page, request, 'contractor', '/repair?tab=control');
  await expect(page.locator('body')).toContainText(/контрол|замеч|доработ|приём/i);
});
