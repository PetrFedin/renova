import { test, expect } from '@playwright/test';
import { openGoldenSurface } from './helpers';

test('@golden @gp2 mobile marketplace is reachable for both sides with role-appropriate wording', async ({ page, request }) => {
  await openGoldenSurface(page, request, 'customer', '/job-leads');
  await expect(page.locator('body')).toContainText(/заяв|исполн|предлож|оцен/i);
  await openGoldenSurface(page, request, 'contractor', '/job-leads');
  await expect(page.locator('body')).toContainText(/заяв|объект|оцен|предлож/i);
});
