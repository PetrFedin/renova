import { test, expect } from '@playwright/test';
import { openGoldenSurface } from './helpers';

test('@golden @gp1 mobile customer can understand object and budget without hunting', async ({ page, request }) => {
  await openGoldenSurface(page, request, 'customer', '/object?tab=estimate');
  await expect(page.locator('body')).toContainText(/Смет|Объект|комнат/i);
  await page.goto('/budget?tab=summary', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toContainText(/Бюджет|План|Факт/i);
});
